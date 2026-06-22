/**
 * Vendor settlement executor — the engine of the DEFERRED Split Payout flow.
 *
 * Source of truth is the existing `payouts` ledger (written at payment time by
 * createPayoutRecords() in server/routes/paytabsRouter.ts). This module releases a
 * shop's share once its shipments are delivered + the return window has elapsed
 * (stamped onto payouts.settle_eligible_at by the deliver-shipment hook).
 *
 * runSettlementSweep() is the single entry point — called by the interval scheduler,
 * the admin POST /run endpoint, and (indirectly) reconciliation. It is idempotent and
 * safe to run concurrently:
 *   1. select eligible 'shop' payouts (pending, eligible, unclaimed, amount > 0)
 *   2. create a settlement_batches row, then ATOMICALLY claim those payouts with a
 *      guarded UPDATE (status='pending' AND settlement_batch_id IS NULL). Only rows the
 *      UPDATE returns proceed → a payout can belong to exactly one batch (anti-double-pay).
 *   3. open a PayTabs payout batch, add one deposit per claimed payout, close it
 *   4. reconcile per-deposit outcomes back onto the ledger (pending→…→paid|failed)
 *
 * Excluded by design this phase: 'courier' and 'platform' payouts (couriers aren't
 * PayTabs beneficiaries; 'platform' is our own commission, already in our account).
 */
import { supabase } from '../supabase.js';
import {
  getPaytabsPayoutConfig,
  createPayoutBatch,
  queryPayoutBatch,
  sanitizePayoutResponse,
  isDepositPaid,
  isDepositFailed,
  type PaytabsPayoutConfig,
  type PayoutBeneficiaryLine,
} from './paytabsPayout.js';
import { decryptSecret } from './payoutCrypto.js';
import { PC, loadPaymentConfig } from './paymentConfig.js';

/** A shop's decrypted payout destination, ready to become a batch request line. */
interface ShopBeneficiary {
  name: string;
  country: string;
  iban: string;
  bank: string;
  bankBranch?: string;
  email?: string;
  mobile?: string;
  address1?: string;
}

export interface SettlementSummary {
  batch_id: string | null;       // our settlement_batches.id (null when nothing to do)
  paytabs_batch_id: string | null;
  claimed: number;               // payout lines submitted to PayTabs
  skipped: number;               // eligible-but-unpayable (no active beneficiary)
  total_amount: number;
  currency: string | null;
  status: string;                // 'noop' | 'submitted' | 'failed'
}

/** A payout row joined with its shop's beneficiary reference. */
interface EligiblePayout {
  id: string;
  amount: number;
  currency: string;
  payee_id: string;              // shop_id
  attempts: number;
}

/* ─────────────────────────── the sweep ─────────────────────────── */

