import { supabase } from '../../supabase';
import { C } from '../constants';
import { computeUrgencyScore, computeBatchRawUrgency, roadDistance, estimateDurationMinutes, isDeadlineOverride } from '../formulas';
import { CandidateBatch, DemandFlow, Shipment } from '../types';

// ── Step 1: Hard deadline override (D2) ──────────────────────────────────────
// Force-release any delayed shipment whose deadline is within
// URGENCY_OVERRIDE_WINDOW hours, so it bypasses the MIN_BATCH_THRESHOLD check.
export async function applyDeadlineOverride(): Promise<void> {
  const cutoff = new Date(
    Date.now() + C.URGENCY_OVERRIDE_WINDOW_HOURS * 3_600_000
  ).toISOString();

  const { error } = await supabase
    .from('shipments')
    .update({ status: 'available', delayed_reason: null, delayed_until: null })
    .eq('status', 'delayed')
    .lt('deadline', cutoff);

  if (error) {
    console.error('[Phase 0b] applyDeadlineOverride error:', error.message);
  }
}

// ── Step 2: Fetch and sort shipments for a flow (D3) ─────────────────────────
// urgency_score_i = (NOW - created_at_i) / (deadline_i - created_at_i)
// sorted DESC so most urgent shipments enter the first batch
async function fetchAndSortShipments(flow: DemandFlow): Promise<Shipment[]> {
  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .in('status', ['available', 'delayed'])
    .eq('pickup_zone', flow.origin)
    .eq('dropoff_zone', flow.destination);

  if (error || !data) {
    console.error('[Phase 0b] fetchAndSortShipments error:', error?.message);
    return [];
  }

  const now = new Date();
  return (data as Shipment[]).sort((a, b) => {
    const uA = computeUrgencyScore(new Date(a.created_at), new Date(a.deadline), now);
    const uB = computeUrgencyScore(new Date(b.created_at), new Date(b.deadline), now);
    return uB - uA;
  });
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

  let currentIds: string[] = [];
  let currentVolume = 0;
  let currentStops = 0;
  let urgencyScores: number[] = [];
  let hasOverride = false;

  const flushBatch = () => {
    if (currentIds.length === 0) return;
    batches.push({
      shipment_ids: [...currentIds],
      origin: flow.origin,
      destination: flow.destination,
      origin_lat: flow.origin_lat,
      origin_lng: flow.origin_lng,
      destination_lat: flow.destination_lat,
      destination_lng: flow.destination_lng,
      total_volume: currentVolume,
      shipment_count: currentIds.length,
      raw_urgency: computeBatchRawUrgency(urgencyScores),
      travel_duration_minutes: travelDuration,
      has_deadline_override: hasOverride,
    });
    currentIds = [];
    currentVolume = 0;
    currentStops = 0;
    urgencyScores = [];
    hasOverride = false;
  };

  for (const shipment of shipments) {
    // D4 — close batch if adding this shipment would exceed any constraint
    if (
      currentVolume + shipment.volume > C.MAX_VOLUME ||
      currentStops + 1 > C.MAX_STOPS
    ) {
      flushBatch();
    }

    const uScore = computeUrgencyScore(
      new Date(shipment.created_at),
      new Date(shipment.deadline),
      now
    );

    if (isDeadlineOverride(new Date(shipment.deadline), now)) {
      hasOverride = true;
    }

    currentIds.push(shipment.id);
    currentVolume += shipment.volume;
    currentStops += 1;
    urgencyScores.push(uScore);
  }

  flushBatch();
  return batches;
}

// ── Step 4: Handle the thin last batch (D5, D6) ───────────────────────────────
// Phase 0b is the only gate that decides dispatch vs delay based on count.
// A batch is dispatched if ANY of the following is true:
//   1. shipment_count >= MIN_BATCH_THRESHOLD
//   2. has_deadline_override — a shipment's deadline is imminent (urgency override)
//   3. forceDispatchAfterMaxWait — the flow's avg waiting time exceeded MAX_FLOW_WAITING_MINUTES
// Otherwise shipments are marked delayed for the next cycle.
async function handleThinBatch(
  batch: CandidateBatch,
  forceDispatchAfterMaxWait: boolean
): Promise<CandidateBatch | null> {
  if (
    batch.shipment_count >= C.MIN_BATCH_THRESHOLD ||
    batch.has_deadline_override ||
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