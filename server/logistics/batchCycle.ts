import { autoAssignUnbatchedShipments } from './phases/phase0a_autoAssignUnbatched.js';
import { extractDemandFlows } from './phases/phase0_demandFlow.js';
import { splitAllFlows } from './phases/phase0b_flowSplitting.js';
import { scoreAndRankBatches } from './phases/phase1_scoring.js';
import { applyLookAhead } from './phases/phase2_lookAhead.js';
import { readBatchShipments, computeRemainingCapacity } from './phases/phase3_readShipments.js';
import { planFullRoute } from './phases/phase4_planRoute.js';
import { claimShipmentsAtomically } from './phases/phase5_claimShipments.js';
import { assignBatch } from './driverAssignment.js';
import { computeReservedUntil } from './formulas.js';
import { CandidateBatch, DemandFlow } from './types.js';
import { loadConfigFromDB } from './constants.js';
import { supabase } from '../supabase.js';

// Releases delayed shipments whose wait period has elapsed back into the pool.
// Runs once at the start of each cycle â€” the single mechanism for un-delaying.
async function releaseDelayedShipments(): Promise<void> {
  const { error } = await supabase
    .from('shipments')
    .update({ status: 'available', delayed_reason: null, delayed_until: null })
    .eq('status', 'delayed')
    .lte('delayed_until', new Date().toISOString());

  if (error) {
    console.error('[Batch Cycle] releaseDelayedShipments error:', error.message);
  }
}

// Default courier home base â€” replace with real dispatcher location per region
const DEFAULT_HOME = { lat: 31.9038, lng: 35.2034 }; // Ramallah centre

// â”€â”€ Main batch cycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Runs once per cycle. Processes all candidate batches in priority order.
export async function runBatchCycle(): Promise<void> {
  console.log('[Batch Cycle] Starting new cycle...');

  // Load admin-configurable settings before each cycle
  await loadConfigFromDB();

  // Phase 0a â€” Slot unbatched shipments into existing assigned/in_transit batches
  await autoAssignUnbatchedShipments();

  // Phase 0 â€” Demand flow extraction
  const flows = await extractDemandFlows();
  if (flows.length === 0) {
    console.log('[Batch Cycle] No demand flows found. Cycle complete.');
    return;
  }

  // Phase 0b â€” Release delayed shipments whose wait is over, then split flows
  await releaseDelayedShipments();
  const candidateBatches = await splitAllFlows(flows);
  if (candidateBatches.length === 0) {
    console.log('[Batch Cycle] No dispatchable batches. Cycle complete.');
    return;
  }

  // Phase 1 â€” Score and rank
  let ranked = scoreAndRankBatches(candidateBatches);

  // Process each batch in priority order
  for (const batch of ranked) {
    await processSingleBatch(batch, ranked.filter(b => b !== batch), flows);
  }

  console.log('[Batch Cycle] Cycle complete.');
}

async function processSingleBatch(
  batch: CandidateBatch,
  otherBatches: CandidateBatch[],
  flows: DemandFlow[]
): Promise<void> {
  // Phase 2 â€” Look-ahead dead-end check (may re-rank; we still process this batch)
  const allBatches = [batch, ...otherBatches];
  const reranked = await applyLookAhead(allBatches);
  const current = reranked[0]; // may be the same batch or a different one

  // Phase 3 â€” Read shipments (no lock), compute remaining capacity
  const shipments = await readBatchShipments(current.shipment_ids);
  if (shipments.length === 0) return; // already claimed by another process

  const remainingCapacity = computeRemainingCapacity(shipments);

  // Phase 4 â€” Plan the full route (Zone C decision)
  const routePlan = await planFullRoute(
    current,
    remainingCapacity,
    flows,
    DEFAULT_HOME.lat,
    DEFAULT_HOME.lng
  );

  // Phase 5 â€” Claim all shipments atomically
  const batchId = crypto.randomUUID();
  const reservedUntil = computeReservedUntil(current.travel_duration_minutes);

  // Phase 5+6 â€” Claim shipments and create the batch record atomically
  const finalRoute = routePlan.bc_shipment_ids.length === 0
    ? routePlan.route.slice(0, 2)
    : routePlan.route;

  const claimed = await claimShipmentsAtomically(
    batchId,
    current.shipment_ids,
    routePlan.bc_shipment_ids,
    reservedUntil,
    finalRoute,
    current.total_volume,
    routePlan.bc_total_volume
  );

  if (!claimed) {
    console.warn(`[Batch Cycle] Batch ${batchId} â€” shipments already claimed. Skipping.`);
    return;
  }

  console.log(`[Phase 5] Batch ${batchId} closed â€” route: ${routePlan.route.join(' â†’ ')}`);

  // Driver assignment â€” runs asynchronously, does not block the next batch
  setTimeout(() =>
    assignBatch(
      batchId,
      current.origin_lat,
      current.origin_lng,
      current.total_volume + routePlan.bc_total_volume
    ), 0);
}

// â”€â”€ Scheduler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Starts the batch cycle on a fixed interval (C.CYCLE_INTERVAL_MINUTES).
export function startBatchCycleScheduler(intervalMinutes: number): void {
  const intervalMs = intervalMinutes * 60_000;
  console.log(`[Batch Cycle] Scheduler started â€” interval: ${intervalMinutes} min`);
  setInterval(runBatchCycle, intervalMs);
  // Run immediately on startup
  runBatchCycle();
}
