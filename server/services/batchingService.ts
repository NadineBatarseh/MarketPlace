/**
 * batchingService.ts
 *
 * First-mile pickup batching algorithm.
 *
 * Transforms a list of shop pickups (one entry per shop with pending packages)
 * into optimized driver batches, grouping nearby shops that are ready around
 * the same time and fit within a single driver's capacity.
 *
 * NOTE: This module handles grouping only. Actual route ordering within each
 * batch is delegated to Google Routes API (see mapsService.ts).
 */

import RBush from 'rbush';
import { supabase } from '../supabase.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShopItem {
  product_title: string;
  qty: number;
}

export interface ShopPickup {
  shop_id: string;
  shop_name: string;
  lat: number;
  lng: number;
  /** Unix timestamp (ms) — earliest order ready_time for this shop */
  ready_time: number;
  /** Sum of capacity_units for all pending packages at this shop */
  total_volume: number;
  /** All order IDs linked to this shop's pending packages */
  order_ids: number[];
  /** Individual product lines to be collected from this shop */
  items: ShopItem[];
  /** Optional zone identifier — used for the Stage 1 zone-match fast-reject */
  zone_id?: string;
}

export interface BatchConfig {
  /** Maximum total volume (capacity_units) a single driver can carry */
  MAX_DRIVER_CAPACITY: number;
  /** Maximum number of shop stops per driver batch */
  MAX_STOPS_PER_BATCH: number;
  /** Maximum time (minutes) a package is allowed to wait before pickup */
  MAX_ALLOWED_WAIT: number;
  /** Maximum distance (km) between any candidate shop and the nearest shop already in the batch */
  MAX_DISTANCE_KM: number;
}

export interface Batch {
  shops: ShopPickup[];
  order_ids: number[];
  total_volume: number;
  stops: number;
}

// ─── R-tree Spatial Index Types ───────────────────────────────────────────────

interface ShopRBushItem {
  minX: number; // lng
  minY: number; // lat
  maxX: number; // lng (same as minX — point feature)
  maxY: number; // lat (same as minY — point feature)
  shop: ShopPickup;
}

// Converts kilometres to approximate lat/lng degrees (equatorial approximation,
// accurate enough for city-scale distances up to ~50 km).
function kmToDeg(km: number): number {
  return km / 111;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Weight applied to wait time (minutes) when computing the candidate score.
 *  Balances distance (km) vs urgency so that packages close to their deadline
 *  are prioritised over slightly closer ones that can still wait. */
const WAIT_WEIGHT = 0.1;

// ─── Haversine Distance ───────────────────────────────────────────────────────

/**
 * Calculates the great-circle distance between two coordinates using the
 * Haversine formula. Returns the result in kilometres.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's mean radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the shop in the batch nearest to the candidate (by Haversine) and
 * the straight-line distance to it in km.
 */
function findNearestInBatch(
  candidate: ShopPickup,
  batchShops: ShopPickup[]
): { shop: ShopPickup; haversineKm: number } {
  let nearestShop = batchShops[0];
  let minKm = calculateDistance(
    candidate.lat, candidate.lng,
    batchShops[0].lat, batchShops[0].lng
  );
  for (let i = 1; i < batchShops.length; i++) {
    const d = calculateDistance(
      candidate.lat, candidate.lng,
      batchShops[i].lat, batchShops[i].lng
    );
    if (d < minKm) {
      minKm = d;
      nearestShop = batchShops[i];
    }
  }
  return { shop: nearestShop, haversineKm: minKm };
}

/**
 * Returns the oldest ready_time (ms) among all shops in the batch.
 * Used to compute how long the earliest package has been waiting.
 */
function oldestReadyTime(batchShops: ShopPickup[]): number {
  return Math.min(...batchShops.map((s) => s.ready_time));
}

// ─── Google Distance Matrix API ───────────────────────────────────────────────

/**
 * Calls the Google Distance Matrix API for a single origin→destination pair.
 * Returns road distance in km and driving duration in minutes.
 */
async function fetchRoadDistance(
  shopA: ShopPickup,
  shopB: ShopPickup
): Promise<{ distanceKm: number; durationMins: number }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not set in .env');

  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${shopA.lat},${shopA.lng}` +
    `&destinations=${shopB.lat},${shopB.lng}` +
    `&mode=driving` +
    `&key=${apiKey}`;

  const response = await fetch(url);
  const data: any = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Distance Matrix API error: ${data.status}`);
  }

  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') {
    throw new Error(`Distance Matrix element status: ${element?.status ?? 'UNKNOWN'}`);
  }

  return {
    distanceKm: element.distance.value / 1000,
    durationMins: Math.round(element.duration.value / 60),
  };
}

// ─── 4-Stage Distance Filtering Funnel ───────────────────────────────────────

