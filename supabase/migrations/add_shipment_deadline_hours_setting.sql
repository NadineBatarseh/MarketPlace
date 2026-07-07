-- batch_config: admin-configurable shipment delivery deadline ────────────────
-- Hours from shipment creation until its delivery deadline — drives the
-- customer-facing ETA on the order tracking page and the batching engine's
-- urgency scoring (server/logistics/formulas.ts). Previously hardcoded via the
-- SHIPMENT_DEADLINE_HOURS env var in server/lib/shipments.ts.
alter table public.batch_config
  add column if not exists shipment_deadline_hours integer not null default 24;
