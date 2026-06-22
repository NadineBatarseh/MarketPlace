/**
 * PayTabs External Payouts client — vendor settlement.
 *
 * ⚠️  REWRITTEN to PayTabs' real External Payouts contract. The earlier version called a
 *     non-existent `/payout/beneficiary/new` "register beneficiary" endpoint and got
 *     HTTP 400 {"message":"Payout not enabled"}; PayTabs support confirmed it was the
 *     wrong endpoint. The real model:
 *
 *       POST {BASE_URL}/payout/batch/new   → create a batch; beneficiary bank details are
 *                                            sent INLINE in a `requests[]` array. Passing
 *                                            `close_batch:true` creates + closes in ONE call.
 *       POST {BASE_URL}/payout/batch/query → read a batch's per-request status (reconcile).
 *
 *     There is NO beneficiary pre-registration and NO entity_id. Each request line carries
 *     the raw IBAN (`beneficiary_account_number`). Because settlement runs days/weeks after
 *     onboarding, the IBAN is custodied encrypted in our DB (see server/lib/payoutCrypto.ts)
 *     and decrypted into these calls in memory only.
 *
 *     Docs: https://docs.paytabs.com/manuals/PT-API-Endpoints/Deposit-and-Payouts/External-Payouts/
 *
 * ⚠️  COMPLIANCE: the IBAN flows through createPayoutBatch() but is NEVER logged. Do NOT add
 *     console.log of request bodies here — only the operation, status, batch_id.
 *
 * ⚠️  VERIFY-WITH-PAYTABS before go-live (account-specific, not code-shape):
 *       • PAYTABS_DEPOSIT_ACCOUNT_ID (account_id) — your configured deposit account.
 *       • PAYOUT_TRANSFER_CODE (transfer_code) — required per-line code; example uses 100.
 *       • The region base URL (PS may differ from secure-global).
 *       • The exact query path ('/payout/batch/query') for your region.
 */

export interface PaytabsPayoutConfig {
  profileId: number;
  serverKey: string;
  baseUrl: string;
  currency: string;
  country: string;
  /** Configured PayTabs deposit account funds are paid out from. Required by /payout/batch/new. */
  accountId: number | null;
  /** Per-request transfer code (required). PayTabs example uses 100. Override via PAYOUT_TRANSFER_CODE. */
  transferCode: number;
  /** Platform identity stamped as the payout source (required per request line). */
  sourceName: string;
  sourceAddress1: string;
}

