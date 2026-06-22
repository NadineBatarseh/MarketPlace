/**
 * PayTabs Deposit & Payout client — Split Payout / vendor settlement.
 *
 * Thin wrapper around the PayTabs payout REST endpoints we need for the DEFERRED
 * settlement flow (see server/lib/settlementExecutor.ts):
 *   POST {BASE_URL}/payout/beneficiary/new  → register a vendor as a payout entity
 *   POST {BASE_URL}/payout/batch/new        → open a payout batch
 *   POST {BASE_URL}/payout/batch/add        → add one deposit request to a batch
 *   POST {BASE_URL}/payout/batch/close      → close a batch (triggers processing)
 *   POST {BASE_URL}/payout/batch/query      → read a batch's status for reconciliation
 *
 * Auth is the Server Key in the `authorization` header + `profile_id` in the body,
 * exactly like server/lib/paytabs.ts. This is server-to-server ONLY.
 *
 * ⚠️  COMPLIANCE: a vendor's IBAN passes through registerBeneficiary() in memory and
 *     is NEVER persisted or logged. Do NOT add console.log of request bodies here —
 *     log only the operation, status, entity_id and batch_id.
 *
 * ⚠️  Split Payout requires the PayTabs profile to be a PSP merchant with Deposit +
 *     Split Payout enabled and 2FA on. Confirm the exact endpoint paths / field names
 *     for your region against the PayTabs payout docs — THIS FILE is the single place
 *     that encodes them, so changes are localised here.
 */

export interface PaytabsPayoutConfig {
  profileId: number;
  serverKey: string;
  baseUrl: string;
  currency: string;
  country: string;
}

/** Read + validate PayTabs payout config from the environment. Throws if misconfigured. */
export function getPaytabsPayoutConfig(): PaytabsPayoutConfig {
  const profileId = Number(process.env.PAYTABS_PROFILE_ID);
  const serverKey = process.env.PAYTABS_SERVER_KEY ?? '';
  const baseUrl = (process.env.PAYTABS_BASE_URL ?? 'https://secure-global.paytabs.com').replace(/\/+$/, '');
  const currency = process.env.PAYTABS_CURRENCY ?? 'ILS';
  const country = process.env.PAYTABS_COUNTRY ?? 'PS';

  if (!profileId || Number.isNaN(profileId)) throw new Error('PAYTABS_PROFILE_ID is missing or invalid');
  if (!serverKey) throw new Error('PAYTABS_SERVER_KEY is missing');

  return { profileId, serverKey, baseUrl, currency, country };
}