/**
 * Determines whether a candidate shop is close enough to the nearest shop
 * already in the batch, using a 4-stage funnel to minimise Google Maps API
 * calls.
 *
 * Stages:
 *   1. Zone check      — instant reject if zone IDs are known and differ.
 *   2. Haversine bound — instant reject if aerial distance > maxDistance
 *                        (road distance can only be ≥ aerial distance).
 *   3. DB cache        — use a previously stored road distance if available.
 *   4. Google Maps API — fetch road distance, cache the result, then decide.
 *
 * Returns `accepted` and the best available `distKm` (road when possible,
 * Haversine as a fallback on API error) for use in the scoring step.
 */
async function checkDistanceFunnel(
  candidate: ShopPickup,
  batchShops: ShopPickup[],
  batchZoneId: string | undefined,
  maxDistance: number
): Promise<{ accepted: boolean; distKm: number }> {

  // ── Stage 1: Zone Check ────────────────────────────────────────────────────
  // If both sides have a zone_id and they differ, road distance will never be
  // within the same local cluster — reject immediately without computation.
  if (
    batchZoneId !== undefined &&
    candidate.zone_id !== undefined &&
    candidate.zone_id !== batchZoneId
  ) {
    return { accepted: false, distKm: Infinity };
  }

  // ── Stage 2: Haversine Safe Lower Bound ───────────────────────────────────
  // Straight-line (aerial) distance is always ≤ road distance.
  // If even the aerial distance already exceeds maxDistance, the road
  // distance certainly will too — reject without any external call.
  const { shop: nearestShop, haversineKm } = findNearestInBatch(candidate, batchShops);
  if (haversineKm > maxDistance) {
    return { accepted: false, distKm: haversineKm };
  }

  // Sort UUIDs so that shop_id_a is always the lexicographically smaller one.
  // This normalises storage so every pair has exactly one canonical row.
  const [idA, idB] = [candidate.shop_id, nearestShop.shop_id].sort();

  // ── Stage 3: DB Cache Check ────────────────────────────────────────────────
  // Query shop_distances for a pre-computed road distance between this pair.
  try {
    const { data: cached } = await supabase
      .from('shop_distances')
      .select('distance_km')
      .eq('shop_id_a', idA)
      .eq('shop_id_b', idB)
      .maybeSingle();

    if (cached !== null) {
      const distKm = parseFloat(cached.distance_km);
      return { accepted: distKm <= maxDistance, distKm };
    }
  } catch {
    // Cache read failure is non-fatal — fall through to the API call.
  }

  // ── Stage 4: Google Maps API & Cache Update ────────────────────────────────
  // Distance not in cache — fetch from Google and persist for future batching.
  try {
    const { distanceKm, durationMins } = await fetchRoadDistance(candidate, nearestShop);

    // Fire-and-forget upsert; batching must not block on a cache write.
    supabase
      .from('shop_distances')
      .upsert({ shop_id_a: idA, shop_id_b: idB, distance_km: distanceKm, duration_mins: durationMins })
      .then(({ error }) => {
        if (error) console.error('[batchingService] shop_distances upsert failed:', error.message);
      });

    return { accepted: distanceKm <= maxDistance, distKm: distanceKm };
  } catch (err) {
    // API failure is non-fatal — fall back to the Haversine distance so
    // batching can continue; the cache will be populated on a future run.
    console.error('[batchingService] Distance Matrix API failed, using Haversine fallback:', err);
    return { accepted: haversineKm <= maxDistance, distKm: haversineKm };
  }
}

// ─── Main Algorithm ───────────────────────────────────────────────────────────

/**
 * Groups shop pickups into driver batches using a greedy nearest-neighbour
 * approach with four hard constraints (capacity, stops, distance, wait time)
 * and a distance+urgency score for tie-breaking.
 *
 * Algorithm overview:
 *   1. Sort shops by ready_time ascending (oldest packages first).
 *   2. Seed each batch with the next unbatched shop.
 *   3. Repeatedly absorb the best neighbouring candidate until no valid
 *      candidate remains, then close the batch and start a new one.
 *
 * Distance filtering is performed via a 4-stage funnel (zone → Haversine →
 * DB cache → Google Maps API) to minimise external API calls.
 *
 * @param shopPickups  Pre-built list of shop-level aggregates.
 * @param config       Hard constraints for a single driver batch.
 * @returns            Array of batches, each ready for route computation.
 */
