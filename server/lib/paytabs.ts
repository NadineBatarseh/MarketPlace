/**
 * PayTabs Hosted Payment Page client — Phase 1 (Test Mode).
 *
 * Thin wrapper around the two PayTabs REST endpoints we need:
 *   POST {BASE_URL}/payment/request  → create a Hosted Payment Page
 *   POST {BASE_URL}/payment/query    → authoritatively read a transaction's status
 *
 * Auth is the Server Key in the `authorization` header (PayTabs server-to-server).
 * The Client Key is only used by PayTabs' browser SDK, so we expose it for the
 * frontend but never send it from here.
 *
 * Docs: https://support.paytabs.com/en/support/solutions/articles/60000711358
 */

export interface PaytabsConfig {
  profileId: number;
  serverKey: string;
  clientKey: string;
  baseUrl: string;
  returnUrl: string;
  callbackUrl: string;
  currency: string;
  country: string;
}

/** Read + validate PayTabs config from the environment. Throws if misconfigured. */
export function getPaytabsConfig(): PaytabsConfig {
  const profileId = Number(process.env.PAYTABS_PROFILE_ID);
  const serverKey = process.env.PAYTABS_SERVER_KEY ?? '';
  const clientKey = process.env.PAYTABS_CLIENT_KEY ?? '';
  const baseUrl = (process.env.PAYTABS_BASE_URL ?? 'https://secure-global.paytabs.com').replace(/\/+$/, '');
  const returnUrl = process.env.PAYTABS_RETURN_URL ?? '';
  const callbackUrl = process.env.PAYTABS_CALLBACK_URL ?? '';
  const currency = process.env.PAYTABS_CURRENCY ?? 'ILS';
  const country = process.env.PAYTABS_COUNTRY ?? 'PS';

  if (!profileId || Number.isNaN(profileId)) throw new Error('PAYTABS_PROFILE_ID is missing or invalid');
  if (!serverKey) throw new Error('PAYTABS_SERVER_KEY is missing');

  return { profileId, serverKey, clientKey, baseUrl, returnUrl, callbackUrl, currency, country };
}

export interface CustomerDetails {
  name?: string;
  email?: string;
  phone?: string;
  street1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/**
 * PayTabs rejects non-public server-to-server callback URLs (e.g. localhost) with
 * "Invalid Callback URL". Returns the URL only when it's publicly reachable, else
 * undefined so we omit it — in dev, the return page's /status call re-verifies.
 */
function publicUrlOrUndefined(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local');
    return isLocal ? undefined : url;
  } catch {
    return undefined;
  }
}

export interface CreatePaymentArgs {
  cartId: string;          // our order id (as string)
  amount: number;          // authoritative total computed server-side
  description: string;
  customer: CustomerDetails;
}

export interface PaytabsCreateResponse {
  tran_ref?: string;
  redirect_url?: string;
  // PayTabs returns many more fields; keep the raw object for storage/debugging.
  [key: string]: unknown;
}

/** Create a Hosted Payment Page. Returns the parsed PayTabs response (tran_ref + redirect_url). */
export async function createHostedPayment(
  cfg: PaytabsConfig,
  args: CreatePaymentArgs,
): Promise<PaytabsCreateResponse> {
  const body = {
    profile_id: cfg.profileId,
    tran_type: 'sale',
    tran_class: 'ecom',
    cart_id: args.cartId,
    cart_description: args.description,
    cart_currency: cfg.currency,
    cart_amount: Number(args.amount.toFixed(2)),
    // PayTabs rejects localhost callbacks — omit when not public (dev verifies via /status).
    callback: publicUrlOrUndefined(cfg.callbackUrl),
    return: cfg.returnUrl || undefined,
    customer_details: {
      name: args.customer.name || 'SOUQLINK Customer',
      email: args.customer.email || undefined,
      phone: args.customer.phone || undefined,
      street1: args.customer.street1 || undefined,
      city: args.customer.city || undefined,
      state: args.customer.state || undefined,
      zip: args.customer.zip || undefined,
      country: args.customer.country || cfg.country,
    },
  };

  const res = await fetch(`${cfg.baseUrl}/payment/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: cfg.serverKey },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as PaytabsCreateResponse;
  if (!res.ok || !json.redirect_url) {
    const detail = (json as any)?.message ?? (json as any)?.result ?? `HTTP ${res.status}`;
    throw new Error(`PayTabs create failed: ${detail}`);
  }
  return json;
}

export interface PaytabsQueryResponse {
  tran_ref?: string;
  cart_id?: string;
  cart_amount?: string;
  cart_currency?: string;
  payment_result?: {
    response_status?: string;  // 'A' = Authorised/Approved
    response_code?: string;
    response_message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Query a transaction by tran_ref to get its authoritative status.
 * We always re-verify with this instead of trusting the (un-signed) redirect/IPN body.
 */
export async function queryTransaction(
  cfg: PaytabsConfig,
  tranRef: string,
): Promise<PaytabsQueryResponse> {
  const res = await fetch(`${cfg.baseUrl}/payment/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: cfg.serverKey },
    body: JSON.stringify({ profile_id: cfg.profileId, tran_ref: tranRef }),
  });

  const json = (await res.json().catch(() => ({}))) as PaytabsQueryResponse;
  if (!res.ok) {
    const detail = (json as any)?.message ?? `HTTP ${res.status}`;
    throw new Error(`PayTabs query failed: ${detail}`);
  }
  return json;
}

/** True when a PayTabs payment_result represents a successful (authorised) charge. */
export function isApproved(result: PaytabsQueryResponse | undefined | null): boolean {
  const status = result?.payment_result?.response_status;
  return status === 'A';
}
