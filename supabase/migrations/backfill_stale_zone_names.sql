-- One-off backfill for zone names that were captured before the zones table
-- was renamed to Arabic. shipments.pickup_zone/dropoff_zone are NOT a live
-- join to zones.name — they're a text snapshot taken once (dropoff_zone via
-- the dropoff_zone_id trigger at order time, pickup_zone via a bounding-box
-- match against pickup_lat/pickup_lng, mirrored in server/lib/zones.ts'
-- pointInZone). Any shipment created while a zone still had its old English
-- name kept that name forever, which is why the admin batch dashboard shows
-- rows like "العيزرية ← Nablus" — same city, stale label.
--
-- Only touches shipments/batches that are still active (not delivered /
-- completed / cancelled) — delivered shipments and closed batches are a
-- historical record of what happened and are left alone.

-- ── shipments.dropoff_zone: prefer the authoritative zone FK; fall back to a
-- bounding-box match against dropoff_lat/lng for pre-dropoff_zone_id rows ──
update public.shipments s
set dropoff_zone = z.name
from public.zones z
where s.dropoff_zone_id = z.id
  and s.status <> 'delivered'
  and s.dropoff_zone is distinct from z.name;

update public.shipments s
set dropoff_zone = matched.name
from (
  select distinct on (s2.id) s2.id as shipment_id, z.name
  from public.shipments s2
  join public.zones z
    on s2.dropoff_lat between z.min_lat and z.max_lat
   and s2.dropoff_lng between z.min_lng and z.max_lng
  where s2.status <> 'delivered'
    and s2.dropoff_zone_id is null
  order by s2.id, z.id
) matched
where s.id = matched.shipment_id
  and s.dropoff_zone is distinct from matched.name;

-- ── shipments.pickup_zone: no FK column exists for pickup, so re-derive via
-- the same inclusive bounding-box match the app uses (pointInZone) ─────────
update public.shipments s
set pickup_zone = matched.name
from (
  select distinct on (s2.id) s2.id as shipment_id, z.name
  from public.shipments s2
  join public.zones z
    on s2.pickup_lat between z.min_lat and z.max_lat
   and s2.pickup_lng between z.min_lng and z.max_lng
  where s2.status <> 'delivered'
  order by s2.id, z.id
) matched
where s.id = matched.shipment_id
  and s.pickup_zone is distinct from matched.name;

-- ── batches.route: rebuild from the now-corrected shipment zones ───────────
-- route[1]/route[2] come from any AB-leg shipment (pickup_zone/dropoff_zone),
-- route[3] (if the batch has a BC leg) comes from any BC-leg shipment's
-- dropoff_zone. All shipments within a leg share the same zone pair by
-- construction, so picking the first id in each array is safe.
update public.batches b
set route = array_remove(array[
  (select s.pickup_zone from public.shipments s where s.id = b.ab_shipment_ids[1]),
  (select s.dropoff_zone from public.shipments s where s.id = b.ab_shipment_ids[1]),
  (select s.dropoff_zone from public.shipments s where s.id = b.bc_shipment_ids[1])
], null)
where b.status not in ('completed', 'cancelled')
  and b.ab_shipment_ids is not null
  and array_length(b.ab_shipment_ids, 1) > 0;