export async function createBatches(
  shopPickups: ShopPickup[],
  config: BatchConfig
): Promise<Batch[]> {
  const {
    MAX_DRIVER_CAPACITY,
    MAX_STOPS_PER_BATCH,
    MAX_DISTANCE_KM,
  } = config;

  // Step 1: Sort ascending by ready_time so the most urgent shop seeds each batch.
  const sorted = [...shopPickups].sort((a, b) => a.ready_time - b.ready_time);

  // Step 2: Build R-tree from all shop coordinates — O(N log N) bulk load.
  // Each shop is stored as a point (minX==maxX, minY==maxY).
  const tree = new RBush<ShopRBushItem>();
  tree.load(
    sorted.map((s) => ({ minX: s.lng, minY: s.lat, maxX: s.lng, maxY: s.lat, shop: s }))
  );

  // Track which shops have already been assigned to a batch.
  // Using a Set gives O(1) lookup instead of O(N) array scan.
  const assigned = new Set<string>();

  // Index pointer into `sorted` for O(1) amortised seed extraction.
  // Replaces the O(N) remaining.shift() call from the previous version.
  let seedPtr = 0;

  const batches: Batch[] = [];
  const nowMs = Date.now();
  const deg = kmToDeg(MAX_DISTANCE_KM); // bbox half-width in degrees

  // Step 3: Keep creating batches until every shop is assigned.
  while (seedPtr < sorted.length) {
    // Advance past already-assigned shops to find the next seed.
    while (seedPtr < sorted.length && assigned.has(sorted[seedPtr].shop_id)) seedPtr++;
    if (seedPtr >= sorted.length) break;

    // Step 3a: Take the oldest unbatched shop as the seed for this batch.
    const seed = sorted[seedPtr++];
    assigned.add(seed.shop_id);

    // The batch's zone is determined by its seed. Any candidate whose zone_id
    // differs will be filtered out in Stage 1 of the distance funnel.
    const batchZoneId = seed.zone_id;

    // Step 3b: Initialise the batch with the seed.
    const batchShops: ShopPickup[] = [seed];
    let totalVolume = seed.total_volume;
    let stops = 1;
    const orderIds = new Set<number>(seed.order_ids);

    // Step 3c–e: Expand the batch by finding the best candidate each iteration.
    let expanded = true;
    while (expanded) {
      expanded = false;

      let bestScore = Infinity;
      let bestItem: ShopRBushItem | null = null;

      // Compute the bounding box that covers all shops already in the batch,
      // expanded by MAX_DISTANCE_KM on every side. Any shop outside this box
      // is more than MAX_DISTANCE_KM from every batch shop by construction,
      // so we skip the distance funnel for them entirely.
      const batchMinX = Math.min(...batchShops.map((s) => s.lng)) - deg;
      const batchMinY = Math.min(...batchShops.map((s) => s.lat)) - deg;
      const batchMaxX = Math.max(...batchShops.map((s) => s.lng)) + deg;
      const batchMaxY = Math.max(...batchShops.map((s) => s.lat)) + deg;

      // R-tree range query — O(log N + m) where m = shops inside the box.
      const nearby = tree.search({ minX: batchMinX, minY: batchMinY, maxX: batchMaxX, maxY: batchMaxY });

      for (const item of nearby) {
        const candidate = item.shop;

        // Skip shops already absorbed into a batch.
        if (assigned.has(candidate.shop_id)) continue;

        // ── Capacity constraint ──────────────────────────────────────────────
        if (totalVolume + candidate.total_volume > MAX_DRIVER_CAPACITY) continue;

        // ── Stops constraint ────────────────────────────────────────────────
        if (stops + 1 > MAX_STOPS_PER_BATCH) continue;

        // ── Distance constraint (4-stage funnel) ─────────────────────────────
        // Stage 1: zone check, Stage 2: Haversine bound (box corners cleanup),
        // Stage 3: DB cache, Stage 4: Google Maps API.
        const { accepted, distKm } = await checkDistanceFunnel(
          candidate, batchShops, batchZoneId, MAX_DISTANCE_KM
        );
        if (!accepted) continue;

        // ── Score: lower is better ───────────────────────────────────────────
        const waitMinutes = (nowMs - oldestReadyTime(batchShops)) / 60_000;
        const score = distKm + waitMinutes * WAIT_WEIGHT;

        if (score < bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }

      // Step 3d: If a valid candidate was found, absorb it into the batch.
      if (bestItem !== null) {
        const picked = bestItem.shop;
        assigned.add(picked.shop_id);
        tree.remove(bestItem, (a, b) => a.shop.shop_id === b.shop.shop_id);
        batchShops.push(picked);
        totalVolume += picked.total_volume;
        stops += 1;
        picked.order_ids.forEach((id) => orderIds.add(id));
        expanded = true; // keep looking for more candidates
      }
      // Step 3e: No suitable candidate found — close this batch.
    }

    // Step 3f: Finalise and store the batch.
    batches.push({
      shops: batchShops,
      order_ids: Array.from(orderIds),
      total_volume: totalVolume,
      stops,
    });
  }

  // Step 4: Return all batches.
  return batches;
}
