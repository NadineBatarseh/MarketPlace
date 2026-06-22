import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import {
  getPaytabsConfig,
  createHostedPayment,
  queryTransaction,
  isApproved,
  type SplitPayoutEntity,
} from '../lib/paytabs.js';
import { PC } from '../lib/paymentConfig.js';
import type { PaymentStatus } from '../../shared/status.js';
import { createShipmentsForOrder } from '../lib/shipments.js';
import { decryptSecret } from '../lib/payoutCrypto.js';

/**
 * PayTabs Hosted Payment Page — Phase 1 (Test Mode).
 *
 * Mounted at /api/payments/paytabs. Flow:
 *   POST /create   (customer)            → builds a Hosted Payment Page, returns redirect_url
 *   POST /callback (PayTabs server→server) → authoritative IPN; applies result
 *   GET|POST /return (browser redirect)  → applies result, 302 → frontend result page
 *   GET  /status   (customer)            → re-verifies + reports status for a return page
 *
 * Money is never trusted from the client:
 *   - the charged amount is recomputed from products.price in the DB
 *   - paid/failed status is always re-read from PayTabs via the Query API,
 *     never taken from the (unsigned) redirect/IPN body.
 *
 * applyPaymentResult() is idempotent, so callback + return + status can all fire
 * for the same transaction without double-applying or duplicating payouts.
 */
const router = Router();

// Financial knobs (commission rate, delivery fee) are admin-editable and read at
// runtime from PC (server/lib/paymentConfig.ts), NOT captured once at module load.

/* ─────────────────────────── totals (server-authoritative) ─────────────────────────── */

interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** shop_id → gross product revenue for that shop in this order */
  perShop: Map<string, number>;
}

/**
 * Recompute an order's totals from the database using products.price as the
 * source of truth (NOT order_details.unit_price, which originated client-side).
 */
async function computeOrderTotals(orderId: number | string): Promise<OrderTotals> {
  const { data: details, error: detErr } = await supabase
    .from('order_details')
    .select('product_id, qty')
    .eq('order_id', orderId);

  if (detErr) throw new Error(detErr.message);
  if (!details || details.length === 0) throw new Error('Order has no items');

  const productIds = [...new Set(details.map((d) => d.product_id).filter(Boolean))] as string[];
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, price, shop_id')
    .in('id', productIds);

  if (prodErr) throw new Error(prodErr.message);

  const priceMap = new Map<string, { price: number; shop_id: string | null }>();
  for (const p of products ?? []) {
    priceMap.set(p.id, { price: Number(p.price ?? 0), shop_id: p.shop_id ?? null });
  }

  const perShop = new Map<string, number>();
  let subtotal = 0;
  for (const d of details) {
    const meta = d.product_id ? priceMap.get(d.product_id) : undefined;
    if (!meta) continue; // product gone — skip (never charge for it)
    const qty = Number(d.qty ?? 1);
    const line = meta.price * qty;
    subtotal += line;
    const shopKey = meta.shop_id ?? 'unknown';
    perShop.set(shopKey, (perShop.get(shopKey) ?? 0) + line);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    subtotal: round(subtotal),
    deliveryFee: PC.deliveryFee,
    total: round(subtotal + PC.deliveryFee),
    perShop,
  };
}

/* ─────────────────────────── split payout (pay-in distribution) ─────────────────────────── */

/**
 * The platform's own settlement beneficiary, read from PAYOUT_PLATFORM_* env vars.
 * Every split includes a platform entity that absorbs the remainder, because PayTabs
 * requires the split item_totals to sum EXACTLY to the charged total (verified live —
 * sum < total is rejected with "Total of split items does not match transaction total").
 * Returns null if not fully configured.
 */
function getPlatformBeneficiary(): SplitPayoutEntity['beneficiary'] | null {
  const name = process.env.PAYOUT_PLATFORM_NAME;
  const account_number = process.env.PAYOUT_PLATFORM_IBAN;
  const bank = process.env.PAYOUT_PLATFORM_BANK;
  const country = process.env.PAYOUT_PLATFORM_COUNTRY || process.env.PAYTABS_COUNTRY || 'PS';
  if (!name || !account_number || !bank) return null;
  return {
    name,
    account_number,
    country,
    bank,
    bank_branch: process.env.PAYOUT_PLATFORM_BANK_BRANCH || '',
    mobile_number: process.env.PAYOUT_PLATFORM_MOBILE || '',
    email: process.env.PAYOUT_PLATFORM_EMAIL || '',
    address_1: process.env.PAYOUT_PLATFORM_ADDRESS1 || '',
    address_2: '',
  };
}

