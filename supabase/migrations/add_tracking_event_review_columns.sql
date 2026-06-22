-- Delivery feedback / dispute audit trail — extend order_tracking_events.
--
-- order_tracking_events stays the single audit trail for ALL delivery-related
-- actions (driver pickup/delivery, customer confirmation, customer delay
-- reports, admin resolution) — see "Why This Design" in the feature spec.
-- shipments.status remains the sole authority for the logistics workflow
-- (pending/available/delayed/batched/reserved/picked_up/delivered/stranded);
-- nothing here writes to it.
--
-- event_type classifies the row going forward. Existing rows (written via the
-- pre-existing `step` column: 'placed' on order creation, 'confirmed' on
-- PayTabs payment, 'collecting' when all shops mark ready) predate this
-- column and keep their `step` value untouched — they backfill to 'legacy'
-- via the DEFAULT below, so the 3 existing insert call sites (ordersRouter,
-- paytabsRouter, MerchantOrders.tsx) need no changes.
--
-- shipment_id is new too (not in the original 4-column list) — without it,
-- an event can't be tied to a specific product, which the admin "Delivery
-- Issues" view and the per-product customer actions both require. Nullable:
-- the legacy order-level events above never had a single shipment to point at.

alter table public.order_tracking_events
  add column if not exists event_type      text        not null default 'legacy',
  add column if not exists shipment_id     uuid        references public.shipments(id),
  add column if not exists requires_review boolean     not null default false,
  add column if not exists resolved_at     timestamptz,
  add column if not exists resolved_by     uuid;

create index if not exists order_tracking_events_shipment_id_idx
  on public.order_tracking_events (shipment_id);

-- Powers the admin "Delivery Issues" list: WHERE event_type = 'delay_reported'
-- AND requires_review = true.
create index if not exists order_tracking_events_unresolved_idx
  on public.order_tracking_events (event_type, requires_review)
  where requires_review;
