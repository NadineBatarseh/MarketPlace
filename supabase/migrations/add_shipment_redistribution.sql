-- "Redistribute Shipments" admin feature — lets an admin split a batch's
-- shipments across other existing batches and/or brand-new batches, taking
-- into account that a shipment's real pickup point changes once a driver has
-- physically collected it (picked_up/stranded): from then on the courier who
-- takes it over must go to the *driver's last known location*, not the
-- store. The server (server/routes/adminBatchesRouter.ts) rewrites
-- shipments.pickup_lat/pickup_lng/pickup_zone to that effective point BEFORE
-- calling either RPC below — store_id remains the permanent merchant
-- attribution FK and is never touched, so this rewrite is safe.

-- ── batches: track manually-created batches ──────────────────────────────────
-- Every batch until now came out of the automated batch-cycle engine. The
-- Redistribute Shipments feature is the first path that lets an admin spin up
-- a batch by hand (create_batch_from_shipments below) — this column lets the
-- admin list/filter distinguish the two, the same way the `breakdown` filter
-- already distinguishes batches with an active breakdown.
alter table public.batches
  add column if not exists creation_source text not null default 'system';

alter table public.batches
  drop constraint if exists batches_creation_source_check;
alter table public.batches
  add constraint batches_creation_source_check
  check (creation_source in ('system', 'admin'));