export async function runSettlementSweep(
  opts: { triggeredBy?: string | null } = {},
): Promise<SettlementSummary> {
  // DEFERRED SETTLEMENT RETIRED (2026-06-23): vendor payouts now happen at pay-in via
  // PayTabs Split Payout (see server/routes/paytabsRouter.ts). This sweep would call the
  // External Payouts API the account doesn't have enabled ("Payout not enabled"), and
  // could otherwise double-pay leftover eligible rows from earlier testing. Hard-disabled.
  void opts;
  return { batch_id: null, paytabs_batch_id: null, claimed: 0, skipped: 0, total_amount: 0, currency: null, status: 'noop' };

  // eslint-disable-next-line no-unreachable
  const nowIso = new Date().toISOString();

  // Refresh admin-editable knobs (max attempts, etc.) before each sweep.
  await loadPaymentConfig();

  // 1. Candidate shop payouts: due, unclaimed, payable.
  const { data: candidates, error: selErr } = await supabase
    .from('payouts')
    .select('id, amount, currency, payee_id, attempts')
    .eq('payee_type', 'shop')
    .eq('status', 'pending')
    .is('settlement_batch_id', null)
    .not('settle_eligible_at', 'is', null)
    .lte('settle_eligible_at', nowIso)
    .gt('amount', 0)
    .lt('attempts', PC.settlementMaxAttempts);

  if (selErr) throw new Error(`settlement select failed: ${selErr.message}`);
  if (!candidates || candidates.length === 0) {
    return { batch_id: null, paytabs_batch_id: null, claimed: 0, skipped: 0, total_amount: 0, currency: null, status: 'noop' };
  }

  // 2. Split into payable (shop has active, decryptable bank details) vs not.
  const shopIds = [...new Set(candidates.map((c) => c.payee_id).filter(Boolean))] as string[];
  const { data: shops } = await supabase
    .from('shops')
    .select('shop_id, payout_onboarding_status, payout_iban_enc, payout_beneficiary_name, payout_bank_name, payout_bank_branch, payout_country, payout_email, payout_mobile, payout_address1')
    .in('shop_id', shopIds);

  const beneficiaryByShop = new Map<string, ShopBeneficiary>();
  for (const s of shops ?? []) {
    if (s.payout_onboarding_status !== 'active' || !s.payout_iban_enc) continue;
    // A line missing the minimally-required beneficiary fields (or that fails to decrypt)
    // is left unpayable rather than risking a whole-batch rejection at PayTabs.
    if (!s.payout_beneficiary_name || !s.payout_bank_name || !s.payout_country) continue;
    let iban: string;
    try {
      iban = decryptSecret(s.payout_iban_enc);
    } catch (e) {
      console.error(`[settlement] IBAN decrypt failed for shop ${s.shop_id}:`, (e as Error).message);
      continue;
    }
    beneficiaryByShop.set(s.shop_id, {
      name: s.payout_beneficiary_name,
      country: s.payout_country,
      iban,
      bank: s.payout_bank_name,
      bankBranch: s.payout_bank_branch ?? undefined,
      email: s.payout_email ?? undefined,
      mobile: s.payout_mobile ?? undefined,
      address1: s.payout_address1 ?? undefined,
    });
  }

  const payable = candidates.filter((c) => c.payee_id && beneficiaryByShop.has(c.payee_id)) as EligiblePayout[];
  const unpayable = candidates.filter((c) => !c.payee_id || !beneficiaryByShop.has(c.payee_id));

  // Mark eligible-but-unpayable lines 'skipped' so they don't churn every tick.
  // (They're picked up automatically once the shop completes onboarding — a future
  //  re-queue can reset skipped→pending; left as a manual/admin action for now.)
  if (unpayable.length > 0) {
    await supabase
      .from('payouts')
      .update({ status: 'skipped', failure_reason: 'no_active_beneficiary' })
      .in('id', unpayable.map((u) => u.id));
  }

  if (payable.length === 0) {
    return { batch_id: null, paytabs_batch_id: null, claimed: 0, skipped: unpayable.length, total_amount: 0, currency: null, status: 'noop' };
  }

  const currency = payable[0].currency || (process.env.PAYTABS_CURRENCY ?? 'ILS');

  // 3. Create the local batch row first (its id is the claim token + idempotency key).
  const idempotencyKey = `sweep:${nowIso}:${payable.length}`;
  const { data: batchRow, error: batchErr } = await supabase
    .from('settlement_batches')
    .insert({
      status: 'creating',
      currency,
      idempotency_key: idempotencyKey,
      created_by: opts.triggeredBy ?? null,
    })
    .select('id')
    .single();

  if (batchErr || !batchRow) throw new Error(`settlement batch insert failed: ${batchErr?.message}`);
  const batchId = batchRow.id as string;

  // 4. ATOMIC CLAIM — only rows still pending & unclaimed are taken by THIS batch.
  //    Two overlapping sweeps cannot both claim a row (the WHERE guards on status +
  //    settlement_batch_id IS NULL). Rows returned here are the authoritative work set.
  const { data: claimedRows, error: claimErr } = await supabase
    .from('payouts')
    .update({ status: 'queued', settlement_batch_id: batchId })
    .in('id', payable.map((p) => p.id))
    .eq('status', 'pending')
    .is('settlement_batch_id', null)
    .select('id, amount, currency, payee_id, attempts');

  if (claimErr) throw new Error(`settlement claim failed: ${claimErr.message}`);
  const claimed = (claimedRows ?? []) as EligiblePayout[];

  if (claimed.length === 0) {
    // Another run claimed them first — release our empty batch.
    await supabase.from('settlement_batches').update({ status: 'cancelled' }).eq('id', batchId);
    return { batch_id: batchId, paytabs_batch_id: null, claimed: 0, skipped: unpayable.length, total_amount: 0, currency, status: 'noop' };
  }

  // Bump attempts on the claimed lines (retry accounting).
  await Promise.all(
    claimed.map((c) =>
      supabase.from('payouts').update({ attempts: (c.attempts ?? 0) + 1 }).eq('id', c.id),
    ),
  );

  const totalAmount = Math.round(claimed.reduce((s, c) => s + Number(c.amount), 0) * 100) / 100;

  // 5. Submit to PayTabs: open → add deposits → close.
  let cfg: PaytabsPayoutConfig;
  try {
    cfg = getPaytabsPayoutConfig();
  } catch (e) {
    await failBatch(batchId, claimed, (e as Error).message);
    return { batch_id: batchId, paytabs_batch_id: null, claimed: 0, skipped: unpayable.length, total_amount: 0, currency, status: 'failed' };
  }

  // Build one request line per claimed payout. merchant_reference='payout:<id>' makes
  // reconciliation deterministic. The IBAN is decrypted in memory here and never logged.
  const lines: PayoutBeneficiaryLine[] = claimed.map((line) => {
    const b = beneficiaryByShop.get(line.payee_id)!;
    return {
      reference: `payout:${line.id}`,
      amount: Number(line.amount),
      name: b.name,
      country: b.country,
      iban: b.iban,
      bank: b.bank,
      bankBranch: b.bankBranch,
      email: b.email,
      mobile: b.mobile,
      address1: b.address1,
    };
  });

  // Create + close the batch in ONE call (PayTabs External Payouts). If it throws, the
  // whole batch failed — release the claimed lines for a later retry. Per-line outcomes
  // (e.g. a single rejected transfer) surface later via reconcileBatch().
  let paytabsBatchId: string;
  try {
    const created = await createPayoutBatch(cfg, { orderId: batchId, lines, closeBatch: true });
    paytabsBatchId = created.paytabs_batch_id;
    await supabase
      .from('payouts')
      .update({ status: 'submitted', failure_reason: null })
      .in('id', claimed.map((c) => c.id));
    await supabase
      .from('settlement_batches')
      .update({
        paytabs_batch_id: paytabsBatchId,
        status: 'closed',
        payout_count: claimed.length,
        total_amount: totalAmount,
        closed_at: new Date().toISOString(),
        paytabs_response: created.raw,
      })
      .eq('id', batchId);
  } catch (e) {
    await failBatch(batchId, claimed, (e as Error).message);
    return { batch_id: batchId, paytabs_batch_id: null, claimed: 0, skipped: unpayable.length, total_amount: 0, currency, status: 'failed' };
  }

  // 6. Best-effort immediate reconcile (also re-runnable later via reconcileBatch).
  try {
    await reconcileBatch(batchId);
  } catch (e) {
    console.error('[settlement] immediate reconcile failed:', (e as Error).message);
  }

  return {
    batch_id: batchId,
    paytabs_batch_id: paytabsBatchId,
    claimed: claimed.length,
    skipped: unpayable.length,
    total_amount: totalAmount,
    currency,
    status: 'submitted',
  };
}