/** Read + validate PayTabs payout config from the environment. Throws if misconfigured. */
export function getPaytabsPayoutConfig(): PaytabsPayoutConfig {
  const profileId = Number(process.env.PAYTABS_PROFILE_ID);
  const serverKey = process.env.PAYTABS_SERVER_KEY ?? '';
  const baseUrl = (process.env.PAYTABS_BASE_URL ?? 'https://secure-global.paytabs.com').replace(/\/+$/, '');
  const currency = process.env.PAYTABS_CURRENCY ?? 'ILS';
  const country = process.env.PAYTABS_COUNTRY ?? 'PS';
  const accountIdRaw = process.env.PAYTABS_DEPOSIT_ACCOUNT_ID;
  const accountId = accountIdRaw ? Number(accountIdRaw) : null;
  const transferCode = Number(process.env.PAYOUT_TRANSFER_CODE ?? 100);
  const sourceName = process.env.PAYOUT_SOURCE_NAME ?? 'SOUQLINK';
  const sourceAddress1 = process.env.PAYOUT_SOURCE_ADDRESS1 ?? country;

  if (!profileId || Number.isNaN(profileId)) throw new Error('PAYTABS_PROFILE_ID is missing or invalid');
  if (!serverKey) throw new Error('PAYTABS_SERVER_KEY is missing');
  if (accountIdRaw && Number.isNaN(accountId)) throw new Error('PAYTABS_DEPOSIT_ACCOUNT_ID is invalid');

  return { profileId, serverKey, baseUrl, currency, country, accountId, transferCode, sourceName, sourceAddress1 };
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
    // Sanitized error log — never logs IBAN/account (request body is never logged at all).
    console.log(
      `[PAYTABS-PAYOUT] ${op} ${cfg.baseUrl}${pathSuffix} → HTTP ${res.status}`,
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
  const SENSITIVE = /(iban|account_number|swift|bic|bank_account|routing)/i;
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SENSITIVE.test(k)) continue;
    if (Array.isArray(v)) {
      clean[k] = v.map((item) =>
        item && typeof item === 'object' ? sanitizePayoutResponse(item) : item,
      );
    } else if (v && typeof v === 'object') {
      clean[k] = sanitizePayoutResponse(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/* ─────────────────────────── batch creation (one-shot) ─────────────────────────── */

/** One vendor payout line. The IBAN is pass-through ONLY — decrypted in memory, never logged. */
export interface PayoutBeneficiaryLine {
  reference: string;     // merchant_reference — our `payout:<id>`; the reconcile key
  amount: number;
  name: string;          // beneficiary_name (account holder)
  country: string;       // beneficiary_country — ISO Alpha-2
  iban: string;          // beneficiary_account_number — raw IBAN, pass-through only
  bank: string;          // beneficiary_bank
  bankBranch?: string;
  email?: string;
  mobile?: string;       // +(code)(number)
  address1?: string;
  address2?: string;
}

/**
 * Create (and, by default, close) a payout batch in a single call. Returns the remote
 * batch id we persist for reconciliation. Per PayTabs, beneficiary bank details ride
 * inline in `requests[]` — there is no separate add/close round-trip required.
 */
export async function createPayoutBatch(
  cfg: PaytabsPayoutConfig,
  args: { orderId: string; lines: PayoutBeneficiaryLine[]; closeBatch?: boolean },
): Promise<{ paytabs_batch_id: string; raw: Record<string, any> }> {
  const requests = args.lines.map((l) => ({
    merchant_reference: l.reference,
    amount: Number(l.amount.toFixed(2)),
    beneficiary_name: l.name,
    beneficiary_country: l.country,
    beneficiary_account_number: l.iban,
    beneficiary_bank: l.bank,
    beneficiary_bank_branch: l.bankBranch ?? '',
    beneficiary_email: l.email ?? '',
    beneficiary_mobile_number: l.mobile ?? '',
    beneficiary_address1: l.address1 ?? '',
    beneficiary_address2: l.address2 ?? '',
    source_name: cfg.sourceName,
    source_address1: cfg.sourceAddress1,
    transfer_code: cfg.transferCode,
  }));

  const json = await paytabsPost(
    cfg,
    '/payout/batch/new',
    {
      account_id: cfg.accountId ?? undefined,
      order_id: args.orderId,
      requests,
      close_batch: args.closeBatch ?? true,
    },
    'createPayoutBatch',
  );

  const batchId = json.batch_id ?? json.id;
  if (!batchId) throw new Error('PayTabs payout createPayoutBatch failed: no batch_id in response');
  return { paytabs_batch_id: String(batchId), raw: sanitizePayoutResponse(json) };
}

/* ─────────────────────────── reconciliation ─────────────────────────── */

export interface PayoutRequestStatus {
  reference: string;     // echoes our merchant_reference (`payout:<id>`)
  status: string;        // PayTabs per-request status
  ref?: string;          // PayTabs's own request/transfer ref
}

/** Query a batch's per-request outcomes for reconciliation. */
export async function queryPayoutBatch(
  cfg: PaytabsPayoutConfig,
  paytabsBatchId: string,
): Promise<{ status: string; requests: PayoutRequestStatus[]; raw: Record<string, any> }> {
  const json = await paytabsPost(
    cfg,
    '/payout/batch/query',
    { batch_id: paytabsBatchId },
    'queryPayoutBatch',
  );

  const rawRequests: any[] = json.requests ?? json.deposits ?? [];
  const requests: PayoutRequestStatus[] = rawRequests.map((r) => ({
    reference: String(r.merchant_reference ?? r.reference ?? r.client_reference ?? ''),
    status: String(r.status ?? ''),
    ref: r.payout_ref ?? r.request_id ?? r.ref ?? undefined,
  }));

  return { status: String(json.status ?? ''), requests, raw: sanitizePayoutResponse(json) };
}

/* ─────────────────────────── status helpers ─────────────────────────── */

/** True when a per-request status string represents a completed/paid transfer. */
export function isDepositPaid(status: string): boolean {
  return /^(paid|completed|processed|success|deposited|settled|done|A)$/i.test(status.trim());
}

/** True when a per-request status string represents a terminal failure. */
export function isDepositFailed(status: string): boolean {
  return /^(failed|rejected|declined|cancelled|canceled|returned|reversed|error|E)$/i.test(status.trim());
}
