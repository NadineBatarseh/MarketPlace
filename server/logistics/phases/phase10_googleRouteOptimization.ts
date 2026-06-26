import { GoogleAuth } from 'google-auth-library';
import { C } from '../constants.js';
import { Coordinates, IntraCityTask } from '../types.js';

// Phase 10 (Google variant) — Intra-City Sequencing via Google Route Optimization.
//
// Replaces the hand-written Greedy + 2-opt sequencer with Google's Route
// Optimization API (cloud.google.com/optimization). Google solves the
// Pickup-and-Delivery Problem with capacity, time windows, and live traffic;
// we then re-validate its result before trusting it.
//
// This module THROWS on any failure (missing config, network error, API error,
// infeasible/invalid result). The caller (logistics/index.ts) catches and falls
// back to the local Greedy + 2-opt sequencer, so a Google outage never blocks
// dispatch.

const OPTIMIZE_TOURS_URL = (projectId: string) =>
  `https://routeoptimization.googleapis.com/v1/projects/${projectId}:optimizeTours`;

const LOAD_TYPE = 'weight'; // single load dimension — matches IntraCityTask.volume

// ── A "shipment" as Google models it: an optional pickup + optional delivery ──
interface PairedShipment {
  shipment_id: string;
  pickup: IntraCityTask | null;
  delivery: IntraCityTask | null;
  volume: number;
}

// Re-pair the flat task list into Google shipments keyed by shipment_id.
// A pickup and delivery sharing a shipment_id become one shipment, which makes
// Google enforce pickup-before-delivery automatically. A delivery with no
// matching pickup means the goods are already on the vehicle (initial_volume).
function pairTasks(tasks: IntraCityTask[]): PairedShipment[] {
  const byId = new Map<string, PairedShipment>();
  for (const t of tasks) {
    let entry = byId.get(t.shipment_id);
    if (!entry) {
      entry = { shipment_id: t.shipment_id, pickup: null, delivery: null, volume: t.volume };
      byId.set(t.shipment_id, entry);
    }
    if (t.type === 'pickup') entry.pickup = t;
    else entry.delivery = t;
    entry.volume = t.volume; // pickup and delivery of one shipment carry the same volume
  }
  return [...byId.values()];
}

// Route Optimization rejects timestamps with sub-second precision ("`nanos` must
// be unset"), so emit RFC3339 with whole seconds only. Returns null for an
// unparseable value so the caller can simply omit that time window.
function rfc3339(value: string | Date): string | null {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Every time window must lie within the global [start, end] window, or the API
// rejects it. Clamp a timestamp into those bounds. Both bounds are RFC3339 UTC
// 'Z' strings, which compare correctly lexicographically. A past deadline clamps
// to `minIso` ("overdue — deliver ASAP"); null/invalid input drops the window.
function clampIso(value: string | null | undefined, minIso: string, maxIso: string): string | null {
  if (!value) return null;
  const t = rfc3339(value);
  if (!t) return null;
  if (t < minIso) return minIso;
  if (t > maxIso) return maxIso;
  return t;
}

// A delivery deadline is a SOFT target. A past deadline can't be honored, and
// pinning its soft end to the window start makes Google deem the visit impossible
// to perform within the vehicle's time window (it gets SKIPPED). So drop the
// window for past/now deadlines ("overdue — just deliver it") and keep it only
// for future deadlines, capped under the global window end.
function softDeadline(deadline: string, nowIso: string, endIso: string): string | undefined {
  const t = rfc3339(deadline);
  if (!t || t <= nowIso) return undefined;
  return t > endIso ? endIso : t;
}

function visitRequest(loc: Coordinates, window?: { startTime?: string; softEndTime?: string }) {
  const req: Record<string, unknown> = {
    arrivalLocation: { latitude: loc.lat, longitude: loc.lng },
  };
  if (window) {
    const tw: Record<string, unknown> = {};
    const start = window.startTime ? rfc3339(window.startTime) : null;
    const softEnd = window.softEndTime ? rfc3339(window.softEndTime) : null;
    if (start) tw.startTime = start;
    if (softEnd) {
      tw.softEndTime = softEnd;
      // Penalize (but don't forbid) arriving after the deadline → "before deadline
      // as much as possible" without making the problem infeasible.
      tw.costPerHourAfterSoftEndTime = C.COST_PER_KM * C.AVERAGE_SPEED_KMH;
    }
    if (Object.keys(tw).length > 0) req.timeWindows = [tw];
  }
  return req;
}

function buildRequest(
  paired: PairedShipment[],
  entryPoint: Coordinates,
  initialVolume: number,
  nowIso: string,
  endIso: string,
) {
  // Only model capacity when there are pickups that actually ADD load on this leg.
  // A pure delivery leg carries goods already loaded (and already within capacity
  // when the batch was formed), so imposing a maxLoad/startLoad here would make
  // Google SKIP stops it thinks don't fit — we must visit all of them instead.
  const hasPickups = paired.some((p) => p.pickup);

  const shipments = paired.map((p) => {
    const shipment: Record<string, unknown> = {};
    if (hasPickups) {
      shipment.loadDemands = { [LOAD_TYPE]: { amount: String(Math.round(p.volume)) } };
    }
    if (p.pickup) {
      shipment.pickups = [
        visitRequest(p.pickup.location, {
          startTime: clampIso(p.pickup.ready_time, nowIso, endIso) ?? undefined,
        }),
      ];
    }
    if (p.delivery) {
      shipment.deliveries = [
        visitRequest(p.delivery.location, {
          softEndTime: softDeadline(p.delivery.deadline, nowIso, endIso),
        }),
      ];
    }
    return shipment;
  });

  const vehicle: Record<string, unknown> = {
    startWaypoint: { location: { latLng: { latitude: entryPoint.lat, longitude: entryPoint.lng } } },
    costPerKilometer: C.COST_PER_KM,
  };
  if (hasPickups) {
    const loadLimit: Record<string, unknown> = { maxLoad: String(Math.round(C.MAX_VOLUME)) };
    if (initialVolume > 0) {
      // Goods already on board when the vehicle enters the city.
      const amt = String(Math.round(initialVolume));
      loadLimit.startLoadInterval = { min: amt, max: amt };
    }
    vehicle.loadLimits = { [LOAD_TYPE]: loadLimit };
  }

  return {
    model: {
      globalStartTime: nowIso,
      globalEndTime: endIso,
      shipments,
      vehicles: [vehicle],
    },
    considerRoadTraffic: true,
  };
}

// Mint an OAuth2 access token from Application Default Credentials
// (GOOGLE_APPLICATION_CREDENTIALS points at a service-account JSON).
async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google access token');
  return token;
}

