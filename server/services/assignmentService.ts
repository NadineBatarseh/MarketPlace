/**
 * assignmentService.ts
 *
 * First-mile driver assignment algorithm.
 *
 * Takes pre-built batches (from batchingService) and a list of available
 * drivers, then assigns each batch to the best feasible driver using a
 * scored, constraint-relaxing greedy approach.
 *
 * This module handles ASSIGNMENT ONLY.
 * Routing within each batch is delegated to Google Routes API elsewhere.
 */

import { calculateDistance } from './batchingService.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignmentShop {
  shop_id: string;
  lat: number;
  lng: number;
  ready_time: number;   // Unix ms
  total_volume: number;
}

export interface AssignmentBatch {
  id: string;
  shops: AssignmentShop[];
  order_ids: number[];
  total_volume: number;
  stops: number;
  created_at: number;   // Unix ms — used to compute how long the batch has been waiting
}

export interface Driver {
  driver_id: string;
  lat: number;
  lng: number;
  available: boolean;
  available_at: number;       // Unix ms — when the driver will be free (≤ now if already free)
  remaining_capacity: number; // capacity units still available on this driver
  current_batches: number;    // how many batches already assigned this shift
}

export interface RelaxationStep {
  /** Batch has been waiting at least this many minutes to activate this step */
  wait_minutes: number;
  /** Multiply MAX_ASSIGNMENT_DISTANCE_KM by this factor at this step */
  max_distance_multiplier: number;
  /** Whether to consider drivers who are not yet available (future drivers) */
  allow_future_driver: boolean;
}

export interface AssignmentConfig {
  /** Max volume a driver can carry across all their batches */
  MAX_DRIVER_CAPACITY: number;
  /** Max number of batches a single driver can hold at once */
  MAX_DRIVER_BATCHES: number;
  /** Base max km between driver and the nearest shop in the batch */
  MAX_ASSIGNMENT_DISTANCE_KM: number;
  /** How much distance contributes to the candidate score */
  DISTANCE_WEIGHT: number;
  /** How much availability delay (minutes until driver is free) contributes */
  AVAILABILITY_WEIGHT: number;
  /** How much existing workload (current_batches count) contributes */
  LOAD_WEIGHT: number;
  /**
   * Ordered list of relaxation steps (ascending by wait_minutes).
   * As a batch ages, a progressively looser step is applied.
   */
  RELAXATION_STEPS: RelaxationStep[];
}

