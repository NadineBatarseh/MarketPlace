import supabase from '../supabase.js';
import { C } from './constants.js';
import {
  computeProximityFactor,
  computeDriverScore,
  roadDistance,
} from './formulas.js';
import { Courier } from './types.js';
import { getActiveWorkSession } from './workSessions.js';
import { applyRouteEta } from './eta.js';

// D33 — Score a driver against a specific batch
// Driver_Score = W_prox·P + W_cap·C - W_load·L
//   P = e^(-λ × distance(driver.liveGPS, Zone_A))   ← available drivers use live GPS position
//   C = batch.total_volume / courier.max_volume
//   L = hours_driven_today / MAX_SHIFT_HOURS
function scoreDriver(
  courier: Courier,
  zoneALat: number,
  zoneALng: number,
  batchVolume: number
): number {
  // Available drivers: distance is from their live GPS location to the new batch's Zone A.
  // This is accurate because available drivers are stationary or can head directly to Zone A.
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

// Recomputes ETA for just the batch's A→B leg from the driver's live location
// at the moment of lock. Deliberately not chained to the B→C leg — that would
// drift into full-route persistence, which is out of scope for this pass.
// Fire-and-forget: never blocks the caller's assignment response.
function recomputeAbLegEta(batchId: string, driverId: string): void {
  (async () => {
    try {
      const [{ data: batch }, { data: courier }] = await Promise.all([
        supabase.from('batches').select('ab_shipment_ids').eq('id', batchId).maybeSingle(),
        supabase.from('couriers').select('location').eq('id', driverId).maybeSingle(),
      ]);
      const abIds = (batch?.ab_shipment_ids as string[] | null) ?? [];
      const loc = (courier as any)?.location;
      if (!abIds.length || !loc?.lat || !loc?.lng) return;

      const { data: dropoffs } = await supabase
        .from('shipments')
        .select('id, dropoff_lat, dropoff_lng')
        .in('id', abIds);
      if (dropoffs?.length) {
        await applyRouteEta(dropoffs as { id: string; dropoff_lat: number; dropoff_lng: number }[], { lat: loc.lat, lng: loc.lng });
      }
    } catch (err) {
      console.warn('[Driver Assignment] recomputeAbLegEta failed:', (err as Error).message);
    }
  })();
}

// ── D34 — Atomic assignment for AVAILABLE drivers ───────────────────────────
// UPDATE batches SET status='assigned' WHERE id=:id AND status='pending_assignment'
// Only the first caller wins. Returns false if the batch was already claimed.
export type AtomicAssignResult =
  | { success: true }
  | {
      success: false;
      reason: 'batch_unavailable' | 'courier_unavailable' | 'no_active_work_session';
    };

// Claims the batch and flips the courier available → on_route atomically so a
// driver becomes ineligible for further offers the instant they accept, not when
// they click "Start mission". If the courier isn't available (already on_route
// from another batch), the batch claim is released.
//
// This path is ONLY for available drivers accepting a direct assignment.
// On-route drivers accepting a next mission use atomicAssignNextMission instead.
export async function atomicAssign(
  batchId: string,
  driverId: string
): Promise<AtomicAssignResult> {
  const activeSession = await getActiveWorkSession(driverId);
  if (!activeSession) {
    return { success: false, reason: 'no_active_work_session' };
  }

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
    .in('status', ['available', 'on_route'])
    .select('id');

  if (courierError || !courierLock?.length) {
    // Roll back: driver is offline or in an unexpected state
    await supabase
      .from('batches')
      .update({ status: 'pending_assignment', assigned_to: null, assigned_at: null })
      .eq('id', batchId)
      .eq('assigned_to', driverId);
    console.warn(`[Driver Assignment] courier ${driverId} not in an active state — releasing batch ${batchId}`);
    return { success: false, reason: 'courier_unavailable' };
  }

  // Batch is now durably assigned — clear the dispatcher-escalation flag (if any).
  await supabase.from('batches').update({ needs_dispatcher: false }).eq('id', batchId);

  recomputeAbLegEta(batchId, driverId);
  return { success: true };
}

// ── Atomic assignment for ON_ROUTE drivers accepting a next mission ──────────
// Unlike atomicAssign this does NOT require the driver to be 'available' and
// does NOT flip their courier status (they are already on_route for their current
// batch). It immediately locks the batch so no other driver can steal it.
//
// Why atomic locking is required here:
//   Without it, two on_route drivers could both "pre-accept" the same batch and
//   whichever finishes their current delivery first would win — a race condition
//   that reserved_until cannot prevent because reserved_until is a shipment-level
//   reservation timer, not a driver-assignment lock.
export type AtomicAssignNextMissionResult =
  | { success: true }
  | {
      success: false;
      reason:
        | 'batch_unavailable'
        | 'courier_not_on_route'
        | 'no_active_work_session'
        | 'already_has_queued_mission';
    };

export async function atomicAssignNextMission(
  batchId: string,
  driverId: string,
): Promise<AtomicAssignNextMissionResult> {
  const activeSession = await getActiveWorkSession(driverId);
  if (!activeSession) {
    return { success: false, reason: 'no_active_work_session' };
  }

  // Only on_route drivers use this path; available drivers use atomicAssign instead.
  const { data: courier } = await supabase
    .from('couriers')
    .select('status')
    .eq('id', driverId)
    .maybeSingle();

  if (courier?.status !== 'on_route') {
    return { success: false, reason: 'courier_not_on_route' };
  }

  // One queued next mission at a time: 'assigned' batches are next missions that
  // are locked but not yet started (in_transit batches are the current active run).
  const { count: alreadyQueued } = await supabase
    .from('batches')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', driverId)
    .eq('status', 'assigned');

  if (alreadyQueued && alreadyQueued > 0) {
    return { success: false, reason: 'already_has_queued_mission' };
  }

  // Atomic claim: wins only if the batch is still pending_assignment.
  // If two on_route drivers race, exactly one UPDATE returns a row — the other
  // sees an empty result and returns batch_unavailable. No further locking needed.
  const { data, error } = await supabase
    .from('batches')
    .update({ status: 'assigned', assigned_to: driverId, assigned_at: new Date().toISOString(), needs_dispatcher: false })
    .eq('id', batchId)
    .eq('status', 'pending_assignment')
    .select('id');

  if (error) {
    console.error('[Driver Assignment] atomicAssignNextMission error:', error.message);
    return { success: false, reason: 'batch_unavailable' };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { success: false, reason: 'batch_unavailable' };
  }

  // Mark this driver's own notification accepted so their dashboard shows confirmation.
  await supabase
    .from('driver_notifications')
    .update({ is_accepted: true })
    .eq('courier_id', driverId)
    .eq('batch_id', batchId);

  // Expire competing notifications for the same batch so other drivers see it as taken.
  await supabase
    .from('driver_notifications')
    .update({ is_accepted: true })
    .eq('batch_id', batchId)
    .neq('courier_id', driverId);

  console.log(`[Driver Assignment] Next mission ${batchId} locked for on_route courier ${driverId}`);
  recomputeAbLegEta(batchId, driverId);
  return { success: true };
}

// Notify a driver by inserting into driver_notifications — picked up via Supabase Realtime on the dashboard.
// type 'assignment'   → available driver, normal offer; first to accept via /accept wins.
// type 'next_mission' → on_route driver; accepting via /accept-next-mission immediately locks the batch.
async function notifyDriver(
  courierId: string,
  batchId: string,
  type: 'assignment' | 'next_mission' = 'assignment',
): Promise<void> {
  const { error } = await supabase
    .from('driver_notifications')
    .insert({ courier_id: courierId, batch_id: batchId, type, is_accepted: false });

  if (error) {
    console.error('[Driver Assignment] notifyDriver insert error:', error.message);
  } else {
    console.log(`[Driver Assignment] Notifying courier ${courierId} for batch ${batchId} (${type})`);
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

// Main export — broadcasts to top N available drivers per round. First to accept wins (D34).
// If no one accepts after MAX_ASSIGNMENT_ROUNDS → flags for human dispatcher.
// On_route drivers are handled separately via offerNextMissionToOnRouteDrivers (Phase 11).
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

    // Broadcast simultaneously to all drivers in this round with type='assignment'
    await Promise.all(courierIds.map(id => notifyDriver(id, batchId, 'assignment')));

    // Wait for first acceptance
    const acceptedBy = await waitForAcceptance(batchId, courierIds, C.ASSIGNMENT_TIMEOUT_MS);

    if (acceptedBy) {
      // Atomic assignment (no-op if frontend already did it via /accept)
      await atomicAssign(batchId, acceptedBy);
      // Flip all notifications for this batch so others see it as taken
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
