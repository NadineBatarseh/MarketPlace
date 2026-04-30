import supabase from '../supabase';
import { C } from './constants';
import {
  computeProximityFactor,
  computeDriverScore,
  roadDistance,
} from './formulas';
import { Courier } from './types';

// ── D33 — Score a driver against a specific batch ─────────────────────────────
// Driver_Score = W_prox·P + W_cap·C - W_load·L
//   P = e^(-λ × distance(driver, Zone_A))
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

// ── D34 — Atomic assignment check ─────────────────────────────────────────────
// UPDATE batches SET status='assigned' WHERE id=:id AND status='pending_assignment'
// Returns true if this driver successfully claimed the batch.
export async function atomicAssign(
  batchId: string,
  driverId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('batches')
    .update({ status: 'assigned', assigned_to: driverId, assigned_at: new Date().toISOString() })
    .eq('id', batchId)
    .eq('status', 'pending_assignment')
    .select('id');

  if (error) {
    console.error('[Driver Assignment] atomicAssign error:', error.message);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

// Simulate notifying a driver (replace with real push notification service)
async function notifyDriver(courierId: string, batchId: string): Promise<void> {
  console.log(`[Driver Assignment] Notifying courier ${courierId} for batch ${batchId}`);
  // In production: send push notification via FCM / APNs
}

// Simulate waiting for a driver to accept within the timeout window
async function waitForAcceptance(
  batchId: string,
  courierIds: string[],
  timeoutMs: number
): Promise<string | null> {
  const pollInterval = 3_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase
      .from('batch_acceptances')
      .select('courier_id')
      .eq('batch_id', batchId)
      .in('courier_id', courierIds)
      .limit(1)
      .single();

    if (data?.courier_id) return data.courier_id as string;

    await sleep(pollInterval);
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main export ───────────────────────────────────────────────────────────────
// Broadcasts to top N drivers per round. First to accept wins (D34).
// If no one accepts after MAX_ASSIGNMENT_ROUNDS → flags for human dispatcher.
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
      // D34 — atomic assignment: only one driver can succeed
      const assigned = await atomicAssign(batchId, acceptedBy);
      if (assigned) {
        console.log(`[Driver Assignment] Batch ${batchId} assigned to courier ${acceptedBy} (round ${round})`);
        return true;
      }
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
