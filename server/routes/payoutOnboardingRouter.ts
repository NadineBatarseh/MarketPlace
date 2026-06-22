import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { getPaytabsPayoutConfig, registerBeneficiary } from '../lib/paytabsPayout.js';

/**
 * Vendor payout onboarding — merchant self-serve (mounted /api/payments/payout-onboarding).
 *
 *   GET  /status    → onboarding state for the caller's shop (never returns an IBAN)
 *   POST /register  → validate IBAN, register the beneficiary with PayTabs, store the
 *                     returned entity_id. The raw IBAN is pass-through ONLY — it is never
 *                     written to the DB and never logged (only iban_last4 is kept).
 *
 * Auth: requireCustomer resolves req.authUserId; we then resolve the caller's shop via
 * the established chain auth.users → merchants(user_id) → shops(merchant_id).
 */
const router = Router();

/** Resolve the shop owned by the authenticated merchant (null if none). */
async function resolveOwnShop(userId: string) {
  const { data } = await supabase
    .from('shops')
    .select('shop_id, paytabs_entity_id, payout_onboarding_status, payout_beneficiary_name, iban_last4, payout_onboarded_at, payout_onboarding_error, merchants!inner(user_id)')
    .eq('merchants.user_id', userId)
    .maybeSingle();
  return data;
}

/* ─────────────────────────── IBAN validation (server-side) ─────────────────────────── */

// IBAN length per country code (ISO 13616). Covers the markets SOUQLINK serves + common ones.
const IBAN_LENGTHS: Record<string, number> = {
  PS: 29, IL: 23, JO: 30, SA: 24, AE: 23, EG: 29, QA: 29, KW: 30, BH: 22,
  OM: 23, LB: 28, TR: 26, GB: 22, DE: 22, FR: 27, NL: 18, ES: 24, IT: 27,
};

/**
 * Validate an IBAN: structure, known country length, and the ISO 7064 mod-97 checksum.
 * Returns the normalised (uppercase, no spaces) IBAN or null when invalid.
 */
function validateIban(input: string): string | null {
  const iban = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban)) return null;

  const country = iban.slice(0, 2);
  const expectedLen = IBAN_LENGTHS[country];
  if (expectedLen && iban.length !== expectedLen) return null;

  // mod-97: move the first 4 chars to the end, convert letters to numbers, check ≡ 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // Compute mod 97 over the long numeric string in chunks (avoids BigInt overflow).
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
  }
  return remainder === 1 ? iban : null;
}

/* ─────────────────────────── GET /status ─────────────────────────── */

router.get('/status', requireCustomer, async (req: Request, res: Response) => {
  const shop = await resolveOwnShop(req.authUserId!);
  if (!shop) return res.status(403).json({ ok: false, error: 'You do not own a shop' });

  return res.json({
    ok: true,
    shop_id: shop.shop_id,
    status: shop.payout_onboarding_status ?? 'not_started',
    has_beneficiary: !!shop.paytabs_entity_id,
    beneficiary_name: shop.payout_beneficiary_name ?? null,
    iban_last4: shop.iban_last4 ?? null,
    onboarded_at: shop.payout_onboarded_at ?? null,
    error: shop.payout_onboarding_error ?? null,
  });
});

/* ─────────────────────────── POST /register ─────────────────────────── */