// ── Main export ───────────────────────────────────────────────────────────────
// Returns the ordered task list, or THROWS so the caller can fall back.
export async function sequenceIntraCityTasksGoogle(
  tasks: IntraCityTask[],
  entryPoint: Coordinates,
  initialVolume: number,
): Promise<IntraCityTask[]> {
  if (tasks.length === 0) return [];

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT_ID not set');

  const paired = pairTasks(tasks);

  // Build the request. now/end times are passed in so this module stays free of
  // side effects on the global clock during testing.
  const now = new Date();
  // Global window end = at least 7 days out, extended (with a 1h buffer) to cover
  // any deadline further in the future. A wide window ensures a stop is never
  // skipped just for being far ("cannot be performed within vehicle time window").
  let endMs = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  for (const t of tasks) {
    const d = new Date(t.deadline).getTime();
    if (!isNaN(d) && d + 60 * 60 * 1000 > endMs) endMs = d + 60 * 60 * 1000;
  }
  const nowIso = rfc3339(now)!;
  const endIso = rfc3339(new Date(endMs))!;

  // Diagnostic: dump every task's coords + deadline so an out-of-range stop is
  // obvious. The skipped indices in the response map to this `paired` order.
  console.log(
    `[Route Optimization] window ${nowIso} → ${endIso}; ${paired.length} shipment(s):\n` +
      paired.map((p, i) => {
        const t = p.delivery ?? p.pickup!;
        return `  [${i}] ${t.location.lat.toFixed(5)},${t.location.lng.toFixed(5)} dl=${t.deadline}`;
      }).join('\n'),
  );

  const body = buildRequest(paired, entryPoint, initialVolume, nowIso, endIso);

  const token = await getAccessToken();
  const resp = await fetch(OPTIMIZE_TOURS_URL(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Route Optimization HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const json: any = await resp.json();
  const route = json?.routes?.[0];
  const visits: any[] = route?.visits ?? [];
  if (visits.length === 0) throw new Error('Route Optimization returned no visits');

  // If Google couldn't serve every shipment it lists them here — surface it so a
  // length mismatch below isn't a silent mystery.
  const skipped: any[] = json?.skippedShipments ?? [];
  if (skipped.length > 0) {
    console.warn(
      `[Route Optimization] skipped ${skipped.length} shipment(s):`,
      JSON.stringify(skipped.slice(0, 5)),
    );
  }

  // Map each visit back to its IntraCityTask, preserving Google's order. Proto3
  // JSON OMITS default values, so a visit to shipment 0 has no `shipmentIndex`
  // field, and a delivery (isPickup=false) has no `isPickup` field — default both.
  const sequence: IntraCityTask[] = [];
  for (const v of visits) {
    const idx = v.shipmentIndex ?? 0;
    const isPickup = v.isPickup ?? false;
    const p = paired[idx];
    if (!p) throw new Error(`Visit references unknown shipmentIndex ${idx}`);
    const task = isPickup ? p.pickup : p.delivery;
    if (!task) throw new Error(`Visit references missing ${isPickup ? 'pickup' : 'delivery'} task`);
    sequence.push(task);
  }

  // Re-validate Google's plan before trusting it: every task must be present,
  // capacity must stay within [0, MAX_VOLUME], and each delivery must come after
  // its own pickup.
  validateSequence(sequence, tasks, initialVolume);

  return sequence;
}

function validateSequence(
  sequence: IntraCityTask[],
  originalTasks: IntraCityTask[],
  initialVolume: number,
): void {
  if (sequence.length !== originalTasks.length) {
    throw new Error(
      `Sequence length ${sequence.length} != task count ${originalTasks.length}`,
    );
  }

  // Upper bound allows a delivery leg that started legitimately over the nominal
  // capacity (goods already aboard) — we only reject impossible states.
  const cap = Math.max(C.MAX_VOLUME, initialVolume);
  const pickedUp = new Set<string>();
  let vol = initialVolume;
  for (const task of sequence) {
    if (task.type === 'pickup') {
      pickedUp.add(task.shipment_id);
      vol += task.volume;
    } else {
      // Delivery for a shipment whose pickup is in THIS task list must follow it.
      const hasPickupInList = originalTasks.some(
        (t) => t.shipment_id === task.shipment_id && t.type === 'pickup',
      );
      if (hasPickupInList && !pickedUp.has(task.shipment_id)) {
        throw new Error(`Delivery before pickup for shipment ${task.shipment_id}`);
      }
      vol -= task.volume;
    }
    if (vol < 0 || vol > cap) {
      throw new Error(`Capacity out of bounds (${vol}) during sequence`);
    }
  }
}