/** Roll a batch back to failed and release its claimed lines so a later sweep can retry. */
async function failBatch(batchId: string, claimed: EligiblePayout[], error: string): Promise<void> {
  await supabase
    .from('payouts')
    .update({ status: 'pending', settlement_batch_id: null, failure_reason: error })
    .in('id', claimed.map((c) => c.id))
    .eq('settlement_batch_id', batchId);
  await supabase.from('settlement_batches').update({ status: 'failed', error }).eq('id', batchId);
}

/* ─────────────────────────── reconciliation ─────────────────────────── */

/**
 * Re-query a PayTabs batch and apply per-deposit outcomes to the ledger.
 * Idempotent: safe to call repeatedly until every line is terminal.
 */
export async function reconcileBatch(batchId: string): Promise<{ paid: number; failed: number; pending: number }> {
  const { data: batch } = await supabase
    .from('settlement_batches')
    .select('id, paytabs_batch_id, status')
    .eq('id', batchId)
    .maybeSingle();

  if (!batch?.paytabs_batch_id) return { paid: 0, failed: 0, pending: 0 };

  const cfg = getPaytabsPayoutConfig();
  const result = await queryPayoutBatch(cfg, batch.paytabs_batch_id);

  // Map our reference (`payout:<id>`) → outcome.
  let paid = 0, failed = 0, pending = 0;
  for (const reqStatus of result.requests) {
    const m = /^payout:(.+)$/.exec(reqStatus.reference);
    if (!m) continue;
    const payoutId = m[1];

    if (isDepositPaid(reqStatus.status)) {
      await supabase
        .from('payouts')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paytabs_payout_ref: reqStatus.ref ?? undefined, failure_reason: null })
        .eq('id', payoutId)
        .neq('status', 'paid');
      paid++;
    } else if (isDepositFailed(reqStatus.status)) {
      await supabase
        .from('payouts')
        .update({ status: 'failed', failure_reason: `PayTabs payout ${reqStatus.status}` })
        .eq('id', payoutId);
      failed++;
    } else {
      pending++;
    }
  }

  // When nothing is still pending, the batch is fully reconciled.
  const fields: Record<string, unknown> = { paytabs_response: sanitizePayoutResponse(result.raw) };
  if (pending === 0) {
    fields.status = 'completed';
    fields.completed_at = new Date().toISOString();
  }
  await supabase.from('settlement_batches').update(fields).eq('id', batchId);

  return { paid, failed, pending };
}