/**
 * Build the PayTabs `split_payout[]` for an order. PayTabs distributes the WHOLE charge
 * across the entities at settlement — the item_totals MUST sum exactly to the charged
 * total. So the split has two kinds of entity:
 *   - one per shop that completed payout onboarding: item_total = product revenue NET of
 *     the platform commission, paid to the shop's bank.
 *   - a single PLATFORM entity that takes the remainder (commissions + delivery fee +
 *     any not-yet-onboarded shop's share — "platform holds the share", user decision),
 *     paid to the platform's own settlement account (PAYOUT_PLATFORM_*).
 *
 * MSC (PayTabs' processing fee) is borne by the vendors (user decision 2026-06-23): shop
 * entities are 'P' (last shop 'R' to absorb the rounding remainder), a lone shop is 'F';
 * the platform entity is 'Z' (bears no fee).
 *
 * Returns [] (→ charge with no split, platform settles everything manually) when no shop
 * is payable, or when a remainder exists but PAYOUT_PLATFORM_* isn't configured.
 */
async function buildSplitPayout(totals: OrderTotals): Promise<SplitPayoutEntity[]> {
  const shopIds = [...totals.perShop.keys()].filter((k) => k && k !== 'unknown');
  if (shopIds.length === 0) return [];

  const { data: shops } = await supabase
    .from('shops')
    .select('shop_id, name, payout_onboarding_status, payout_iban_enc, payout_beneficiary_name, payout_bank_name, payout_bank_branch, payout_country, payout_email, payout_mobile, payout_address1')
    .in('shop_id', shopIds);

  const round = (n: number) => Math.round(n * 100) / 100;
  const rate = PC.platformCommissionRate;
  const shopEntities: SplitPayoutEntity[] = [];

  // PayTabs requires non-empty mobile_number, email AND address_1 per beneficiary (verified
  // live — bank_branch/address_2 may be empty). Onboarding doesn't yet collect these, so fall
  // back to platform contact values. TODO: capture per-shop contact details at onboarding.
  const fbEmail = process.env.PAYOUT_PLATFORM_EMAIL || 'payouts@souqlink.test';
  const fbMobile = process.env.PAYOUT_PLATFORM_MOBILE || '+970000000000';
  const fbAddress = process.env.PAYOUT_PLATFORM_ADDRESS1 || process.env.PAYTABS_COUNTRY || 'PS';

  for (const s of shops ?? []) {
    if (s.payout_onboarding_status !== 'active' || !s.payout_iban_enc) continue;
    if (!s.payout_beneficiary_name || !s.payout_bank_name || !s.payout_country) continue;

    const gross = totals.perShop.get(s.shop_id) ?? 0;
    const net = round(gross * (1 - rate));
    if (net <= 0) continue;

    let iban: string;
    try {
      iban = decryptSecret(s.payout_iban_enc);
    } catch {
      console.error(`[paytabs] split: IBAN decrypt failed for shop ${s.shop_id} — held by platform`);
      continue;
    }

    shopEntities.push({
      entity_id: 1001 + shopEntities.length,
      entity_name: s.name || `Shop ${s.shop_id}`,
      item_description: `Order revenue (net of ${Math.round(rate * 100)}% commission)`,
      item_total: net.toFixed(2),
      msc_flag: 'P', // finalised below once the entity count is known
      beneficiary: {
        name: s.payout_beneficiary_name,
        account_number: iban,
        country: s.payout_country,
        bank: s.payout_bank_name,
        bank_branch: s.payout_bank_branch || '',
        mobile_number: s.payout_mobile || fbMobile,
        email: s.payout_email || fbEmail,
        address_1: s.payout_address1 || fbAddress,
        address_2: '',
      },
    });
  }

  if (shopEntities.length === 0) return []; // nothing payable → no split

  // Vendors bear MSC: 'P' for all shops, 'R' on the last; a lone shop takes 'F'.
  if (shopEntities.length === 1) {
    shopEntities[0].msc_flag = 'F';
  } else {
    for (const e of shopEntities) e.msc_flag = 'P';
    shopEntities[shopEntities.length - 1].msc_flag = 'R';
  }

  const allocated = round(shopEntities.reduce((sum, e) => sum + Number(e.item_total), 0));
  const remainder = round(totals.total - allocated);

  if (remainder <= 0.001) return shopEntities; // nothing left for the platform (rare)

  // The platform entity absorbs the remainder so the items sum to the exact total.
  const platform = getPlatformBeneficiary();
  if (!platform) {
    console.error('[paytabs] split: PAYOUT_PLATFORM_* not configured — cannot allocate remainder; charging WITHOUT split.');
    return [];
  }

  return [
    ...shopEntities,
    {
      entity_id: 1000,
      entity_name: 'SOUQLINK Platform',
      item_description: 'Platform commission + delivery',
      item_total: remainder.toFixed(2),
      msc_flag: 'Z',
      beneficiary: platform,
    },
  ];
}

