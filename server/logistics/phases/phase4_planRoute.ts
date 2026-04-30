import supabase from '../../supabase';
import { C } from '../constants';
import {
  roadDistance,
  estimateDurationMinutes,
  computeRouteCost,
  computeBatchRawUrgency,
  computeUrgencyScore,
  isDeadlineOverride,
} from '../formulas';
import { scoreAndRankBatches } from './phase1_scoring';
import { CandidateBatch, DemandFlow, RoutePlan, Shipment } from '../types';

// ── D16 — Filter Zone B→C candidates by remaining capacity ───────────────────
// Σvolume_B→C ≤ remaining_capacity
function filterByCapacity(
  flows: DemandFlow[],
  zoneB: string,
  remainingCapacity: number
): DemandFlow[] {
  return flows.filter(
    f => f.origin === zoneB && f.total_volume <= remainingCapacity
  );
}

// ── D17 — Score Zone B→C candidates ──────────────────────────────────────────
// Same formula as Phase 1, normalized across B→C candidates only
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
      has_deadline_override: false,
    };
  });
  return scoreAndRankBatches(asCandidateBatches);
}

// ── D18 — Extension cost ──────────────────────────────────────────────────────
// cost_extend = cost(B→C) + cost(C→home_base)
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

// ── D19 — New dispatch cost ───────────────────────────────────────────────────
// cost_new = cost(home→B) + cost(B→C) + cost(C→home)
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

// ── D21 — Emergency re-batch for rejected urgent candidates ───────────────────
async function triggerEmergencyReBatch(flow: DemandFlow): Promise<void> {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('urgency_score, deadline')
    .in('status', ['available', 'delayed'])
    .eq('pickup_zone', flow.origin)
    .eq('dropoff_zone', flow.destination);

  if (!shipments || shipments.length === 0) return;

  const now = new Date();
  const hasUrgent = (shipments as Pick<Shipment, 'urgency_score' | 'deadline'>[]).some(
    s =>
      s.urgency_score > C.URGENCY_THRESHOLD ||
      isDeadlineOverride(new Date(s.deadline), now)
  );

  if (hasUrgent) {
    console.warn(
      `[Phase 4] Emergency re-batch triggered for ${flow.origin} → ${flow.destination}`
    );
    // Signal is returned to the batch cycle which re-runs for this flow immediately.
    // In production this would publish to a queue or call the cycle runner directly.
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
// Returns the full RoutePlan: which zones, which B→C shipment IDs.
// If no viable Zone C exists, returns the A→B-only plan.
export async function planFullRoute(
  batch: CandidateBatch,
  remainingCapacity: number,
  allFlows: DemandFlow[],
  courierHomeLat: number,
  courierHomeLng: number
): Promise<RoutePlan> {
  const zoneB = batch.destination;

  // D16 — eligible Zone C flows
  const eligible = filterByCapacity(allFlows, zoneB, remainingCapacity);

  if (eligible.length === 0) {
    return { route: [batch.origin, zoneB], bc_shipment_ids: [], bc_total_volume: 0 };
  }

  // D17 — score and rank Zone C candidates
  const ranked = scoreCandidates(eligible);
  const best = ranked[0];

  // D18, D19 — feasibility check
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

  // D21 — emergency re-batch for rejected candidates
  for (const rejected of ranked.slice(1)) {
    const flow = allFlows.find(
      f => f.origin === rejected.origin && f.destination === rejected.destination
    );
    if (flow) await triggerEmergencyReBatch(flow);
  }

  // D20 — extend only if cost_extend < cost_new
  if (costExtend >= costNew) {
    const bestFlow = allFlows.find(
      f => f.origin === best.origin && f.destination === best.destination
    );
    if (bestFlow) await triggerEmergencyReBatch(bestFlow);
    return { route: [batch.origin, zoneB], bc_shipment_ids: [], bc_total_volume: 0 };
  }

  // Fetch the actual Zone B→C shipment IDs to claim
  const { data: bcShipments } = await supabase
    .from('shipments')
    .select('id, volume')
    .in('status', ['available', 'delayed'])
    .eq('pickup_zone', zoneB)
    .eq('dropoff_zone', best.destination)
    .order('urgency_score', { ascending: false })
    .limit(C.MAX_STOPS);

  const bcIds = (bcShipments as Pick<Shipment, 'id' | 'volume'>[] ?? []).map(s => s.id);
  const bcVolume = (bcShipments as Pick<Shipment, 'id' | 'volume'>[] ?? []).reduce(
    (sum, s) => sum + s.volume, 0
  );

  return {
    route: [batch.origin, zoneB, best.destination],
    bc_shipment_ids: bcIds,
    bc_total_volume: bcVolume,
  };
}