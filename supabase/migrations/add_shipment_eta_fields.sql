-- Adds a real, per-shipment ETA that the order tracking page can read directly,
-- replacing the flat `deadline` ceiling as the customer-facing estimate.
alter table shipments
  add column if not exists estimated_delivery_at timestamptz,
  add column if not exists eta_source text
    check (eta_source in ('sla_fallback', 'route_estimate', 'actual', 'unknown')),
  add column if not exists eta_computed_at timestamptz;

-- Backfill: every shipment must have a non-null estimate unless truly unknown.
update shipments
set estimated_delivery_at = delivered_at,
    eta_source = 'actual',
    eta_computed_at = coalesce(delivered_at, now())
where status = 'delivered' and estimated_delivery_at is null;

update shipments
set estimated_delivery_at = null,
    eta_source = 'unknown',
    eta_computed_at = now()
where status = 'stranded' and estimated_delivery_at is null;

update shipments
set estimated_delivery_at = deadline,
    eta_source = 'sla_fallback',
    eta_computed_at = now()
where status not in ('delivered', 'stranded') and estimated_delivery_at is null;
