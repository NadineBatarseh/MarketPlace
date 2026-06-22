import supabase from './supabase';

/**
 * Insert a tracking event for an order.
 * Errors are silently swallowed so a tracking failure never breaks the main user flow.
 */
export async function insertTrackingEvent(
  orderId: number,
  step:
    | 'placed'
    | 'collecting'
    | 'handed_driver'
    | 'on_the_way'
    | 'delivered',
  triggeredBy: string,
  options?: { note?: string; location?: string }
) {
  try {
    await supabase.from('order_tracking_events').insert({
      order_id:     orderId,
      step,
      triggered_by: triggeredBy,
      note:         options?.note     ?? null,
      location:     options?.location ?? null,
    });
  } catch {
    // never crash the caller
  }
}

/**
 * Customer delivery-feedback actions (confirm received / report delay).
 *
 * Unlike insertTrackingEvent above, these go through server/routes/
 * customerTrackingEventsRouter.ts (behind requireCustomer) instead of writing
 * order_tracking_events directly — the gating conditions (ownership,
 * shipment.status, deadline check) must be enforced server-side to be a
 * trustworthy dispute audit trail.
 */
export interface TrackingActionResult {
  ok: boolean;
  error?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function postTrackingAction(path: string, body: Record<string, unknown>): Promise<TrackingActionResult> {
  try {
    const resp = await fetch(`/api/tracking-events${path}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) {
      return { ok: false, error: json.error ?? `Request failed (${resp.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export const confirmShipmentReceived = (shipmentId: string) =>
  postTrackingAction('/confirm-received', { shipment_id: shipmentId });

export const reportShipmentDelay = (shipmentId: string, note: string) =>
  postTrackingAction('/report-delay', { shipment_id: shipmentId, note });
