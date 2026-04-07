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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShopPickup {
  shop_id: string;
  lat: number;
  lng: number;
  /** Unix timestamp (ms) — earliest order ready_time for this shop */
  ready_time: number;
  /** Sum of capacity_units for all pending packages at this shop */
  total_volume: number;
  /** All order IDs linked to this shop's pending packages */
  order_ids: number[];
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
 * Returns the minimum distance (km) from a candidate shop to any shop
 * already present in the current batch.
 */
function minDistanceToBatch(candidate: ShopPickup, batchShops: ShopPickup[]): number {
  let min = Infinity;
  for (const shop of batchShops) {
    const d = calculateDistance(candidate.lat, candidate.lng, shop.lat, shop.lng);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Returns the oldest ready_time (ms) among all shops in the batch.
 * Used to compute how long the earliest package has been waiting.
 */
function oldestReadyTime(batchShops: ShopPickup[]): number {
  return Math.min(...batchShops.map((s) => s.ready_time));
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
 * @param shopPickups  Pre-built list of shop-level aggregates.
 * @param config       Hard constraints for a single driver batch.
 * @returns            Array of batches, each ready for route computation.
 */
export function createBatches(
  shopPickups: ShopPickup[],
  config: BatchConfig
): Batch[] {
  const {
    MAX_DRIVER_CAPACITY,
    MAX_STOPS_PER_BATCH,
    MAX_ALLOWED_WAIT,
    MAX_DISTANCE_KM,
  } = config;

  // Step 1: Sort ascending by ready_time so the most urgent shop seeds each batch.
  const remaining = [...shopPickups].sort((a, b) => a.ready_time - b.ready_time);

  const batches: Batch[] = [];
  const nowMs = Date.now();

  // Step 3: Keep creating batches until every shop is assigned.
  while (remaining.length > 0) {
    // Step 3a: Take the oldest unbatched shop as the seed for this batch.
    const seed = remaining.shift()!;

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
      let bestIndex = -1;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];

        // ── Capacity constraint ──────────────────────────────────────────────
        if (totalVolume + candidate.total_volume > MAX_DRIVER_CAPACITY) continue;

        // ── Stops constraint ────────────────────────────────────────────────
        if (stops + 1 > MAX_STOPS_PER_BATCH) continue;

        // ── Distance constraint ─────────────────────────────────────────────
        const distKm = minDistanceToBatch(candidate, batchShops);
        if (distKm > MAX_DISTANCE_KM) continue;

        // ── Wait constraint ──────────────────────────────────────────────────
        // How long has the oldest package in the batch been waiting (minutes)?
        const waitMinutes = (nowMs - oldestReadyTime(batchShops)) / 60_000;
        if (waitMinutes > MAX_ALLOWED_WAIT) continue;

        // ── Score: lower is better ───────────────────────────────────────────
        // Combines proximity (km) with urgency (wait × weight) so that a
        // slightly farther shop can still win if it has been waiting much longer.
        const score = distKm + waitMinutes * WAIT_WEIGHT;

        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      // Step 3d: If a valid candidate was found, absorb it into the batch.
      if (bestIndex !== -1) {
        const [picked] = remaining.splice(bestIndex, 1);
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
