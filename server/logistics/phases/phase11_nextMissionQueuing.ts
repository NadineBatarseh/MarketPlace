import { supabase } from '../../supabase.js';
import { C } from '../constants.js';
import { roadDistance, computeProximityFactor, computeDriverScore } from '../formulas.js';
import { getZoneCoords } from '../locationUtils.js';
import { atomicAssign } from '../driverAssignment.js';

interface NextMissionCandidate {
  courierId: string;
  endZone: string;
  score: number;
}

// Finds on_route couriers whose current batch's last zone is within
// NEXT_MISSION_PROXIMITY_KM of the new batch's start zone, then scores them.
//
// Why on_route drivers use end-zone coordinates (not live GPS):
//   An on_route driver is mid-delivery. Their relevant "position" for scoring
//   against a new batch is where they will *finish* their current run, not where
//   they are right now. Using live GPS would under-score drivers who are deep in
//   their route but will end up very close to the new batch's Zone A.
async function findCandidates(
  zoneALat: number,
  zoneALng: number,
  batchVolume: number,
): Promise<NextMissionCandidate[]> {
  const { data: onRouteCouriers, error: cErr } = await supabase
    .from('couriers')
    .select('id, max_volume, hours_driven_today')
    .eq('status', 'on_route');

  if (cErr || !onRouteCouriers?.length) return [];

  const courierIds = (onRouteCouriers as any[]).map(c => c.id as string);

  const { data: activeBatches, error: bErr } = await supabase
    .from('batches')
    .select('assigned_to, route')
    .in('assigned_to', courierIds)
    .in('status', ['assigned', 'in_transit']);

  if (bErr || !activeBatches?.length) return [];

  const batchByDriver = new Map<string, string[]>(
    (activeBatches as any[]).map(b => [b.assigned_to as string, b.route as string[]]),
  );

  const courierMap = new Map<string, any>(
    (onRouteCouriers as any[]).map(c => [c.id as string, c]),
  );

  const candidates: NextMissionCandidate[] = [];

  for (const [courierId, route] of batchByDriver) {
    if (!route?.length) continue;

    const courier = courierMap.get(courierId);
    if (!courier) continue;

    // New batch must fit in the driver's vehicle
    if (batchVolume > (courier.max_volume as number)) continue;

    // Do not offer more work to an exhausted driver
    if ((courier.hours_driven_today as number) >= C.MAX_SHIFT_HOURS) continue;

    // Skip drivers who already have a locked queued next mission
    const { count: alreadyQueued } = await supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', courierId)
      .eq('status', 'assigned');

    if (alreadyQueued && alreadyQueued > 0) continue;

    // Use the end zone of the driver's current batch route as the proximity origin.
    // For in_transit batches the last route stop is the delivery endpoint; this is
    // a better predictor of where the driver will be when free than their live GPS.
    const endZone = route[route.length - 1];
    const endCoords = await getZoneCoords(endZone);
    if (!endCoords) continue;

    const dist = roadDistance(endCoords.lat, endCoords.lng, zoneALat, zoneALng);

    if (dist > C.NEXT_MISSION_PROXIMITY_KM) continue;

    const P   = computeProximityFactor(dist);
    const Cap = batchVolume / (courier.max_volume as number);
    const L   = (courier.hours_driven_today as number) / C.MAX_SHIFT_HOURS;

    candidates.push({ courierId, endZone, score: computeDriverScore(P, Cap, L) });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// Sends 'next_mission' notifications to eligible on_route drivers.
// The batch stays pending_assignment here — the lock is taken when the driver
// accepts via POST /accept-next-mission (atomicAssignNextMission).
export async function offerNextMissionToOnRouteDrivers(
  batchId: string,
  zoneALat: number,
  zoneALng: number,
  batchVolume: number,
): Promise<void> {
  const candidates = await findCandidates(zoneALat, zoneALng, batchVolume);
  if (!candidates.length) return;

  const toNotify = candidates.slice(0, C.DRIVERS_PER_ROUND);

  await Promise.all(
    toNotify.map(c =>
      supabase.from('driver_notifications').insert({
        courier_id:  c.courierId,
        batch_id:    batchId,
        type:        'next_mission',
        is_accepted: false,
        metadata:    { end_zone: c.endZone },
      }),
    ),
  );

  console.log(
    `[Phase 11] Next-mission offer → ${toNotify.length} on_route driver(s) for batch ${batchId}`,
  );
}

// Called after a driver's current batch completes.
//
// New fast path (locked next mission):
//   If the driver already accepted a next mission via /accept-next-mission, the
//   batch is already 'assigned' to them — no further locking is needed. We just
//   ensure their courier status is on_route so /start-batch is immediately usable.
//
// Legacy fall-back (pre-accepted notification only):
//   If the driver only tapped "pre-accept" without the new atomic lock endpoint
//   (old flow), we attempt atomicAssign now that they are available.
export async function triggerQueuedNextMission(courierId: string): Promise<void> {
  // Fast path: batch is already locked to this driver (status='assigned', not yet in_transit).
  // 'assigned' batches are next missions that are confirmed but not yet started.
  // 'in_transit' batches are the currently-active run (which just completed, hence this call).
  const { data: lockedBatch } = await supabase
    .from('batches')
    .select('id')
    .eq('assigned_to', courierId)
    .eq('status', 'assigned')
    .order('assigned_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lockedBatch) {
    // The next mission is already locked. Make sure the courier is on_route so
    // /start-batch accepts the request immediately without a status mismatch.
    await supabase
      .from('couriers')
      .update({ status: 'on_route' })
      .eq('id', courierId)
      .eq('status', 'available'); // idempotent guard: no-op if already on_route

    console.log(
      `[Phase 11] Driver ${courierId} has confirmed next mission ${lockedBatch.id} — ready to start`,
    );
    return;
  }

  // Legacy fall-back: check for a pre-accepted notification whose batch is still
  // pending_assignment (driver used the old endpoint without atomic locking).
  const { data: notif } = await supabase
    .from('driver_notifications')
    .select('batch_id')
    .eq('courier_id', courierId)
    .eq('type', 'next_mission')
    .eq('is_accepted', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!notif?.batch_id) return;

  const batchId = notif.batch_id as string;

  const { data: batch } = await supabase
    .from('batches')
    .select('id')
    .eq('id', batchId)
    .eq('status', 'pending_assignment')
    .maybeSingle();

  if (!batch) {
    // Batch was taken by another driver while this driver was finishing their run
    await supabase.from('driver_notifications').insert({
      courier_id:  courierId,
      batch_id:    batchId,
      type:        'next_mission_expired',
      is_accepted: false,
    });
    console.log(
      `[Phase 11] Pre-accepted next mission ${batchId} already taken — notified courier ${courierId}`,
    );
    return;
  }

  // Driver is now available (current batch just completed); atomicAssign will
  // claim the batch and flip them back to on_route in one call.
  const result = await atomicAssign(batchId, courierId);

  if (result.success) {
    console.log(`[Phase 11] Next mission ${batchId} auto-assigned to courier ${courierId} (legacy)`);
  } else {
    console.warn(
      `[Phase 11] atomicAssign failed (${result.reason}) for next mission ${batchId} / courier ${courierId}`,
    );
  }
}
