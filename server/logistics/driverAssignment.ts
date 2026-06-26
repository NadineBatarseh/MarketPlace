import supabase from '../supabase.js';
import { C } from './constants.js';
import {
  computeProximityFactor,
  computeDriverScore,
  roadDistance,
} from './formulas.js';
import { Courier } from './types.js';

// â”€â”€ D33 â€” Score a driver against a specific batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver_Score = W_proxآ·P + W_capآ·C - W_loadآ·L
//   P = e^(-خ» أ— distance(driver, Zone_A))
//   C = batch.total_volume / courier.max_volume
//   L = hours_driven_today / MAX_SHIFT_HOURS
function scoreDriver(
  courier: Courier,
  zoneALat: number,
  zoneALng: number,
  batchVolume: number
): number {
  const distKm = roadDistance(
    courier.location.lat, courier.location.lng,
    zoneALat, zoneALng
  );
  const P = computeProximityFactor(distKm);
  const Cap = batchVolume / courier.max_volume;
  const L = courier.hours_driven_today / C.MAX_SHIFT_HOURS;

  return computeDriverScore(P, Cap, L);
}

// Fetch available couriers near Zone A
async function fetchAvailableCouriers(
  zoneALat: number,
  zoneALng: number,
  limit: number
): Promise<Courier[]> {
  const { data, error } = await supabase
    .from('couriers')
    .select('*')
    .eq('status', 'available');

  if (error || !data) {
    console.error('[Driver Assignment] fetchAvailableCouriers error:', error?.message);
    return [];
  }

  const couriers = data as Courier[];

  // Sort by distance then take top `limit`
  return couriers
    .sort((a, b) => {
      const dA = roadDistance(a.location.lat, a.location.lng, zoneALat, zoneALng);
      const dB = roadDistance(b.location.lat, b.location.lng, zoneALat, zoneALng);
      return dA - dB;
    })
    .slice(0, limit);
}

// â”€â”€ D34 â€” Atomic assignment check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// UPDATE batches SET status='assigned' WHERE id=:id AND status='pending_assignment'
// Returns true if this driver successfully claimed the batch.
export type AtomicAssignResult =
  | { success: true }
  | { success: false; reason: 'batch_unavailable' | 'courier_unavailable' };

// Claims the batch, then flips the courier available -> on_route in the same call
// so a driver becomes ineligible for further offers the instant they accept, not
// when they later click "Start mission". If the courier isn't actually available
// (already on_route from another batch), the batch claim is released.
export async function atomicAssign(
  batchId: string,
  driverId: string
): Promise<AtomicAssignResult> {
  const { data, error } = await supabase
    .from('batches')
    .update({ status: 'assigned', assigned_to: driverId, assigned_at: new Date().toISOString() })
    .eq('id', batchId)
    .eq('status', 'pending_assignment')
    .select('id');

  if (error) {
    console.error('[Driver Assignment] atomicAssign batch claim error:', error.message);
    return { success: false, reason: 'batch_unavailable' };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { success: false, reason: 'batch_unavailable' };
  }

  const { data: courierLock, error: courierError } = await supabase
    .from('couriers')
    .update({ status: 'on_route' })
    .eq('id', driverId)
    .eq('status', 'available')
    .select('id');

  if (courierError || !courierLock?.length) {
    await supabase
      .from('batches')
      .update({ status: 'pending_assignment', assigned_to: null, assigned_at: null })
      .eq('id', batchId)
      .eq('assigned_to', driverId);
    console.warn(`[Driver Assignment] courier ${driverId} not available — releasing batch ${batchId}`);
    return { success: false, reason: 'courier_unavailable' };
  }

  return { success: true };
}

// Notify a driver by inserting into driver_notifications â€” picked up via Supabase Realtime on the dashboard.
async function notifyDriver(courierId: string, batchId: string): Promise<void> {
  const { error } = await supabase
    .from('driver_notifications')
    .insert({ courier_id: courierId, batch_id: batchId, is_accepted: false });

  if (error) {
    console.error('[Driver Assignment] notifyDriver insert error:', error.message);
  } else {
    console.log(`[Driver Assignment] Notifying courier ${courierId} for batch ${batchId}`);
  }
}

// Poll until a candidate accepts (via is_accepted flag) OR the batch is already assigned
// (frontend may have run atomicAssign directly).
async function waitForAcceptance(
  batchId: string,
  courierIds: string[],
  timeoutMs: number
): Promise<string | null> {
  const pollInterval = 3_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { data: notif } = await supabase
      .from('driver_notifications')
      .select('courier_id')
      .eq('batch_id', batchId)
      .eq('is_accepted', true)
      .in('courier_id', courierIds)
      .limit(1)
      .single();

    if (notif?.courier_id) return notif.courier_id as string;

    // Fallback: frontend may have run the atomic assign itself
    const { data: batch } = await supabase
      .from('batches')
      .select('assigned_to')
      .eq('id', batchId)
      .eq('status', 'assigned')
      .single();

    if (batch?.assigned_to) return batch.assigned_to as string;

    await sleep(pollInterval);
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Broadcasts to top N drivers per round. First to accept wins (D34).
// If no one accepts after MAX_ASSIGNMENT_ROUNDS â†’ flags for human dispatcher.
export async function assignBatch(
  batchId: string,
  zoneALat: number,
  zoneALng: number,
  batchVolume: number
): Promise<boolean> {
  for (let round = 1; round <= C.MAX_ASSIGNMENT_ROUNDS; round++) {
    const offset = (round - 1) * C.DRIVERS_PER_ROUND;

    const candidates = await fetchAvailableCouriers(zoneALat, zoneALng, C.DRIVERS_PER_ROUND * round);
    const roundCandidates = candidates.slice(offset, offset + C.DRIVERS_PER_ROUND);

    if (roundCandidates.length === 0) break;

    // Score and sort this round's candidates (D33)
    const scored = roundCandidates
      .map(c => ({ courier: c, score: scoreDriver(c, zoneALat, zoneALng, batchVolume) }))
      .sort((a, b) => b.score - a.score);

    const courierIds = scored.map(s => s.courier.id);

    // Broadcast simultaneously to all drivers in this round
    await Promise.all(courierIds.map(id => notifyDriver(id, batchId)));

    // Wait for first acceptance
    const acceptedBy = await waitForAcceptance(batchId, courierIds, C.ASSIGNMENT_TIMEOUT_MS);

    if (acceptedBy) {
      // D34 â€” atomic assignment (no-op if frontend already did it)
      await atomicAssign(batchId, acceptedBy);
      // Ensure all notifications are flipped regardless of who ran atomicAssign
      await supabase
        .from('driver_notifications')
        .update({ is_accepted: true })
        .eq('batch_id', batchId);
      console.log(`[Driver Assignment] Batch ${batchId} assigned to courier ${acceptedBy} (round ${round})`);
      return true;
    }

    console.warn(`[Driver Assignment] Round ${round} timed out for batch ${batchId}`);
  }

  // Flag for human dispatcher after all rounds fail
  await supabase
    .from('batches')
    .update({ status: 'pending_assignment', needs_dispatcher: true })
    .eq('id', batchId);

  console.error(`[Driver Assignment] Batch ${batchId} needs human dispatcher after ${C.MAX_ASSIGNMENT_ROUNDS} rounds`);
  return false;
}
