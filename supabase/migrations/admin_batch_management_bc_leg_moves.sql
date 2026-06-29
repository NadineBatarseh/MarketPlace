-- Allow moving B→C-leg shipments too (previously move_shipments_between_batches
-- only accepted A→B-leg shipments). A shipment can move into ANY destination
-- batch slot whose zone pair matches — either the destination's A→B leg
-- (route[1]/route[2]) or, if the destination already has a third zone, its
-- B→C leg (route[2]/route[3]). We never invent a new leg/zone on the
-- destination — only match into slots that already exist on its route — so
-- this still never touches route planning.
--
-- Also fixes a latent bug in the original function: it removed moved ids from
-- the source's ab_shipment_ids but copied bc_shipment_ids verbatim (no
-- removal), which was harmless only because bc-leg shipments could never be
-- selected before. Both arrays are now correctly filtered.
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

  -- Lock the candidate shipment rows and verify every one currently belongs
  -- to the source batch and hasn't been picked up. FOR UPDATE can't be
  -- combined with an aggregate (count(*)), so lock with a plain row lock
  -- first, then count separately.
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
    and s.status in ('batched', 'reserved');

  if v_status_ok_count <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
  end if;

  -- Every id must currently sit in exactly one of the source's two leg arrays.
  select array(select x from unnest(v_source.ab_shipment_ids) x where x = any (p_shipment_ids)),
         array(select x from unnest(v_source.bc_shipment_ids) x where x = any (p_shipment_ids))
    into v_in_source_ab, v_in_source_bc;

  if coalesce(array_length(v_in_source_ab, 1), 0) + coalesce(array_length(v_in_source_bc, 1), 0)
       <> array_length(p_shipment_ids, 1) then
    return jsonb_build_object('success', false, 'error_code', 'shipment_not_eligible');
  end if;

  -- Match each id's own (pickup_zone, dropoff_zone) against the destination's
  -- existing A→B slot and, if it has a third zone, its B→C slot.
  select
    array(
      select s.id from public.shipments s
      where s.id = any(p_shipment_ids)
        and s.pickup_zone = v_dest.route[1]
        and s.dropoff_zone = v_dest.route[2]
    ),
    array(
      select s.id from public.shipments s
      where s.id = any(p_shipment_ids)
        and array_length(v_dest.route, 1) >= 3
        and s.pickup_zone = v_dest.route[2]
        and s.dropoff_zone = v_dest.route[3]
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

  -- Commit the move.
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
