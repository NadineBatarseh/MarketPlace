// ── Shipment ETA ───────────────────────────────────────────────────────────────
// Best-effort, per-shipment `estimated_delivery_at` maintained at lifecycle
// transitions (never a continuous/live-GPS recompute — see the redesign plan
// for the full hook table). Every function here is fire-and-forget: it must
// never throw into the caller's transition, matching the pattern already used
// by insertDriverTrackingEvent in logistics/index.ts.
//
// This is a single-hop "closest known point → dropoff" estimate, not a
// cumulative sum across every stop still ahead of a shipment in a multi-stop
// batch — the intentional trade-off for this pass's scope.

import { supabase } from '../supabase.js';
import { prefetchFromOrigin, getRoadDurationMin } from './distanceProvider.js';
import { Coordinates } from './types.js';

export interface EtaTarget {
  id: string;
  dropoff_lat: number;
  dropoff_lng: number;
}

// Computes and persists a route-based ETA for each of `rows` from a single
// shared `origin` (e.g. a zone centroid or a courier's live location).
export async function applyRouteEta(rows: EtaTarget[], origin: Coordinates): Promise<void> {
  if (rows.length === 0) return;
  try {
    await prefetchFromOrigin(origin, rows.map((r) => ({ lat: r.dropoff_lat, lng: r.dropoff_lng })));

    const now = Date.now();
    const computedAt = new Date(now).toISOString();
    const updates = rows.map((r) => {
      const durationMin = getRoadDurationMin(origin.lat, origin.lng, r.dropoff_lat, r.dropoff_lng);
      return {
        id: r.id,
        estimated_delivery_at: new Date(now + durationMin * 60_000).toISOString(),
      };
    });

    await Promise.all(
      updates.map(({ id, estimated_delivery_at }) =>
        supabase
          .from('shipments')
          .update({ estimated_delivery_at, eta_source: 'route_estimate', eta_computed_at: computedAt })
          .eq('id', id)
      )
    );
  } catch (err) {
    console.warn('[eta] applyRouteEta failed:', (err as Error).message);
  }
}

// Reverts shipments to their flat SLA deadline — used whenever a shipment
// leaves a batch/reservation and no longer has a live route estimate backing it.
export async function resetToFallback(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const { data: rows, error: readError } = await supabase
      .from('shipments')
      .select('id, deadline')
      .in('id', ids);
    if (readError || !rows) {
      console.warn('[eta] resetToFallback read failed:', readError?.message);
      return;
    }

    const computedAt = new Date().toISOString();
    await Promise.all(
      rows.map((r) =>
        supabase
          .from('shipments')
          .update({ estimated_delivery_at: r.deadline, eta_source: 'sla_fallback', eta_computed_at: computedAt })
          .eq('id', r.id)
      )
    );
  } catch (err) {
    console.warn('[eta] resetToFallback failed:', (err as Error).message);
  }
}

// Clears the ETA entirely — used only when goods are stranded mid-route with
// no reliable estimate (a dispatcher decision hasn't been made yet).
export async function markUnknown(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const { error } = await supabase
      .from('shipments')
      .update({ estimated_delivery_at: null, eta_source: 'unknown', eta_computed_at: new Date().toISOString() })
      .in('id', ids);
    if (error) console.warn('[eta] markUnknown failed:', error.message);
  } catch (err) {
    console.warn('[eta] markUnknown failed:', (err as Error).message);
  }
}