/* ─────────────────────────── courier lookup ─────────────────────────── */

/** Resolve the assigned courier for an order via shipments → batches.assigned_to (null if none yet). */
async function findAssignedCourier(orderId: number | string): Promise<string | null> {
  const { data: details } = await supabase
    .from('order_details')
    .select('id')
    .eq('order_id', orderId);

  const detailIds = (details ?? []).map((d) => d.id);
  if (detailIds.length === 0) return null;

  const { data: shipments } = await supabase
    .from('shipments')
    .select('batch_id')
    .in('order_detail_id', detailIds);

  const batchIds = [...new Set((shipments ?? []).map((s) => s.batch_id).filter(Boolean))] as string[];
  if (batchIds.length === 0) return null;

  const { data: batches } = await supabase
    .from('batches')
    .select('assigned_to')
    .in('id', batchIds);

  const courier = (batches ?? []).map((b) => b.assigned_to).find(Boolean);
  return (courier as string | undefined) ?? null;
}

/* ─────────────────────────── internal payout ledger ─────────────────────────── */

/**
 * Create the internal marketplace settlement records for a paid order:
 *   - one 'shop' payout per shop (gross − platform commission)
 *   - one 'platform' commission payout (sum of commissions)
 *   - one 'courier' payout (delivery fee) IF a courier is already assigned
 *
 * Phase 1 only records them; the real PayTabs Split Payout API is NOT called.
 * Idempotent: skips entirely when payout rows for the order already exist.
 */
async function createPayoutRecords(
  orderId: number,
  paymentId: string,
  currency: string,
  totals: OrderTotals,
): Promise<void> {
  const { count } = await supabase
    .from('payouts')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  if ((count ?? 0) > 0) return; // already created — stay idempotent

  const round = (n: number) => Math.round(n * 100) / 100;
  const rows: Array<Record<string, unknown>> = [];
  let platformCommission = 0;

  for (const [shopId, gross] of totals.perShop.entries()) {
    if (shopId === 'unknown') continue;
    const commission = round(gross * PC.platformCommissionRate);
    platformCommission += commission;
    rows.push({
      order_id: orderId,
      payment_id: paymentId,
      payee_type: 'shop',
      payee_id: shopId,
      amount: round(gross - commission),
      currency,
      status: 'pending',
      note: `Shop revenue ${gross} − ${Math.round(PC.platformCommissionRate * 100)}% commission`,
    });
  }

  const courierId = await findAssignedCourier(orderId);
  if (courierId) {
    rows.push({
      order_id: orderId,
      payment_id: paymentId,
      payee_type: 'courier',
      payee_id: courierId,
      amount: round(totals.deliveryFee),
      currency,
      status: 'pending',
      note: 'Delivery fee',
    });
  }

  rows.push({
    order_id: orderId,
    payment_id: paymentId,
    payee_type: 'platform',
    payee_id: null,
    amount: round(platformCommission),
    currency,
    status: 'pending',
    note: 'Platform commission',
  });

  const { error } = await supabase.from('payouts').insert(rows);
  if (error) console.error('[paytabs] payout insert failed:', error.message);
}

/* ─────────────────────────── idempotent result applier ─────────────────────────── */

interface ApplyOutcome {
  status: 'paid' | 'failed' | 'unknown';
  orderId: number | null;
}

/**
 * Re-query PayTabs for the authoritative status of a transaction and apply it to
 * our DB exactly once. Safe to call from callback, return, and status endpoints.
 */