router.post('/register', requireCustomer, async (req: Request, res: Response) => {
  const { account_holder_name, iban, bank_name } = req.body as {
    account_holder_name?: string;
    iban?: string;
    bank_name?: string;
  };

  if (!account_holder_name?.trim()) {
    return res.status(400).json({ ok: false, error: 'account_holder_name is required' });
  }
  if (!iban?.trim()) {
    return res.status(400).json({ ok: false, error: 'iban is required' });
  }

  // 1. Validate the IBAN BEFORE any network call (fast feedback, no malformed data leaves us).
  const normalisedIban = validateIban(iban);
  if (!normalisedIban) {
    return res.status(400).json({ ok: false, error: 'Invalid IBAN (failed format or checksum)' });
  }

  // 2. Resolve the caller's shop.
  const shop = await resolveOwnShop(req.authUserId!);
  if (!shop) return res.status(403).json({ ok: false, error: 'You do not own a shop' });

  // 3. Already onboarded → require an explicit replace flow (changing a payout destination
  //    is sensitive). Keep it a no-op here rather than silently re-registering.
  if (shop.paytabs_entity_id && shop.payout_onboarding_status === 'active') {
    return res.status(409).json({
      ok: false,
      error: 'A payout beneficiary is already active for this shop. Contact support to change bank details.',
    });
  }

  let cfg;
  try {
    cfg = getPaytabsPayoutConfig();
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }

  // 4. Mark pending, then register with PayTabs.
  await supabase
    .from('shops')
    .update({ payout_onboarding_status: 'pending', payout_onboarding_error: null })
    .eq('shop_id', shop.shop_id);

  let entityId: string;
  try {
    const result = await registerBeneficiary(cfg, {
      name: account_holder_name.trim(),
      iban: normalisedIban,          // pass-through; discarded after this call
      bankName: bank_name?.trim() || undefined,
    });
    entityId = result.entity_id;
  } catch (e) {
    const msg = (e as Error).message;
    await supabase
      .from('shops')
      .update({ payout_onboarding_status: 'rejected', payout_onboarding_error: msg })
      .eq('shop_id', shop.shop_id);
    return res.status(502).json({ ok: false, error: msg });
  }

  // 5. Persist ONLY the non-sensitive reference. The raw IBAN is intentionally discarded.
  const iban_last4 = normalisedIban.slice(-4);
  const { error: updErr } = await supabase
    .from('shops')
    .update({
      paytabs_entity_id: entityId,
      payout_beneficiary_name: account_holder_name.trim(),
      iban_last4,
      payout_onboarding_status: 'active',
      payout_onboarded_at: new Date().toISOString(),
      payout_onboarding_error: null,
    })
    .eq('shop_id', shop.shop_id);

  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  return res.json({ ok: true, status: 'active', iban_last4 });
});

/* ─────────────────────────── GET /payouts (merchant earnings) ─────────────────────────── */

// Bucket each payout status into the three summary totals shown on the earnings page.
const PENDING_STATUSES = new Set(['pending', 'queued']);
const IN_PROCESS_STATUSES = new Set(['submitted']);

router.get('/payouts', requireCustomer, async (req: Request, res: Response) => {
  const shop = await resolveOwnShop(req.authUserId!);
  if (!shop) return res.status(403).json({ ok: false, error: 'You do not own a shop' });

  // Read server-side with the service-role client — the payouts table is not client-readable.
  const { data: rows, error } = await supabase
    .from('payouts')
    .select('id, order_id, amount, currency, status, settle_eligible_at, paid_at, failure_reason, created_at')
    .eq('payee_type', 'shop')
    .eq('payee_id', shop.shop_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const payouts = rows ?? [];
  let paid_total = 0, pending_total = 0, in_process_total = 0;
  for (const p of payouts) {
    const amt = Number(p.amount ?? 0);
    if (p.status === 'paid') paid_total += amt;
    else if (PENDING_STATUSES.has(p.status)) pending_total += amt;
    else if (IN_PROCESS_STATUSES.has(p.status)) in_process_total += amt;
  }
  const round = (n: number) => Math.round(n * 100) / 100;

  return res.json({
    ok: true,
    summary: {
      paid_total: round(paid_total),
      pending_total: round(pending_total),
      in_process_total: round(in_process_total),
      currency: payouts[0]?.currency ?? (process.env.PAYTABS_CURRENCY ?? 'ILS'),
    },
    onboarding_status: shop.payout_onboarding_status ?? 'not_started',
    payouts,
  });
});

export default router;
