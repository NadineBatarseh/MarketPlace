// ── Road Distance Provider ────────────────────────────────────────────────────
// Single source of truth for road distance between two coordinates.
//
// The logistics algorithms (e.g. phase10 intra-city sequencing) are SYNCHRONOUS,
// but fetching real road distances from Google + Supabase is ASYNC. We bridge that
// with an in-memory cache:
//
//   1. An async caller (the /sequence endpoint) `await prefetchPairs(locations)` to
//      warm the cache for every coordinate pair the algorithm will touch.
//   2. The algorithm then calls the SYNC `getRoadDistanceKm(...)`, which reads the
//      warm in-memory map — falling back to Haversine × ROAD_FACTOR on any miss, so
//      it never blocks and never throws.
//
// Persistence: every Google result is also written to the `road_distance_cache`
// Supabase table (see supabase/migrations/create_road_distance_cache.sql) so each
// directed coordinate pair is paid for at most once, ever.

import { supabase } from '../supabase.js';
import { C } from './constants.js';
import { haversineDistance } from './formulas.js';
import { Coordinates } from './types.js';

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const COORD_DECIMALS = 5;            // ≈ 1 m — round so repeated points reuse a cache row
const MAX_DESTS_PER_REQUEST = 25;    // Google Distance Matrix per-request destination cap

interface RoadMetrics {
  distanceKm: number;
  durationMin: number;
}

// In-memory cache, keyed by directed quantized pair. Lives for the process lifetime.
const memory = new Map<string, RoadMetrics>();

function quantize(n: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(n * f) / f;
}

function pairKey(aLat: number, aLng: number, bLat: number, bLng: number): string {
  return `${quantize(aLat)},${quantize(aLng)}|${quantize(bLat)},${quantize(bLng)}`;
}

// ── SYNC getter used by the algorithm ─────────────────────────────────────────
// Returns the cached road distance (km) if warmed; otherwise the Haversine estimate.
export function getRoadDistanceKm(
  aLat: number, aLng: number,
  bLat: number, bLng: number
): number {
  const hit = memory.get(pairKey(aLat, aLng, bLat, bLng));
  if (hit) return hit.distanceKm;
  return haversineDistance(aLat, aLng, bLat, bLng) * C.ROAD_FACTOR;
}

// Cached road duration (minutes) if warmed; otherwise estimated from Haversine.
export function getRoadDurationMin(
  aLat: number, aLng: number,
  bLat: number, bLng: number
): number {
  const hit = memory.get(pairKey(aLat, aLng, bLat, bLng));
  if (hit) return hit.durationMin;
  const km = haversineDistance(aLat, aLng, bLat, bLng) * C.ROAD_FACTOR;
  return (km / C.AVERAGE_SPEED_KMH) * 60;
}

// ── ASYNC warm-up: fetch every directed pair among `locations` ────────────────
export async function prefetchPairs(locations: Coordinates[]): Promise<void> {
  // De-dupe locations by quantized value.
  const uniq = new Map<string, Coordinates>();
  for (const loc of locations) {
    if (loc == null || loc.lat == null || loc.lng == null) continue;
    uniq.set(`${quantize(loc.lat)},${quantize(loc.lng)}`, {
      lat: quantize(loc.lat),
      lng: quantize(loc.lng),
    });
  }
  const points = [...uniq.values()];
  if (points.length < 2) return;

  // Build every directed pair not already in memory (skip a point to itself).
  const missing: Array<{ o: Coordinates; d: Coordinates }> = [];
  for (const o of points) {
    for (const d of points) {
      if (o.lat === d.lat && o.lng === d.lng) continue;
      if (!memory.has(pairKey(o.lat, o.lng, d.lat, d.lng))) {
        missing.push({ o, d });
      }
    }
  }
  if (missing.length === 0) return;

  // 1) Try Supabase before spending on Google. Over-fetch by origin lat/lng, then
  //    keep only the exact pairs we still need.
  try {
    const lats = [...new Set(points.map((p) => p.lat))];
    const lngs = [...new Set(points.map((p) => p.lng))];
    const { data, error } = await supabase
      .from('road_distance_cache')
      .select('origin_lat, origin_lng, dest_lat, dest_lng, distance_meters, duration_seconds')
      .in('origin_lat', lats)
      .in('origin_lng', lngs);

    if (error) {
      console.warn('[distanceProvider] cache read failed:', error.message);
    } else if (data) {
      for (const r of data) {
        memory.set(
          pairKey(r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng),
          { distanceKm: r.distance_meters / 1000, durationMin: r.duration_seconds / 60 }
        );
      }
    }
  } catch (err) {
    console.warn('[distanceProvider] cache read error:', (err as Error).message);
  }

  // Recompute what's still missing after the DB load.
  const stillMissing = missing.filter(
    ({ o, d }) => !memory.has(pairKey(o.lat, o.lng, d.lat, d.lng))
  );
  if (stillMissing.length === 0) return;

  // 2) Fetch the remainder from Google, grouped by origin.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('[distanceProvider] GOOGLE_MAPS_API_KEY not set — using Haversine fallback');
    return;
  }

  const byOrigin = new Map<string, { o: Coordinates; dests: Coordinates[] }>();
  for (const { o, d } of stillMissing) {
    const k = `${o.lat},${o.lng}`;
    if (!byOrigin.has(k)) byOrigin.set(k, { o, dests: [] });
    byOrigin.get(k)!.dests.push(d);
  }

  const rows: Array<Record<string, number>> = [];
  for (const { o, dests } of byOrigin.values()) {
    for (let i = 0; i < dests.length; i += MAX_DESTS_PER_REQUEST) {
      const chunk = dests.slice(i, i + MAX_DESTS_PER_REQUEST);
      try {
        const params = new URLSearchParams({
          origins: `${o.lat},${o.lng}`,
          destinations: chunk.map((d) => `${d.lat},${d.lng}`).join('|'),
          key: apiKey,
        });
        const resp = await fetch(`${DISTANCE_MATRIX_URL}?${params.toString()}`);
        const json = await resp.json();
        if (json.status !== 'OK') {
          console.warn('[distanceProvider] Distance Matrix status:', json.status, json.error_message ?? '');
          continue;
        }
        const elements = json.rows?.[0]?.elements ?? [];
        elements.forEach((el: any, idx: number) => {
          const d = chunk[idx];
          if (el?.status !== 'OK' || !el.distance || !el.duration) return;
          const meters = el.distance.value as number;
          const seconds = el.duration.value as number;
          memory.set(pairKey(o.lat, o.lng, d.lat, d.lng), {
            distanceKm: meters / 1000,
            durationMin: seconds / 60,
          });
          rows.push({
            origin_lat: o.lat, origin_lng: o.lng,
            dest_lat: d.lat, dest_lng: d.lng,
            distance_meters: meters, duration_seconds: seconds,
          });
        });
      } catch (err) {
        console.warn('[distanceProvider] Distance Matrix fetch error:', (err as Error).message);
      }
    }
  }

  // 3) Persist new results so the next run hits the cache.
  if (rows.length > 0) {
    try {
      const { error } = await supabase
        .from('road_distance_cache')
        .upsert(rows, { onConflict: 'origin_lat,origin_lng,dest_lat,dest_lng', ignoreDuplicates: true });
      if (error) console.warn('[distanceProvider] cache write failed:', error.message);
      else console.log(`[distanceProvider] cached ${rows.length} new road distance(s)`);
    } catch (err) {
      console.warn('[distanceProvider] cache write error:', (err as Error).message);
    }
  }
}