export interface AssignmentResult {
  /** batch_id → driver_id mapping for successfully assigned batches */
  assignments: Record<string, string>;
  /** Batches that could not be assigned to any driver */
  unassigned_batches: AssignmentBatch[];
  /** Driver states after assignment (reflecting updated capacity / workload) */
  updated_drivers: Driver[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the earliest ready_time (ms) among all shops in the batch.
 * Used to sort batches by urgency.
 */
export function getBatchEarliestReadyTime(batch: AssignmentBatch): number {
  return Math.min(...batch.shops.map((s) => s.ready_time));
}

/**
 * Returns the straight-line distance (km) from the driver's current position
 * to the nearest shop in the batch (Haversine).
 */
export function getNearestShopDistance(driver: Driver, batch: AssignmentBatch): number {
  let min = Infinity;
  for (const shop of batch.shops) {
    const d = calculateDistance(driver.lat, driver.lng, shop.lat, shop.lng);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Selects the tightest relaxation step that still applies given how long
 * the batch has been waiting.
 *
 * Steps must be sorted ascending by wait_minutes.
 * The last step whose wait_minutes ≤ waitMinutes is returned.
 * If none qualify yet, the first step is returned as the default.
 */
export function getRelaxationLevel(
  waitMinutes: number,
  steps: RelaxationStep[]
): RelaxationStep {
  let active = steps[0]; // default: first (most restrictive) step
  for (const step of steps) {
    if (waitMinutes >= step.wait_minutes) active = step;
  }
  return active;
}

// ─── Main Algorithm ───────────────────────────────────────────────────────────

/**
 * Assigns batches to drivers using a greedy scored approach with dynamic
 * constraint relaxation based on how long each batch has been waiting.
 *
 * Algorithm overview:
 *   1. Sort batches by earliest ready_time (oldest/most urgent first).
 *   2. For each batch:
 *      a. Compute wait time and select the matching relaxation step.
 *      b. Adjust the distance constraint using the relaxation multiplier.
 *      c. Filter drivers to those passing all hard constraints.
 *      d. Score each feasible driver — lower is better.
 *      e. Assign batch to the best driver and update driver state.
 *      f. If no driver passes, add to unassigned_batches.
 *   3. Return assignments, unassigned list, and updated driver states.
 *
 * @param batches  Pre-built first-mile batches from batchingService.
 * @param drivers  Current driver roster with live state (location, capacity).
 * @param config   Weights, hard limits, and relaxation schedule.
 */
export function assignBatchesToDrivers(
  batches: AssignmentBatch[],
  drivers: Driver[],
  config: AssignmentConfig
): AssignmentResult {
  const {
    MAX_DRIVER_CAPACITY,
    MAX_DRIVER_BATCHES,
    MAX_ASSIGNMENT_DISTANCE_KM,
    DISTANCE_WEIGHT,
    AVAILABILITY_WEIGHT,
    LOAD_WEIGHT,
    RELAXATION_STEPS,
  } = config;

  const nowMs = Date.now();

  // Step 1: Sort batches — oldest ready_time first (most urgent)
  const sorted = [...batches].sort(
    (a, b) => getBatchEarliestReadyTime(a) - getBatchEarliestReadyTime(b)
  );

  // Work on a mutable copy of drivers so we can track state changes
  const driverState: Driver[] = drivers.map((d) => ({ ...d }));

  const assignments: Record<string, string> = {};
  const unassigned_batches: AssignmentBatch[] = [];

  // Step 2–8: Evaluate each batch in priority order
  for (const batch of sorted) {

    // 2a. How long has this batch been waiting?
    const waitMinutes = (nowMs - batch.created_at) / 60_000;

    // 2b. Pick the relaxation step that matches the current wait time
    const relaxation = getRelaxationLevel(waitMinutes, RELAXATION_STEPS);

    // 3. Compute effective distance limit for this batch
    const effectiveMaxDistance = MAX_ASSIGNMENT_DISTANCE_KM * relaxation.max_distance_multiplier;

    let bestScore = Infinity;
    let bestDriverIndex = -1;

    // Step 4–5: Evaluate every driver
    for (let i = 0; i < driverState.length; i++) {
      const driver = driverState[i];

      // ── Hard constraint: capacity ────────────────────────────────────────────
      if (driver.remaining_capacity < batch.total_volume) continue;

      // ── Hard constraint: max concurrent batches ──────────────────────────────
      if (driver.current_batches >= MAX_DRIVER_BATCHES) continue;

      // ── Hard constraint: availability ────────────────────────────────────────
      // If the relaxation step does NOT allow future drivers, skip unavailable ones.
      if (!relaxation.allow_future_driver && !driver.available) continue;

      // ── Hard constraint: distance ────────────────────────────────────────────
      const distKm = getNearestShopDistance(driver, batch);
      if (distKm > effectiveMaxDistance) continue;

      // ── Step 5: Score — lower is better ─────────────────────────────────────
      // availability_delay: 0 if driver is free now, else minutes until free
      const availabilityDelayMinutes = Math.max(
        0,
        (driver.available_at - nowMs) / 60_000
      );

      const score =
        distKm                      * DISTANCE_WEIGHT     +
        availabilityDelayMinutes    * AVAILABILITY_WEIGHT +
        driver.current_batches      * LOAD_WEIGHT;

      if (score < bestScore) {
        bestScore = score;
        bestDriverIndex = i;
      }
    }

    // Step 6–7: Assign to best driver if found
    if (bestDriverIndex !== -1) {
      const winner = driverState[bestDriverIndex];

      assignments[batch.id] = winner.driver_id;

      // Update driver state to reflect the new assignment
      winner.remaining_capacity -= batch.total_volume;
      winner.current_batches    += 1;

      // If driver was not yet available, keep available=false; the caller
      // should re-check once available_at passes (retry mechanism step 9).
    } else {
      // Step 8: No feasible driver — queue for retry
      unassigned_batches.push(batch);
    }
  }

  return {
    assignments,
    unassigned_batches,
    updated_drivers: driverState,
  };
}