-- ── move_shipments_between_batches: allow moving already-collected shipments ──
-- Previously only 'batched'/'reserved' (still-at-store) shipments could move,
-- matched on BOTH pickup_zone and dropoff_zone against the destination leg.
-- For 'picked_up'/'stranded' shipments the pickup_zone has just been
-- overwritten to the courier's/breakdown's effective zone by the caller — an
-- exact zone-pair match against a destination's fixed route is the wrong
-- test for a one-off detour, so those two statuses only require the
-- dropoff_zone to match (the admin-facing eligibility check that decided
-- this destination was reasonable already validated the detour distance
-- against batch_config.max_distance_km before this RPC is ever called).
create or replace function public.move_shipments_between_batches(
  p_shipment_ids uuid[],
  p_source_batch_id uuid,
  p_destination_batch_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_source     record;
  v_dest       record;
  v_max_volume numeric;
  v_max_stops  integer;
  v_count      integer;
  v_status_ok_count integer;
  v_in_source_ab uuid[];
  v_in_source_bc uuid[];
  v_to_dest_ab   uuid[];
  v_to_dest_bc   uuid[];
  v_moving_volume numeric;
  v_dest_stops integer;
  v_new_source_ab uuid[];
  v_new_source_bc uuid[];
begin
  if p_source_batch_id = p_destination_batch_id then
    return jsonb_build_object('success', false, 'error_code', 'same_batch');
  end if;
  if p_shipment_ids is null or array_length(p_shipment_ids, 1) is null then
    return jsonb_build_object('success', false, 'error_code', 'no_shipments');
  end if;

  perform 1 from public.batches
    where id in (p_source_batch_id, p_destination_batch_id)
    order by id
    for update;

  select * into v_source from public.batches where id = p_source_batch_id;
  select * into v_dest   from public.batches where id = p_destination_batch_id;

  if v_source.id is null then
    return jsonb_build_object('success', false, 'error_code', 'source_not_found');
  end if;
  if v_dest.id is null then
    return jsonb_build_object('success', false, 'error_code', 'destination_not_found');
  end if;
  if v_dest.status not in ('pending_assignment', 'assigned') then
    return jsonb_build_object('success', false, 'error_code', 'destination_not_eligible');
  end if;
  if v_dest.route is null or array_length(v_dest.route, 1) < 2 then
    return jsonb_build_object('success', false, 'error_code', 'destination_no_route');
  end if;

  select coalesce(max_driver_capacity, 100), coalesce(max_stops_per_batch, 20)
    into v_max_volume, v_max_stops
  from public.batch_config where id = 1;

  perform 1 from public.shipments
  where id = any(p_shipment_ids)
  for update;

  select count(*) into v_count
  from public.shipments
  where id = any(p_shipment_ids);

  if v_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_found');
  end if;

  select count(*) into v_status_ok_count
  from public.shipments s
  where s.id = any(p_shipment_ids)
    and s.batch_id = p_source_batch_id
    and s.status in ('batched', 'reserved', 'picked_up', 'stranded');

  if v_status_ok_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
  end if;

  select array(select x from unnest(v_source.ab_shipment_ids) x where x = any (p_shipment_ids)),
         array(select x from unnest(v_source.bc_shipment_ids) x where x = any (p_shipment_ids))
    into v_in_source_ab, v_in_source_bc;

  if coalesce(array_length(v_in_source_ab, 1), 0) + coalesce(array_length(v_in_source_bc, 1), 0)
       <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
  end if;

  select
    array(
      select s.id from public.shipments s
      where s.id = any(p_shipment_ids)
        and (
          (s.status in ('batched', 'reserved')
            and s.pickup_zone = v_dest.route[1] and s.dropoff_zone = v_dest.route[2])
          or
          (s.status in ('picked_up', 'stranded') and s.dropoff_zone = v_dest.route[2])
        )
    ),
    array(
      select s.id from public.shipments s
      where s.id = any(p_shipment_ids)
        and array_length(v_dest.route, 1) >= 3
        and (
          (s.status in ('batched', 'reserved')
            and s.pickup_zone = v_dest.route[2] and s.dropoff_zone = v_dest.route[3])
          or
          (s.status in ('picked_up', 'stranded') and s.dropoff_zone = v_dest.route[3])
        )
    )
  into v_to_dest_ab, v_to_dest_bc;

  if coalesce(array_length(v_to_dest_ab, 1), 0) + coalesce(array_length(v_to_dest_bc, 1), 0)
       <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'destination_zone_mismatch');
  end if;

  select coalesce(sum(coalesce(od.qty, 0) * coalesce(p.capacity_units, 0)), 0)
    into v_moving_volume
  from public.shipments s
  left join public.order_details od on od.id = s.order_detail_id
  left join public.products p on p.id = od.product_id
  where s.id = any(p_shipment_ids);

  if coalesce(v_dest.total_volume, 0) + v_moving_volume > v_max_volume then
    return jsonb_build_object('success', false, 'error_code', 'capacity_exceeded');
  end if;

  v_dest_stops := coalesce(array_length(v_dest.ab_shipment_ids, 1), 0)
                + coalesce(array_length(v_dest.bc_shipment_ids, 1), 0)
                + array_length(p_shipment_ids, 1);
  if v_dest_stops > v_max_stops then
    return jsonb_build_object('success', false, 'error_code', 'max_stops_exceeded');
  end if;

  update public.shipments
    set batch_id = p_destination_batch_id
    where id = any(p_shipment_ids);

  update public.batches
    set ab_shipment_ids = coalesce(ab_shipment_ids, '{}') || coalesce(v_to_dest_ab, '{}'),
        bc_shipment_ids = coalesce(bc_shipment_ids, '{}') || coalesce(v_to_dest_bc, '{}'),
        total_volume    = coalesce(total_volume, 0) + v_moving_volume
    where id = p_destination_batch_id;

  select array(select x from unnest(v_source.ab_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_source_ab;
  select array(select x from unnest(v_source.bc_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_source_bc;

  update public.batches
    set ab_shipment_ids = coalesce(v_new_source_ab, '{}'),
        bc_shipment_ids = coalesce(v_new_source_bc, '{}'),
        total_volume    = greatest(coalesce(total_volume, 0) - v_moving_volume, 0),
        status = case
          when coalesce(array_length(v_new_source_ab, 1), 0) = 0
           and coalesce(array_length(v_new_source_bc, 1), 0) = 0
           and status not in ('completed', 'cancelled')
          then 'cancelled'
          else status
        end
    where id = p_source_batch_id;

  return jsonb_build_object(
    'success', true,
    'moved_volume', v_moving_volume,
    'source_emptied', coalesce(array_length(v_new_source_ab, 1), 0) = 0
                   and coalesce(array_length(v_new_source_bc, 1), 0) = 0
  );
end;
$$;

-- ── create_batch_from_shipments: spin up a brand-new batch from a shipment set ──
-- Used by the "إنشاء دفعة جديدة" option in the Redistribute Shipments
-- feature. p_route is a 2- or 3-zone path ([pickup, dropoff] or
-- [pickup, mid, dropoff]) already validated by the caller: every shipment in
-- p_shipment_ids must have pickup_zone = p_route[1] and dropoff_zone equal to
-- either p_route[2] (→ ab leg) or, if present, p_route[3] (→ bc leg).
-- AB-leg shipments go to 'batched' (no timer yet); BC-leg shipments go to
-- 'reserved' with a fresh reservation window, mirroring how Phase 0a/Phase 8
-- reserve newly-added bc-leg shipments.
--
-- p_source_batch_id: the batch these shipments are being pulled OUT of. Like
-- move_shipments_between_batches, this function must strip the moved ids out
-- of the source batch's ab_shipment_ids/bc_shipment_ids (and total_volume) —
-- those arrays, not shipments.batch_id, are what the rest of the logistics
-- engine (phase files, driver assignment, route rendering) treats as batch
-- membership. Without this the shipment still shows up under the old batch
-- even after shipments.batch_id has moved on.
drop function if exists public.create_batch_from_shipments(uuid[], text[]);

create or replace function public.create_batch_from_shipments(
  p_shipment_ids uuid[],
  p_route text[],
  p_source_batch_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_source     record;
  v_max_volume numeric;
  v_max_stops  integer;
  v_count      integer;
  v_valid_count integer;
  v_ab_ids uuid[];
  v_bc_ids uuid[];
  v_total_volume numeric;
  v_batch_id uuid;
  v_reserved_until timestamptz := now() + interval '120 minutes';
  v_new_source_ab uuid[];
  v_new_source_bc uuid[];
begin
  if p_shipment_ids is null or array_length(p_shipment_ids, 1) is null then
    return jsonb_build_object('success', false, 'error_code', 'no_shipments');
  end if;
  if p_route is null or array_length(p_route, 1) < 2 then
    return jsonb_build_object('success', false, 'error_code', 'invalid_route');
  end if;

  perform 1 from public.batches where id = p_source_batch_id for update;
  select * into v_source from public.batches where id = p_source_batch_id;
  if v_source.id is null then
    return jsonb_build_object('success', false, 'error_code', 'source_not_found');
  end if;

  select coalesce(max_driver_capacity, 100), coalesce(max_stops_per_batch, 20)
    into v_max_volume, v_max_stops
  from public.batch_config where id = 1;

  perform 1 from public.shipments
  where id = any(p_shipment_ids)
  for update;

  select count(*) into v_count
  from public.shipments
  where id = any(p_shipment_ids);

  if v_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_found');
  end if;

  select count(*) into v_valid_count
  from public.shipments s
  where s.id = any(p_shipment_ids)
    and s.batch_id = p_source_batch_id
    and s.status in ('batched', 'reserved', 'picked_up', 'stranded')
    and s.pickup_zone = p_route[1]
    and (
      s.dropoff_zone = p_route[2]
      or (array_length(p_route, 1) >= 3 and s.dropoff_zone = p_route[3])
    );

  if v_valid_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
  end if;

  if array_length(p_shipment_ids, 1) > v_max_stops then
    return jsonb_build_object('success', false, 'error_code', 'max_stops_exceeded');
  end if;

  select coalesce(sum(coalesce(od.qty, 0) * coalesce(p.capacity_units, 0)), 0)
    into v_total_volume
  from public.shipments s
  left join public.order_details od on od.id = s.order_detail_id
  left join public.products p on p.id = od.product_id
  where s.id = any(p_shipment_ids);

  if v_total_volume > v_max_volume then
    return jsonb_build_object('success', false, 'error_code', 'capacity_exceeded');
  end if;

  select array(select id from public.shipments where id = any(p_shipment_ids) and dropoff_zone = p_route[2])
    into v_ab_ids;
  select array(select id from public.shipments where id = any(p_shipment_ids) and dropoff_zone <> p_route[2])
    into v_bc_ids;

  insert into public.batches (route, ab_shipment_ids, bc_shipment_ids, status, total_volume, creation_source)
  values (p_route, coalesce(v_ab_ids, '{}'), coalesce(v_bc_ids, '{}'), 'pending_assignment', v_total_volume, 'admin')
  returning id into v_batch_id;

  -- Only shipments still at the store (batched/reserved) get forced into
  -- 'batched'/'reserved' for the new batch. Shipments already collected
  -- (picked_up/stranded) keep their status/reserved_until untouched — they
  -- were already validated as eligible above, and a driver already holds
  -- them, so this is a membership change, not a fresh pickup.
  if v_ab_ids is not null and array_length(v_ab_ids, 1) > 0 then
    update public.shipments
      set batch_id = v_batch_id,
          status = case when status in ('picked_up', 'stranded') then status else 'batched' end
      where id = any(v_ab_ids);
  end if;

  if v_bc_ids is not null and array_length(v_bc_ids, 1) > 0 then
    update public.shipments
      set batch_id = v_batch_id,
          status = case when status in ('picked_up', 'stranded') then status else 'reserved' end,
          reserved_until = case when status in ('picked_up', 'stranded') then reserved_until else v_reserved_until end
      where id = any(v_bc_ids);
  end if;

  select array(select x from unnest(v_source.ab_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_source_ab;
  select array(select x from unnest(v_source.bc_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_source_bc;

  update public.batches
    set ab_shipment_ids = coalesce(v_new_source_ab, '{}'),
        bc_shipment_ids = coalesce(v_new_source_bc, '{}'),
        total_volume    = greatest(coalesce(total_volume, 0) - v_total_volume, 0),
        status = case
          when coalesce(array_length(v_new_source_ab, 1), 0) = 0
           and coalesce(array_length(v_new_source_bc, 1), 0) = 0
           and status not in ('completed', 'cancelled')
          then 'cancelled'
          else status
        end
    where id = p_source_batch_id;

  return jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'total_volume', v_total_volume,
    'source_emptied', coalesce(array_length(v_new_source_ab, 1), 0) = 0
                   and coalesce(array_length(v_new_source_bc, 1), 0) = 0
  );
end;
$$;
