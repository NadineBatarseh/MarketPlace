import supabase from '../../supabase';
import { C } from '../constants';

// Phase 8 — In-Transit Additions
// Tries to add new Zone B→C shipments to an existing batch while the
// courier is still en route to Zone B.
// All three conditions (D26, D27, D28) must pass simultaneously.

interface AdditionParams {
  batch_id: string;
  zone_b: string;
  new_shipment_ids: string[];
  existing_reserved_until: string;
}

// ── D26 — Courier has not yet reached Zone B ─────────────────────────────────
async function courierNotYetAtZoneB(batchId: string, zoneB: string): Promise<boolean> {
  const { data } = await supabase
    .from('batches')
    .select('courier_current_zone')
    .eq('id', batchId)
    .single();

  return data?.courier_current_zone !== zoneB;
}

// ── D27 — Time buffer check ───────────────────────────────────────────────────
// estimated_time_to_zone_B > INTRA_CITY_MIN_TIME_BUFFER_MINUTES
async function hasSufficientTimeBuffer(batchId: string): Promise<boolean> {
  const { data } = await supabase
    .from('batches')
    .select('estimated_minutes_to_next_zone')
    .eq('id', batchId)
    .single();

  return (
    (data?.estimated_minutes_to_next_zone ?? 0) >
    C.INTRA_CITY_MIN_TIME_BUFFER_MINUTES
  );
}

// ── D28 — Remaining capacity check ───────────────────────────────────────────
// batch.current_volume + Σ new_shipments.volume ≤ MAX_VOLUME
async function hasCapacity(
  batchId: string,
  newShipmentIds: string[]
): Promise<boolean> {
  const [batchRes, shipmentsRes] = await Promise.all([
    supabase.from('batches').select('total_volume').eq('id', batchId).single(),
    supabase
      .from('shipments')
      .select('order_details(qty, products(capacity_units))')
      .in('id', newShipmentIds)
      .in('status', ['available', 'delayed']),
  ]);

  const currentVolume = batchRes.data?.total_volume ?? C.MAX_VOLUME;
  const addedVolume = ((shipmentsRes.data as any[] | null) ?? [])
    .reduce((sum, s) => sum + (s.order_details?.qty ?? 0) * (s.order_details?.products?.capacity_units ?? 0), 0);

  return currentVolume + addedVolume <= C.MAX_VOLUME;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function tryAddShipmentsToBatch(
  params: AdditionParams
): Promise<boolean> {
  const { batch_id, zone_b, new_shipment_ids, existing_reserved_until } = params;

  const [notArrived, timeOk, capacityOk] = await Promise.all([
    courierNotYetAtZoneB(batch_id, zone_b),
    hasSufficientTimeBuffer(batch_id),
    hasCapacity(batch_id, new_shipment_ids),
  ]);

  // D26 ∧ D27 ∧ D28 must all be true
  if (!notArrived || !timeOk || !capacityOk) return false;

  const addedVolume = await getVolume(new_shipment_ids);

  const { error: shipmentError } = await supabase
    .from('shipments')
    .update({
      status: 'reserved',
      batch_id,
      reserved_until: existing_reserved_until,
      delayed_reason: null,
      delayed_until: null,
    })
    .in('id', new_shipment_ids);

  if (shipmentError) {
    console.error('[Phase 8] shipment update error:', shipmentError.message);
    return false;
  }

  // Update batch total_volume
  const { data: batch } = await supabase
    .from('batches')
    .select('total_volume')
    .eq('id', batch_id)
    .single();

  await supabase
    .from('batches')
    .update({ total_volume: (batch?.total_volume ?? 0) + addedVolume })
    .eq('id', batch_id);

  console.log(
    `[Phase 8] Added ${new_shipment_ids.length} shipments to batch ${batch_id}`
  );

  return true;
}

async function getVolume(ids: string[]): Promise<number> {
  const { data } = await supabase
    .from('shipments')
    .select('order_details(qty, products(capacity_units))')
    .in('id', ids);
  return ((data as any[] | null) ?? []).reduce(
    (sum, s) => sum + (s.order_details?.qty ?? 0) * (s.order_details?.products?.capacity_units ?? 0),
    0
  );
}