/* ─────────────────────────── scheduler ─────────────────────────── */

/**
 * Run the settlement sweep on an interval (in-process). Also re-polls any open/closed
 * batches that haven't finished reconciling. Mirrors the setInterval pattern used by
 * the logistics background jobs. NOTE: on Vercel/serverless this interval does NOT run —
 * drive settlement there via the admin POST /api/payments/payouts/run endpoint instead.
 */
export function startSettlementScheduler(intervalMinutes = 15): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runSettlementSweep({ triggeredBy: null });
      if (summary.claimed > 0 || summary.skipped > 0) {
        console.log(`[settlement] sweep → claimed=${summary.claimed} skipped=${summary.skipped} total=${summary.total_amount} ${summary.currency ?? ''}`);
      }
      await reconcileOpenBatches();
    } catch (e) {
      console.error('[settlement] scheduler tick error:', (e as Error).message);
    } finally {
      running = false;
    }
  };
  setInterval(tick, intervalMinutes * 60_000);
  console.log(`[settlement] scheduler started (every ${intervalMinutes} min).`);
}

/** Re-poll every batch still awaiting per-deposit outcomes. */
export async function reconcileOpenBatches(): Promise<void> {
  const { data: batches } = await supabase
    .from('settlement_batches')
    .select('id')
    .in('status', ['open', 'closed']);
  for (const b of batches ?? []) {
    try {
      await reconcileBatch(b.id);
    } catch (e) {
      console.error(`[settlement] reconcile batch ${b.id} failed:`, (e as Error).message);
    }
  }
}