async function applyPaymentResult(tranRef: string): Promise<ApplyOutcome> {
  const cfg = getPaytabsConfig();

  const { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('tran_ref', tranRef)
    .maybeSingle();

  if (!payment) return { status: 'unknown', orderId: null };
  const orderId = payment.order_id as number;

  const result = await queryTransaction(cfg, tranRef);
  const approved = isApproved(result);

  // Always store the latest raw PayTabs response for debugging.
  await supabase
    .from('payments')
    .update({ payment_result: result, updated_at: new Date().toISOString() })
    .eq('id', payment.id);

  if (approved) {
    if (payment.status !== 'paid') {
      await supabase.from('payments').update({ status: 'paid' }).eq('id', payment.id);
      // orders.status stays untouched here — it tracks delivery lifecycle only,
      // payment outcome belongs in orders.payment_status.
      const paidStatus: PaymentStatus = 'paid';
      await supabase
        .from('orders')
        .update({ payment_status: paidStatus, paid_at: new Date().toISOString() })
        .eq('id', orderId);

      // Best-effort tracking event — never block the payment flow on it.
      await supabase
        .from('order_tracking_events')
        .insert({
          order_id: orderId,
          step: 'confirmed',
          triggered_by: 'PayTabs',
          note: 'تم تأكيد الدفع عبر PayTabs',
        })
        .then(undefined, () => {});
    }

    // Idempotent — recompute totals so payout amounts match the charged amount.
    const totals = await computeOrderTotals(orderId);
    await createPayoutRecords(orderId, payment.id, payment.currency, totals);

    // Safety net: shipments are normally created at order placement, but retry
    // here (idempotent) in case that step failed — and so a callback firing
    // multiple times never duplicates shipments.
    await createShipmentsForOrder(orderId).catch(e =>
      console.error('[paytabs] shipment creation failed for order', orderId, e),
    );
    return { status: 'paid', orderId };
  }

  // Declined / failed — never downgrade an already-paid order. orders.status
  // is left as 'pending'; only payment_status reflects the failure.
  if (payment.status !== 'paid') {
    await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id);
    const failedStatus: PaymentStatus = 'failed';
    await supabase
      .from('orders')
      .update({ payment_status: failedStatus })
      .eq('id', orderId);
  }
  return { status: 'failed', orderId };
}

/* ─────────────────────────── POST /create ─────────────────────────── */

router.post('/create', requireCustomer, async (req: Request, res: Response) => {
  const { order_id, contact, shipping } = req.body as {
    order_id?: number | string;
    contact?: { firstName?: string; lastName?: string; email?: string; phone?: string };
    shipping?: { address?: string; city?: string; postalCode?: string };
  };

  if (order_id === undefined || order_id === null) {
    return res.status(400).json({ ok: false, error: 'order_id is required' });
  }

  let cfg;
  try {
    cfg = getPaytabsConfig();
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }

  // 1. Verify the authenticated customer owns the order.
  const { data: order, error: ordErr } = await supabase
    .from('orders')
    .select('id, user_id')
    .eq('id', order_id)
    .maybeSingle();

  if (ordErr) return res.status(500).json({ ok: false, error: ordErr.message });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  if (order.user_id !== req.authUserId) {
    return res.status(403).json({ ok: false, error: 'You do not own this order' });
  }

  // 2. Compute the authoritative total from the DB and persist it.
  let totals: OrderTotals;
  try {
    totals = await computeOrderTotals(order.id);
  } catch (e) {
    return res.status(400).json({ ok: false, error: (e as Error).message });
  }
  if (totals.total <= 0) return res.status(400).json({ ok: false, error: 'Order total must be greater than zero' });

  await supabase.from('orders').update({ total_price: totals.total }).eq('id', order.id);

  // Customer display details (non-authoritative — for the PayTabs receipt only).
  const { data: userRow } = await supabase
    .from('Users')
    .select('email, name')
    .eq('user_id', req.authUserId)
    .maybeSingle();

  const fullName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();

  // Marketplace split: distribute each onboarded shop's share to its bank at settlement.
  // Best-effort — a failure here must never block checkout (the order just charges without
  // a split, leaving every shop's share with the platform to settle manually).
  let splitPayout: SplitPayoutEntity[] = [];
  try {
    splitPayout = await buildSplitPayout(totals);
  } catch (e) {
    console.error('[paytabs] split build failed — charging without split:', (e as Error).message);
  }
  const payableShops = splitPayout.length;
  const totalShops = [...totals.perShop.keys()].filter((k) => k && k !== 'unknown').length;
  if (payableShops < totalShops) {
    console.log(`[paytabs] order ${order.id}: ${payableShops}/${totalShops} shops in split; ${totalShops - payableShops} held by platform (not onboarded).`);
  }

  // 3. Create the Hosted Payment Page.
  let paytabsRes;
  try {
    paytabsRes = await createHostedPayment(cfg, {
      cartId: String(order.id),
      amount: totals.total,
      description: `SOUQLINK Order #${order.id}`,
      customer: {
        name: fullName || userRow?.name || undefined,
        email: contact?.email || userRow?.email || undefined,
        phone: contact?.phone || undefined,
        street1: shipping?.address || undefined,
        city: shipping?.city || undefined,
        zip: shipping?.postalCode || undefined,
      },
      splitPayout,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }

  // 4. Save tran_ref + redirect_url (and the full response) in the payments table.
  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      order_id: order.id,
      user_id: req.authUserId,
      provider: 'paytabs',
      amount: totals.total,
      currency: cfg.currency,
      status: 'pending',
      tran_ref: paytabsRes.tran_ref ?? null,
      cart_id: String(order.id),
      redirect_url: paytabsRes.redirect_url ?? null,
      payment_result: paytabsRes,
    })
    .select('id')
    .single();

  if (payErr) return res.status(500).json({ ok: false, error: payErr.message });

  await supabase.from('orders').update({ payment_status: 'pending' }).eq('id', order.id);

  // 5. Return the redirect URL to the frontend.
  return res.json({
    ok: true,
    payment_id: payment.id,
    order_id: order.id,
    tran_ref: paytabsRes.tran_ref,
    redirect_url: paytabsRes.redirect_url,
  });
});

