// order_tracking_events.event_type — the audit-trail classifier for all
// delivery-related actions (driver, customer, admin). See
// supabase/migrations/add_tracking_event_review_columns.sql.
//
// 'legacy' is the backfill default for rows written before this column
// existed (via the pre-existing `step` column: 'placed'/'confirmed'/
// 'collecting') — new code never writes it.
export type TrackingEventType =
  | 'legacy'
  | 'driver_picked_up'
  | 'driver_delivered'
  | 'customer_confirmed'
  | 'delay_reported'
  | 'admin_resolved';

/**
 * Event types that surface as a customer-facing "new update" notification
 * (orders icon badge, order-card badge, tracking-page banner) — see
 * supabase/migrations/add_tracking_event_customer_seen_at.sql.
 *
 * 'delay_reported' is deliberately excluded — the customer created it
 * themselves, there's nothing new to tell them. 'admin_resolved' is the
 * actual response to their report.
 */
export const CUSTOMER_NOTIFICATION_EVENT_TYPES: TrackingEventType[] = [
  'driver_delivered',
  'customer_confirmed',
  'admin_resolved',
];
