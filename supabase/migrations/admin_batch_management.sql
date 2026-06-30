-- Admin Batch Management — schema additions for administrative control over
-- already-created batches (move/remove shipments, breakdown intervention,
-- delay monitoring, audit trail). Does NOT touch the batch-generation or
-- route-sequencing algorithm; only adds bookkeeping columns and two
-- transactional RPCs that perform the same kind of atomic multi-row update
-- already used by claim_batch_shipments (Phase 5).

-- ── batches: delay tracking ──────────────────────────────────────────────────
alter table public.batches
  add column if not exists completed_at            timestamptz,
  add column if not exists expected_completion_at   timestamptz,
  add column if not exists delay_reported_at        timestamptz,
  add column if not exists delay_reason             text,
  add column if not exists delay_reported_by         text,
  add column if not exists under_monitoring          boolean not null default false;

alter table public.batches
  drop constraint if exists batches_delay_reported_by_check;
alter table public.batches
  add constraint batches_delay_reported_by_check
  check (delay_reported_by is null or delay_reported_by in ('driver', 'admin', 'system'));

-- ── batches: breakdown tracking ──────────────────────────────────────────────
alter table public.batches
  add column if not exists requires_manual_intervention boolean not null default false,
  add column if not exists breakdown_reported_at         timestamptz,
  add column if not exists breakdown_reason               text,
  add column if not exists breakdown_location              jsonb,
  add column if not exists breakdown_resolved_at           timestamptz,
  add column if not exists breakdown_resolution             text;

alter table public.batches
  drop constraint if exists batches_breakdown_resolution_check;
alter table public.batches
  add constraint batches_breakdown_resolution_check
  check (breakdown_resolution is null or breakdown_resolution in (
    'shipments_repooled', 'manual_intervention_pending', 'returned_to_warehouse', 'follow_up_required'
  ));

create index if not exists batches_breakdown_active_idx
  on public.batches (breakdown_reported_at)
  where breakdown_resolved_at is null and breakdown_reported_at is not null;

-- ── batch_config: configurable delay threshold ───────────────────────────────
-- "in_transit too long" threshold (minutes). Read fresh by the admin API on
-- every list request — never hardcoded in the frontend.
alter table public.batch_config
  add column if not exists delay_threshold_minutes integer not null default 180;

-- ── batch_admin_actions: audit trail for every administrative batch change ───
create table if not exists public.batch_admin_actions (
  id              bigserial primary key,
  batch_id        uuid not null references public.batches(id) on delete cascade,
  shipment_id     uuid references public.shipments(id) on delete set null,
  action_type     text not null,
  from_batch_id   uuid references public.batches(id) on delete set null,
  to_batch_id     uuid references public.batches(id) on delete set null,
  previous_status text,
  new_status      text,
  reason_code     text,
  reason          text,
  notes           text,
  performed_by    uuid not null references auth.users(id),
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists batch_admin_actions_batch_idx
  on public.batch_admin_actions (batch_id, created_at desc);
create index if not exists batch_admin_actions_shipment_idx
  on public.batch_admin_actions (shipment_id);

-- ── RPC: move_shipments_between_batches ──────────────────────────────────────
-- Atomically moves a set of not-yet-picked-up, A→B-leg shipments from one
-- batch to another. Re-validates status/zone/capacity/stops INSIDE the
-- transaction (closing the gap between the admin's preview and the commit),
-- locking both batch rows (in id order, to avoid deadlocks with concurrent
-- moves) and every shipment row FOR UPDATE.
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
  v_valid_count integer;
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

  -- Lock both batch rows in a stable order to avoid deadlocking with the
  -- reverse move running concurrently.
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

  -- Lock the candidate shipment rows and verify every one is eligible.
  -- FOR UPDATE can't be combined with an aggregate (count(*)), so lock with a
  -- plain row lock first, then count separately.
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
    and s.status in ('batched', 'reserved')
    and s.id = any(v_source.ab_shipment_ids)
    and s.pickup_zone = v_dest.route[1]
    and s.dropoff_zone = v_dest.route[2];

  if v_valid_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
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

  -- Commit the move.
  update public.shipments
    set batch_id = p_destination_batch_id
    where id = any(p_shipment_ids);

  update public.batches
    set ab_shipment_ids = coalesce(ab_shipment_ids, '{}') || p_shipment_ids,
        total_volume    = coalesce(total_volume, 0) + v_moving_volume
    where id = p_destination_batch_id;

  select array(select x from unnest(v_source.ab_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_source_ab;
  v_new_source_bc := v_source.bc_shipment_ids;

  update public.batches
    set ab_shipment_ids = coalesce(v_new_source_ab, '{}'),
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

-- ── RPC: remove_shipments_from_batch ──────────────────────────────────────────
-- Atomically returns not-yet-picked-up shipments to the available pool.
create or replace function public.remove_shipments_from_batch(
  p_shipment_ids uuid[],
  p_batch_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_batch  record;
  v_count  integer;
  v_valid_count integer;
  v_removed_volume numeric;
  v_new_ab uuid[];
  v_new_bc uuid[];
begin
  if p_shipment_ids is null or array_length(p_shipment_ids, 1) is null then
    return jsonb_build_object('success', false, 'error_code', 'no_shipments');
  end if;

  perform 1 from public.batches where id = p_batch_id for update;
  select * into v_batch from public.batches where id = p_batch_id;
  if v_batch.id is null then
    return jsonb_build_object('success', false, 'error_code', 'batch_not_found');
  end if;

  -- FOR UPDATE can't be combined with an aggregate (count(*)), so lock with a
  -- plain row lock first, then count separately.
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
    and s.batch_id = p_batch_id
    and s.status in ('batched', 'reserved');

  if v_valid_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
  end if;

  select coalesce(sum(coalesce(od.qty, 0) * coalesce(p.capacity_units, 0)), 0)
    into v_removed_volume
  from public.shipments s
  left join public.order_details od on od.id = s.order_detail_id
  left join public.products p on p.id = od.product_id
  where s.id = any(p_shipment_ids);

  update public.shipments
    set status = 'available',
        batch_id = null,
        reserved_until = null,
        delayed_reason = null,
        delayed_until = null
    where id = any(p_shipment_ids);

  select array(select x from unnest(v_batch.ab_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_ab;
  select array(select x from unnest(v_batch.bc_shipment_ids) x where x <> all (p_shipment_ids))
    into v_new_bc;

  update public.batches
    set ab_shipment_ids = coalesce(v_new_ab, '{}'),
        bc_shipment_ids = coalesce(v_new_bc, '{}'),
        total_volume    = greatest(coalesce(total_volume, 0) - v_removed_volume, 0),
        status = case
          when coalesce(array_length(v_new_ab, 1), 0) = 0
           and coalesce(array_length(v_new_bc, 1), 0) = 0
           and status not in ('completed', 'cancelled')
          then 'cancelled'
          else status
        end
    where id = p_batch_id;

  return jsonb_build_object(
    'success', true,
    'removed_volume', v_removed_volume,
    'batch_emptied', coalesce(array_length(v_new_ab, 1), 0) = 0
                  and coalesce(array_length(v_new_bc, 1), 0) = 0
  );
end;
$$;
