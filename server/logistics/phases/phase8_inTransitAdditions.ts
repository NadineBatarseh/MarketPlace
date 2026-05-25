import supabase from '../../supabase.js';
import { C } from '../constants.js';
import { roadDistance, estimateDurationMinutes } from '../formulas.js';
import { Coordinates } from '../types.js';

// Courier is considered "arrived" at a zone when within this distance
const ARRIVAL_THRESHOLD_KM = 1.0;

interface AdditionParams {
  batch_id: string;
  zone_b: string;
  new_shipment_ids: string[];
  existing_reserved_until: string;
}

// Fetch the assigned courier's live GPS location from the couriers table
async function getCourierLocation(batchId: string): Promise<Coordinates | null> {
  const { data } = await supabase
    .from('batches')
    .select('couriers!assigned_to(location)')
    .eq('id', batchId)
    .single();
  const loc = (data as any)?.couriers?.location;
  if (!loc?.lat || !loc?.lng) return null;
  return { lat: loc.lat as number, lng: loc.lng as number };
}

// Derive Zone B's coordinates from the average of shipments pickup coords in that zone
async function getZoneCoords(zone: string): Promise<Coordinates | null> {
  const { data } = await supabase
    .from('shipments')
    .select('pickup_lat, pickup_lng')
    .eq('pickup_zone', zone)
    .limit(50);
  if (!data?.length) return null;
  const lat = data.reduce((s, r) => s + (r.pickup_lat as number), 0) / data.length;
  const lng = data.reduce((s, r) => s + (r.pickup_lng as number), 0) / data.length;
  return { lat, lng };
}

// â”€â”€ D28 â€” Remaining capacity check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// batch.current_volume + خ£ new_shipments.volume â‰¤ MAX_VOLUME
async function hasCapacity(batchId: string, newShipmentIds: string[]): Promise<boolean> {
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

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function tryAddShipmentsToBatch(params: AdditionParams): Promise<boolean> {
  const { batch_id, zone_b, new_shipment_ids, existing_reserved_until } = params;

  // Fetch live courier location and zone B coordinates in parallel
  const [courierLoc, zoneBCoords] = await Promise.all([
    getCourierLocation(batch_id),
    getZoneCoords(zone_b),
  ]);

  // â”€â”€ D26 â€” Courier has not yet reached Zone B â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Benefit of the doubt if location data is missing
  const notArrived = (courierLoc && zoneBCoords)
    ? roadDistance(courierLoc.lat, courierLoc.lng, zoneBCoords.lat, zoneBCoords.lng) > ARRIVAL_THRESHOLD_KM
    : true;

  // â”€â”€ D27 â€” Sufficient time buffer remaining â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const timeOk = (courierLoc && zoneBCoords)
    ? estimateDurationMinutes(roadDistance(courierLoc.lat, courierLoc.lng, zoneBCoords.lat, zoneBCoords.lng)) > C.INTRA_CITY_MIN_TIME_BUFFER_MINUTES
    : false;

  // â”€â”€ D28 â€” Remaining capacity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const capacityOk = await hasCapacity(batch_id, new_shipment_ids);

  // D26 âˆ§ D27 âˆ§ D28 must all be true
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

  const { data: batch } = await supabase
    .from('batches')
    .select('total_volume, bc_shipment_ids')
    .eq('id', batch_id)
    .single();

  const existingBcIds = (batch?.bc_shipment_ids as string[]) ?? [];

  await supabase
    .from('batches')
    .update({
      total_volume: (batch?.total_volume ?? 0) + addedVolume,
      bc_shipment_ids: [...existingBcIds, ...new_shipment_ids],
    })
    .eq('id', batch_id);

  console.log(`[Phase 8] Added ${new_shipment_ids.length} shipments to batch ${batch_id}`);
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