/* ─────────────────────────── POST /callback (server→server IPN) ─────────────────────────── */

router.post('/callback', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, any>;
  const tranRef = body.tran_ref ?? body.tranRef ?? body.payment_result?.tran_ref;

  if (!tranRef) {
    console.warn('[paytabs] callback without tran_ref:', JSON.stringify(body).slice(0, 300));
    return res.sendStatus(200); // ack so PayTabs stops retrying
  }

  try {
    const outcome = await applyPaymentResult(String(tranRef));
    console.log(`[paytabs] callback applied tran_ref=${tranRef} → ${outcome.status} (order ${outcome.orderId})`);
  } catch (e) {
    console.error('[paytabs] callback error:', (e as Error).message);
  }
  return res.sendStatus(200);
});

/* ─────────────────────────── GET|POST /return (browser redirect) ─────────────────────────── */

async function handleReturn(req: Request, res: Response) {
  const src = { ...(req.query as Record<string, any>), ...((req.body as Record<string, any>) ?? {}) };
  let tranRef = src.tranRef ?? src.tran_ref;
  const cartId = src.cartId ?? src.cart_id;

  let status: ApplyOutcome['status'] = 'unknown';
  // cart_id IS the order id (set to String(order.id) on create), so it's a safe,
  // unambiguous fallback for identifying the order on the redirect.
  let orderId: number | string | null = cartId ?? null;

  // PayTabs doesn't always echo tran_ref back on the browser redirect (e.g. a plain
  // GET return). When it's missing but we have the cart_id, recover the tran_ref from
  // the most recent payment for that order so we can still re-verify the real status
  // instead of leaving it 'unknown'.
  if (!tranRef && cartId != null) {
    const { data: payment } = await supabase
      .from('payments')
      .select('tran_ref')
      .eq('cart_id', String(cartId))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    tranRef = payment?.tran_ref ?? undefined;
  }

  if (tranRef) {
    try {
      const outcome = await applyPaymentResult(String(tranRef));
      status = outcome.status;
      orderId = outcome.orderId ?? orderId;
    } catch (e) {
      console.error('[paytabs] return error:', (e as Error).message);
    }
  }

  const frontend = (process.env.PAYTABS_FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (orderId != null) params.set('order_id', String(orderId));
  params.set('status', status);
  return res.redirect(302, `${frontend}/payment/paytabs/return?${params.toString()}`);
}

router.get('/return', handleReturn);
router.post('/return', handleReturn);

/* ─────────────────────────── GET /status (frontend result page) ─────────────────────────── */

router.get('/status', requireCustomer, async (req: Request, res: Response) => {
  const orderId = req.query.order_id as string | undefined;
  if (!orderId) return res.status(400).json({ ok: false, error: 'order_id is required' });

  // Verify ownership and fetch the latest payment for the order.
  const { data: order } = await supabase
    .from('orders')
    .select('id, user_id, status, payment_status')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  if (order.user_id !== req.authUserId) {
    return res.status(403).json({ ok: false, error: 'You do not own this order' });
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('id, tran_ref, status')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Re-verify with PayTabs (idempotent) so the page reflects the true outcome.
  if (payment?.tran_ref) {
    try {
      await applyPaymentResult(payment.tran_ref);
    } catch (e) {
      console.error('[paytabs] status re-verify error:', (e as Error).message);
    }
  }

  const { data: fresh } = await supabase
    .from('orders')
    .select('status, payment_status, total_price')
    .eq('id', orderId)
    .maybeSingle();

  return res.json({
    ok: true,
    order_id: Number(orderId),
    payment_status: fresh?.payment_status ?? order.payment_status ?? 'unpaid',
    order_status: fresh?.status ?? order.status ?? null,
    total_price: fresh?.total_price ?? null,
  });
});

export default router;
