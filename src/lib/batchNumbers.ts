import supabase from './supabase';

/**
 * Resolve display batch codes (e.g. "B-100045") for a set of shipment ids via
 * POST /api/orders/batch-numbers. The `batches` table itself is never queried
 * directly from customer/merchant clients — it carries route-planning data for
 * other shops'/customers' shipments too, so this server endpoint hands back
 * only the display code for shipment ids the caller already has.
 *
 * Returns {} on any failure so a lookup hiccup never blocks the page that's
 * rendering shipment info — the batch number is a nice-to-have label, not
 * load-bearing data.
 */
export async function fetchBatchNumbers(shipmentIds: string[]): Promise<Record<string, string>> {
  if (shipmentIds.length === 0) return {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return {};

    const resp = await fetch('/api/orders/batch-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shipment_ids: shipmentIds }),
    });
    const json = await resp.json().catch(() => ({}));
    return resp.ok && json.ok ? (json.batchNumbers ?? {}) : {};
  } catch {
    return {};
  }
}
