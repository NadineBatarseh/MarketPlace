import { supabase } from '../../supabase.js';
import { C } from '../constants.js';
import { roadDistance, estimateDurationMinutes } from '../formulas.js';
import { getCourierLocation, getZoneCoords } from '../locationUtils.js';

// Driver must be at least this far from a zone to still pick up from it
const ARRIVAL_THRESHOLD_KM = 1.0;

// Search order for slotting a new shipment into an existing batch before
// falling back to creating a brand new one. 'assigned' comes first (driver
// already known, batch hasn't moved yet — the safest reuse). 'pending_assignment'
// is second (no driver yet, but reusing it makes it stronger/more attractive
// once a driver is offered it, instead of splitting demand across two batches).
// 'in_transit' is last and gets stricter, GPS-based validation since the
// driver is already moving.
const BATCH_INSERTION_PRIORITY = ['assigned', 'pending_assignment', 'in_transit'] as const;

interface UnbatchedShipment {
  id: string;
  pickup_zone: string;
  dropoff_zone: string;
  volume: number;
  deadline: string | null;
}

interface EligibleBatch {
  id: string;
  status: typeof BATCH_INSERTION_PRIORITY[number];
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

// ── Live-location check ──────────────────────────────────────────────────────
// Returns true if the driver still has enough time to pick up from the given zone.
// Uses the courier's live GPS position — no assumptions based on route order.
// in_transit-only: this is the only tier where the driver has actually started
// moving, so it's the only one that needs a live feasibility check.
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

// ── Baseline suitability check ───────────────────────────────────────────────
// Applies to every tier: pickup/dropoff must already be an adjacent zone pair
// in the batch's planned route (so insertion never reroutes or goes
// backwards — it only piggybacks on a stop the batch is already making),
// volume must fit, the route's stop count must stay within the configured
// limit, and the shipment's own deadline must not have already passed.
function passesBaselineChecks(batch: EligibleBatch, shipment: UnbatchedShipment): boolean {
  const route = batch.route;
  if (!route?.length) return false;
  if (route.length > C.MAX_STOPS) return false;

  const pickupIdx = route.indexOf(shipment.pickup_zone);
  if (pickupIdx === -1) return false;

  const expectedDropoff = route[pickupIdx + 1];
  if (!expectedDropoff || shipment.dropoff_zone !== expectedDropoff) return false;

  if (batch.total_volume + shipment.volume > C.MAX_VOLUME) return false;

  if (shipment.deadline && new Date(shipment.deadline) <= new Date()) return false;

  return true;
}

function legFor(batch: EligibleBatch, shipment: UnbatchedShipment): 'ab_shipment_ids' | 'bc_shipment_ids' {
  const pickupIdx = batch.route.indexOf(shipment.pickup_zone);
  return pickupIdx === 0 ? 'ab_shipment_ids' : 'bc_shipment_ids';
}

// ── Main export ──────────────────────────────────────────────────────────────
// Runs at the start of each batch cycle. Scans all unbatched shipments and
// slots each one into the best compatible existing batch before the cycle
// falls through to building brand-new candidate batches.
//
// Priority: assigned → pending_assignment → in_transit (BATCH_INSERTION_PRIORITY).
// Within a tier, prefers the batch with the most volume already committed —
// reusing the "fullest" batch keeps demand consolidated instead of spreading
// it thin across many half-empty ones.
export async function autoAssignUnbatchedShipments(): Promise<void> {
  const { data: rawShipments } = await supabase
    .from('shipments')
    .select('id, pickup_zone, dropoff_zone, deadline, order_details(qty, products(capacity_units))')
    .is('batch_id', null)
    .in('status', ['available', 'delayed']);

  if (!rawShipments?.length) return;

  const shipments: UnbatchedShipment[] = (rawShipments as any[]).map(s => ({
    id: s.id,
    pickup_zone: s.pickup_zone,
    dropoff_zone: s.dropoff_zone,
    deadline: s.deadline ?? null,
    volume: computeVolume(s),
  }));

  const { data: rawBatches } = await supabase
    .from('batches')
    .select('id, status, route, total_volume, reserved_until, ab_shipment_ids, bc_shipment_ids, assigned_to')
    .in('status', BATCH_INSERTION_PRIORITY);

  if (!rawBatches?.length) return;

  const batches: EligibleBatch[] = (rawBatches as EligibleBatch[]).sort((a, b) => {
    const pa = BATCH_INSERTION_PRIORITY.indexOf(a.status);
    const pb = BATCH_INSERTION_PRIORITY.indexOf(b.status);
    if (pa !== pb) return pa - pb;
    return b.total_volume - a.total_volume; // fill the fullest batch first within a tier
  });

  for (const shipment of shipments) {
    for (const batch of batches) {
      if (!passesBaselineChecks(batch, shipment)) continue;

      // in_transit-only: extra live-feasibility check on top of the baseline.
      if (batch.status === 'in_transit') {
        const canReach = await driverCanStillReach(batch.id, shipment.pickup_zone);
        if (!canReach) continue;
      }

      const leg = legFor(batch, shipment);
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
          `[Phase 0a] Failed to assign shipment ${shipment.id} → batch ${batch.id}:`,
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
        `[Phase 0a] Shipment ${shipment.id} → batch ${batch.id} ` +
        `(${leg}, status=${batch.status})`,
      );
      break; // shipment placed — move to the next one
    }
  }
}
