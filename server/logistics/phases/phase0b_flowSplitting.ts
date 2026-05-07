import { supabase } from '../../supabase';
import { C } from '../constants';
import { computeUrgencyScore, computeBatchRawUrgency, roadDistance, estimateDurationMinutes, haversineDistance } from '../formulas';
import { CandidateBatch, DemandFlow, Shipment } from '../types';

// ── Step 1: Fetch and sort shipments for a flow (D3) ─────────────────────────
// urgency_score_i = (NOW - created_at_i) / (deadline_i - created_at_i)
// sorted DESC so most urgent shipments enter the first batch
async function fetchAndSortShipments(flow: DemandFlow): Promise<Shipment[]> {
  const { data, error } = await supabase
    .from('shipments')
    .select('*, order_details(qty, products(capacity_units))')
    .in('status', ['available', 'delayed'])
    .eq('pickup_zone', flow.origin)
    .eq('dropoff_zone', flow.destination);

  if (error || !data) {
    console.error('[Phase 0b] fetchAndSortShipments error:', error?.message);
    return [];
  }

  const now = new Date();
  return (data as any[])
    .map(row => ({
      ...row,
      volume: (row.order_details?.qty ?? 0) * (row.order_details?.products?.capacity_units ?? 0),
    }))
    .sort((a: Shipment, b: Shipment) => {
      const uA = computeUrgencyScore(new Date(a.created_at), new Date(a.deadline), now);
      const uB = computeUrgencyScore(new Date(b.created_at), new Date(b.deadline), now);
      return uB - uA;
    }) as Shipment[];
}

// ── Step 3: Greedy bin packing (D4) ──────────────────────────────────────────
// Close a batch when:
//   Σvolume + next.volume > MAX_VOLUME  OR  stops + 1 > MAX_STOPS
function packIntoBatches(
  shipments: Shipment[],
  flow: DemandFlow
): CandidateBatch[] {
  const batches: CandidateBatch[] = [];
  const now = new Date();

  const travelKm = roadDistance(
    flow.origin_lat, flow.origin_lng,
    flow.destination_lat, flow.destination_lng
  );
  const travelDuration = estimateDurationMinutes(travelKm);

  // Urgency-seeded nearest-neighbour clustering:
  // Each batch is seeded with the most urgent remaining shipment, then filled
  // with pickups geographically nearest to the running cluster centroid.
  // This keeps each driver's pickup stops compact while still prioritising
  // time-critical orders.
  const unassigned = [...shipments]; // urgency-sorted, highest first

  while (unassigned.length > 0) {
    const seed = unassigned.shift()!;

    const clusterIds: string[] = [seed.id];
    let clusterVolume = seed.volume;
    let clusterStops = 1;
    const clusterUrgencies: number[] = [
      computeUrgencyScore(new Date(seed.created_at), new Date(seed.deadline), now),
    ];
    let latSum = seed.pickup_lat;
    let lngSum = seed.pickup_lng;

    while (unassigned.length > 0) {
      if (clusterStops + 1 > C.MAX_STOPS) break;

      const centLat = latSum / clusterStops;
      const centLng = lngSum / clusterStops;

      let bestIdx = -1;
      let bestDist = Infinity;

      for (let i = 0; i < unassigned.length; i++) {
        const s = unassigned[i];
        if (clusterVolume + s.volume > C.MAX_VOLUME) continue;
        const dist = haversineDistance(centLat, centLng, s.pickup_lat, s.pickup_lng);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }

      if (bestIdx === -1) break;

      const next = unassigned.splice(bestIdx, 1)[0];
      clusterIds.push(next.id);
      clusterVolume += next.volume;
      clusterStops += 1;
      clusterUrgencies.push(
        computeUrgencyScore(new Date(next.created_at), new Date(next.deadline), now),
      );
      latSum += next.pickup_lat;
      lngSum += next.pickup_lng;
    }

    batches.push({
      shipment_ids: clusterIds,
      origin: flow.origin,
      destination: flow.destination,
      origin_lat: flow.origin_lat,
      origin_lng: flow.origin_lng,
      destination_lat: flow.destination_lat,
      destination_lng: flow.destination_lng,
      total_volume: clusterVolume,
      shipment_count: clusterIds.length,
      raw_urgency: computeBatchRawUrgency(clusterUrgencies),
      travel_duration_minutes: travelDuration,
    });
  }

  return batches;
}

// ── Step 4: Handle the thin last batch (D5, D6) ───────────────────────────────
// A batch is dispatched if:
//   1. shipment_count >= MIN_BATCH_THRESHOLD, OR
//   2. forceDispatchAfterMaxWait — the flow's avg waiting time exceeded MAX_FLOW_WAITING_MINUTES
// Otherwise shipments are marked delayed for the next cycle.
async function handleThinBatch(
  batch: CandidateBatch,
  forceDispatchAfterMaxWait: boolean
): Promise<CandidateBatch | null> {
  if (
    batch.shipment_count >= C.MIN_BATCH_THRESHOLD ||
    forceDispatchAfterMaxWait
  ) {
    return batch;
  }

  // D6 — delayed_until = NOW + cycle_interval
  const delayedUntil = new Date(
    Date.now() + C.CYCLE_INTERVAL_MINUTES * 60_000
  ).toISOString();

  const { error } = await supabase
    .from('shipments')
    .update({
      status: 'delayed',
      delayed_reason: 'insufficient_batch_size',
      delayed_until: delayedUntil,
    })
    .in('id', batch.shipment_ids);

  if (error) {
    console.error('[Phase 0b] handleThinBatch error:', error.message);
  }

  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function splitAllFlows(flows: DemandFlow[]): Promise<CandidateBatch[]> {
  const result: CandidateBatch[] = [];

  for (const flow of flows) {
    const shipments = await fetchAndSortShipments(flow);
    if (shipments.length === 0) continue;

    // D6b — force-dispatch if this flow has been waiting too long on average,
    // regardless of batch size. Applies to all batches produced from this flow.
    const forceDispatchAfterMaxWait =
      flow.avg_waiting_hours * 60 >= C.MAX_FLOW_WAITING_MINUTES;

    const batches = packIntoBatches(shipments, flow);

    for (let i = 0; i < batches.length; i++) {
      const isLast = i === batches.length - 1;
      const batch = isLast
        ? await handleThinBatch(batches[i], forceDispatchAfterMaxWait)
        : batches[i];
      if (batch) result.push(batch);
    }
  }

  return result;
}