import supabase from '../../supabase.js';
import { C } from '../constants.js';
import {
  roadDistance,
  estimateDurationMinutes,
  computeRouteCost,
} from '../formulas.js';
import { scoreAndRankBatches } from './phase1_scoring.js';
import { CandidateBatch, DemandFlow, RoutePlan } from '../types.js';

// â”€â”€ D16 â€” Filter Zone Bâ†’C candidates by remaining capacity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// خ£volume_Bâ†’C â‰¤ remaining_capacity
function filterByCapacity(
  flows: DemandFlow[],
  zoneB: string,
  remainingCapacity: number
): DemandFlow[] {
  return flows.filter(
    f => f.origin === zoneB && f.total_volume <= remainingCapacity
  );
}

// â”€â”€ D17 â€” Score Zone Bâ†’C candidates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Same formula as Phase 1, normalized across Bâ†’C candidates only
function scoreCandidates(candidates: DemandFlow[]): CandidateBatch[] {
  const asCandidateBatches: CandidateBatch[] = candidates.map(flow => {
    const travelKm = roadDistance(
      flow.origin_lat, flow.origin_lng,
      flow.destination_lat, flow.destination_lng
    );
    return {
      shipment_ids: [],
      origin: flow.origin,
      destination: flow.destination,
      origin_lat: flow.origin_lat,
      origin_lng: flow.origin_lng,
      destination_lat: flow.destination_lat,
      destination_lng: flow.destination_lng,
      total_volume: flow.total_volume,
      shipment_count: flow.shipment_count,
      raw_urgency: 0,
      travel_duration_minutes: estimateDurationMinutes(travelKm),
    };
  });
  return scoreAndRankBatches(asCandidateBatches);
}

// â”€â”€ D18 â€” Extension cost â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// cost_extend = cost(Bâ†’C) + cost(Câ†’home_base)
function computeExtensionCost(
  bLat: number, bLng: number,
  cLat: number, cLng: number,
  homeLat: number, homeLng: number
): number {
  return (
    computeRouteCost(roadDistance(bLat, bLng, cLat, cLng)) +
    computeRouteCost(roadDistance(cLat, cLng, homeLat, homeLng))
  );
}

// â”€â”€ D19 â€” New dispatch cost â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// cost_new = cost(homeâ†’B) + cost(Bâ†’C) + cost(Câ†’home)
function computeNewDispatchCost(
  homeLat: number, homeLng: number,
  bLat: number, bLng: number,
  cLat: number, cLng: number
): number {
  return (
    computeRouteCost(roadDistance(homeLat, homeLng, bLat, bLng)) +
    computeRouteCost(roadDistance(bLat, bLng, cLat, cLng)) +
    computeRouteCost(roadDistance(cLat, cLng, homeLat, homeLng))
  );
}

// â”€â”€ D21 â€” Emergency re-batch for rejected flows that have been waiting too long â”€
function triggerEmergencyReBatch(flow: DemandFlow): void {
  if (flow.avg_waiting_hours * 60 >= C.MAX_FLOW_WAITING_MINUTES) {
    console.warn(
      `[Phase 4] Emergency re-batch triggered for ${flow.origin} â†’ ${flow.destination}`
    );
    // Signal is returned to the batch cycle which re-runs for this flow immediately.
    // In production this would publish to a queue or call the cycle runner directly.
  }
}

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns the full RoutePlan: which zones, which Bâ†’C shipment IDs.
// If no viable Zone C exists, returns the Aâ†’B-only plan.
export async function planFullRoute(
  batch: CandidateBatch,
  remainingCapacity: number,
  allFlows: DemandFlow[],
  courierHomeLat: number,
  courierHomeLng: number
): Promise<RoutePlan> {
  const zoneB = batch.destination;

  // D16 â€” eligible Zone C flows
  const eligible = filterByCapacity(allFlows, zoneB, remainingCapacity);

  if (eligible.length === 0) {
    return { route: [batch.origin, zoneB], bc_shipment_ids: [], bc_total_volume: 0 };
  }

  // D17 â€” score and rank Zone C candidates
  const ranked = scoreCandidates(eligible);
  const best = ranked[0];

  // D18, D19 â€” feasibility check
  const costExtend = computeExtensionCost(
    batch.destination_lat, batch.destination_lng,
    best.destination_lat, best.destination_lng,
    courierHomeLat, courierHomeLng
  );
  const costNew = computeNewDispatchCost(
    courierHomeLat, courierHomeLng,
    batch.destination_lat, batch.destination_lng,
    best.destination_lat, best.destination_lng
  );

  // D21 â€” emergency re-batch for rejected candidates
  for (const rejected of ranked.slice(1)) {
    const flow = allFlows.find(
      f => f.origin === rejected.origin && f.destination === rejected.destination
    );
    if (flow) triggerEmergencyReBatch(flow);
  }

  // D20 â€” extend only if cost_extend < cost_new
  if (costExtend >= costNew) {
    const bestFlow = allFlows.find(
      f => f.origin === best.origin && f.destination === best.destination
    );
    if (bestFlow) triggerEmergencyReBatch(bestFlow);
    return { route: [batch.origin, zoneB], bc_shipment_ids: [], bc_total_volume: 0 };
  }

  // Fetch the actual Zone Bâ†’C shipment IDs to claim
  const { data: bcShipments } = await supabase
    .from('shipments')
    .select('id, order_details(qty, products(capacity_units))')
    .in('status', ['available', 'delayed'])
    .eq('pickup_zone', zoneB)
    .eq('dropoff_zone', best.destination)
    .order('urgency_score', { ascending: false })
    .limit(C.MAX_STOPS);

  const bcMapped = (bcShipments as any[] ?? []).map(row => ({
    id: row.id as string,
    volume: (row.order_details?.qty ?? 0) * (row.order_details?.products?.capacity_units ?? 0),
  }));
  const bcIds = bcMapped.map(s => s.id);
  const bcVolume = bcMapped.reduce((sum, s) => sum + s.volume, 0);

  if (bcIds.length === 0) {
    return { route: [batch.origin, zoneB], bc_shipment_ids: [], bc_total_volume: 0 };
  }

  return {
    route: [batch.origin, zoneB, best.destination],
    bc_shipment_ids: bcIds,
    bc_total_volume: bcVolume,
  };
}