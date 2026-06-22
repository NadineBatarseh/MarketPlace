-- Customer-facing "new update" notification badge (orders icon + order cards).
--
-- customer_seen_at is the read/unread marker for order_tracking_events, scoped
-- only to customer-visible events (driver_delivered, customer_confirmed,
-- admin_resolved — see shared/trackingEvents.ts CUSTOMER_NOTIFICATION_EVENT_TYPES).
-- NULL = unread. Set when the customer opens that order's tracking page.
--
-- This is purely a visibility flag for the customer UI — does not affect
-- shipments.status or orders.status.

alter table public.order_tracking_events
  add column if not exists customer_seen_at timestamptz;

-- Powers "count unread events for this customer's orders" queries.
create index if not exists order_tracking_events_unseen_idx
  on public.order_tracking_events (order_id, event_type)
  where customer_seen_at is null;
