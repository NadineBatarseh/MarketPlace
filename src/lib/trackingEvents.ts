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
    | 'arrived_hub'
    | 'packing'
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