/** POST helper — server-to-server, Server Key auth, JSON in/out. Never logs the body. */
async function paytabsPost(
  cfg: PaytabsPayoutConfig,
  pathSuffix: string,
  body: Record<string, unknown>,
  op: string,
): Promise<Record<string, any>> {
  const res = await fetch(`${cfg.baseUrl}${pathSuffix}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: cfg.serverKey },
    body: JSON.stringify({ profile_id: cfg.profileId, ...body }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    // ⚠️ TEMPORARY DEBUG — remove once payout onboarding works. Sanitized: never logs IBAN/account.
    console.log(
      `[PAYTABS-PAYOUT-DEBUG] ${op} ${cfg.baseUrl}${pathSuffix} → HTTP ${res.status}`,
      JSON.stringify(sanitizePayoutResponse(json)),
    );
    const detail = json?.message ?? json?.result ?? `HTTP ${res.status}`;
    throw new Error(`PayTabs payout ${op} failed: ${detail}`);
  }
  return json;
}

/** Strip anything that looks like a bank account / IBAN before we persist a raw response. */
export function sanitizePayoutResponse(raw: Record<string, any> | null | undefined): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {};
  const SENSITIVE = /(iban|account|swift|bic|bank_account|routing)/i;
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SENSITIVE.test(k)) continue;
    clean[k] = v && typeof v === 'object' && !Array.isArray(v) ? sanitizePayoutResponse(v) : v;
  }
  return clean;
}

/* ─────────────────────────── beneficiary registration ─────────────────────────── */

export interface RegisterBeneficiaryArgs {
  name: string;     // account holder name
  iban: string;     // raw IBAN — pass-through ONLY, never stored
  bankName?: string;
  country?: string;
}

/**
 * Register a vendor as a PayTabs payout beneficiary ("entity") and return the
 * entity_id we persist on the shop. The IBAN is sent to PayTabs and then dropped.
 */
export async function registerBeneficiary(
  cfg: PaytabsPayoutConfig,
  args: RegisterBeneficiaryArgs,
): Promise<{ entity_id: string; raw: Record<string, any> }> {
  const json = await paytabsPost(
    cfg,
    '/payout/beneficiary/new',
    {
      entity_name: args.name,
      beneficiary_name: args.name,
      iban: args.iban,
      bank_name: args.bankName || undefined,
      country: args.country || cfg.country,
      currency: cfg.currency,
    },
    'registerBeneficiary',
  );

  const entityId = json.entity_id ?? json.beneficiary_id ?? json.id;
  if (entityId === undefined || entityId === null || entityId === '') {
    throw new Error('PayTabs payout registerBeneficiary failed: no entity_id in response');
  }
  return { entity_id: String(entityId), raw: sanitizePayoutResponse(json) };
}

/* ─────────────────────────── batch lifecycle ─────────────────────────── */

/** Open a new payout batch. `idempotencyKey` guards against duplicate remote batches on retry. */
export async function createPayoutBatch(
  cfg: PaytabsPayoutConfig,
  args: { idempotencyKey: string; currency: string },
): Promise<{ paytabs_batch_id: string; raw: Record<string, any> }> {
  const json = await paytabsPost(
    cfg,
    '/payout/batch/new',
    { currency: args.currency, client_reference: args.idempotencyKey },
    'createPayoutBatch',
  );
  const batchId = json.batch_id ?? json.id;
  if (!batchId) throw new Error('PayTabs payout createPayoutBatch failed: no batch_id in response');
  return { paytabs_batch_id: String(batchId), raw: sanitizePayoutResponse(json) };
}

/** Add one deposit request (one vendor line) to an open batch. */
export async function addDepositRequest(
  cfg: PaytabsPayoutConfig,
  args: {
    paytabsBatchId: string;
    entityId: string;
    amount: number;
    currency: string;
    reference: string; // our `payout:<id>` — used to reconcile the line back to the ledger
  },
): Promise<{ deposit_ref: string; raw: Record<string, any> }> {
  const json = await paytabsPost(
    cfg,
    '/payout/batch/add',
    {
      batch_id: args.paytabsBatchId,
      entity_id: args.entityId,
      amount: Number(args.amount.toFixed(2)),
      currency: args.currency,
      client_reference: args.reference,
    },
    'addDepositRequest',
  );
  const depositRef = json.deposit_ref ?? json.request_id ?? json.id ?? args.reference;
  return { deposit_ref: String(depositRef), raw: sanitizePayoutResponse(json) };
}

/** Close a batch — PayTabs starts processing the deposits. */
export async function closePayoutBatch(
  cfg: PaytabsPayoutConfig,
  paytabsBatchId: string,
): Promise<{ raw: Record<string, any> }> {
  const json = await paytabsPost(
    cfg,
    '/payout/batch/close',
    { batch_id: paytabsBatchId },
    'closePayoutBatch',
  );
  return { raw: sanitizePayoutResponse(json) };
}

export interface PayoutDepositStatus {
  reference: string;            // echoes our client_reference (`payout:<id>`)
  status: string;              // PayTabs per-deposit status
  ref?: string;                // PayTabs's own deposit ref
}

/** Query a batch's status + per-deposit outcomes for reconciliation. */
export async function queryPayoutBatch(
  cfg: PaytabsPayoutConfig,
  paytabsBatchId: string,
): Promise<{ status: string; deposits: PayoutDepositStatus[]; raw: Record<string, any> }> {
  const json = await paytabsPost(
    cfg,
    '/payout/batch/query',
    { batch_id: paytabsBatchId },
    'queryPayoutBatch',
  );

  const rawDeposits: any[] = json.deposits ?? json.requests ?? [];
  const deposits: PayoutDepositStatus[] = rawDeposits.map((d) => ({
    reference: String(d.client_reference ?? d.reference ?? ''),
    status: String(d.status ?? ''),
    ref: d.deposit_ref ?? d.ref ?? undefined,
  }));

  return { status: String(json.status ?? ''), deposits, raw: sanitizePayoutResponse(json) };
}

/* ─────────────────────────── status helpers ─────────────────────────── */

/** True when a per-deposit status string represents a completed/paid transfer. */
export function isDepositPaid(status: string): boolean {
  return /^(paid|completed|success|deposited|settled|A)$/i.test(status.trim());
}

/** True when a per-deposit status string represents a terminal failure. */
export function isDepositFailed(status: string): boolean {
  return /^(failed|rejected|declined|cancelled|error|E)$/i.test(status.trim());
}
