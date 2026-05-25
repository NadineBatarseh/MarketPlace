import { supabase } from '../../supabase.js';
import { C } from '../constants.js';
import { roadDistance, estimateDurationMinutes } from '../formulas.js';
import { getCourierLocation, getZoneCoords } from '../locationUtils.js';

// Driver must be at least this far from a zone to still pick up from it
const ARRIVAL_THRESHOLD_KM = 1.0;

interface UnbatchedShipment {
  id: string;
  pickup_zone: string;
  dropoff_zone: string;
  volume: number;
}

interface EligibleBatch {
  id: string;
  status: 'assigned' | 'in_transit';
  route: string[];
  total_volume: number;
  reserved_until: string | null;
  ab_shipment_ids: string[];
  bc_shipment_ids: string[];
  assigned_to: string | null;
}

function computeVolume(row: any): number {
  return (row.order_details?.qty ?? 0) * (row.order_details?.products?.capacity_units ?? 0);
}

// â”€â”€ Live-location check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns true if the driver still has enough time to pick up from the given zone.
// Uses the courier's live GPS position â€” no assumptions based on route order.
async function driverCanStillReach(batchId: string, zone: string): Promise<boolean> {
  const [courierLoc, zoneCoords] = await Promise.all([
    getCourierLocation(batchId),
    getZoneCoords(zone),
  ]);

  // If location data is unavailable, give benefit of the doubt
  if (!courierLoc || !zoneCoords) return true;

  const dist = roadDistance(courierLoc.lat, courierLoc.lng, zoneCoords.lat, zoneCoords.lng);

  // Driver has already arrived at (or passed) the zone
  if (dist <= ARRIVAL_THRESHOLD_KM) return false;

  // Driver is en route but won't make it in time
  if (estimateDurationMinutes(dist) < C.INTRA_CITY_MIN_TIME_BUFFER_MINUTES) return false;

  return true;
}

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Runs at the start of each batch cycle. Scans all unbatched shipments and
// slots each one into the best compatible existing batch.
//
// Priority: in_transit batches first (driver already en route â€” utilise the trip),
//           then assigned batches.
//
// For in_transit batches: every pickup zone is validated against the driver's
// LIVE GPS location â€” we never assume which zones the driver has or hasn't left.
// For assigned batches: no movement yet, so only a zone-match + volume check.
export async function autoAssignUnbatchedShipments(): Promise<void> {
  const { data: rawShipments } = await supabase
    .from('shipments')
    .select('id, pickup_zone, dropoff_zone, order_details(qty, products(capacity_units))')
    .is('batch_id', null)
    .in('status', ['available', 'delayed']);

  if (!rawShipments?.length) return;

  const shipments: UnbatchedShipment[] = (rawShipments as any[]).map(s => ({
    id: s.id,
    pickup_zone: s.pickup_zone,
    dropoff_zone: s.dropoff_zone,
    volume: computeVolume(s),
  }));

  const { data: rawBatches } = await supabase
    .from('batches')
    .select('id, status, route, total_volume, reserved_until, ab_shipment_ids, bc_shipment_ids, assigned_to')
    .in('status', ['in_transit', 'assigned']);

  if (!rawBatches?.length) return;

  // in_transit first â€” maximises utilisation of an already-moving driver
  const batches: EligibleBatch[] = (rawBatches as EligibleBatch[]).sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === 'in_transit' ? -1 : 1;
  });

  for (const shipment of shipments) {
    for (const batch of batches) {
      const route = batch.route;
      if (!route?.length) continue;

      // pickup_zone must exist somewhere in the route
      const pickupIdx = route.indexOf(shipment.pickup_zone);
      if (pickupIdx === -1) continue;

      // dropoff must be the immediately following zone in the route
      const expectedDropoff = route[pickupIdx + 1];
      if (!expectedDropoff || shipment.dropoff_zone !== expectedDropoff) continue;

      // Volume must fit
      if (batch.total_volume + shipment.volume > C.MAX_VOLUME) continue;

      // For in_transit batches: check driver's live GPS â€” no assumptions
      if (batch.status === 'in_transit') {
        const canReach = await driverCanStillReach(batch.id, shipment.pickup_zone);
        if (!canReach) continue;
      }

      // Determine which leg array to append to:
      // pickupIdx === 0 â†’ AB leg, pickupIdx >= 1 â†’ BC (or later) leg
      const leg: 'ab_shipment_ids' | 'bc_shipment_ids' =
        pickupIdx === 0 ? 'ab_shipment_ids' : 'bc_shipment_ids';

      const existingIds = batch[leg] ?? [];
      const reservedUntil =
        batch.reserved_until ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      const [{ error: sErr }, { error: bErr }] = await Promise.all([
        supabase
          .from('shipments')
          .update({
            batch_id: batch.id,
            status: 'reserved',
            reserved_until: reservedUntil,
            delayed_reason: null,
            delayed_until: null,
          })
          .eq('id', shipment.id),
        supabase
          .from('batches')
          .update({
            total_volume: batch.total_volume + shipment.volume,
            [leg]: [...existingIds, shipment.id],
          })
          .eq('id', batch.id),
      ]);

      if (sErr || bErr) {
        console.error(
          `[Phase 0a] Failed to assign shipment ${shipment.id} â†’ batch ${batch.id}:`,
          sErr?.message ?? bErr?.message,
        );
        break;
      }

      // Keep local state in sync so later shipments see the updated volume
      batch.total_volume += shipment.volume;
      (batch[leg] as string[]).push(shipment.id);

      // Notify the driver when a new shipment is added to their in-transit batch
      if (batch.status === 'in_transit' && batch.assigned_to) {
        await supabase.from('driver_notifications').insert({
          courier_id: batch.assigned_to,
          batch_id:   batch.id,
          type:       'addition',
          is_accepted: false,
          metadata:   { added_shipment_id: shipment.id },
        });
      }

      console.log(
        `[Phase 0a] Shipment ${shipment.id} â†’ batch ${batch.id} ` +
        `(${leg}, status=${batch.status})`,
      );
      break; // shipment placed â€” move to the next one
    }
  }
}
