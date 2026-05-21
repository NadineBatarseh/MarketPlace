import { supabase } from '../supabase';

export const C = {
  // ── Capacity (overridable from batch_config) ─────────────────
  MAX_VOLUME: 100,
  MAX_STOPS: 20,

  // ── Batch threshold (D5) ─────────────────────────────────────
  MIN_BATCH_THRESHOLD: 5,

  // ── Time windows (MAX_FLOW_WAITING_MINUTES overridable) ──────
  CYCLE_INTERVAL_MINUTES: 30,
  MAX_FLOW_WAITING_MINUTES: 120,
INTRA_CITY_MIN_TIME_BUFFER_MINUTES: 15,

  // ── Max distance between stops (overridable from batch_config)
  MAX_DISTANCE_KM: 50,

  // ── Scoring weights (must sum to 1) ─────────────────────────
  W_N: 0.35,
  W_U: 0.45,
  W_D: 0.20,

  // ── Dead-end penalty (D13) ──────────────────────────────────
  BASE_PENALTY: 0.20,

  // ── Emergency re-batch trigger threshold (D21) ──────────────
  URGENCY_THRESHOLD: 0.70,

  // ── Cost (F3) ───────────────────────────────────────────────
  COST_PER_KM: 2.5,
  ROAD_FACTOR: 1.3,
  AVERAGE_SPEED_KMH: 60,

  // ── Driver assignment (D33) ─────────────────────────────────
  W_PROX: 0.50,
  W_CAP: 0.30,
  W_LOAD: 0.20,
  LAMBDA: 0.1,
  MAX_SHIFT_HOURS: 10,
  DRIVERS_PER_ROUND: 3,
  ASSIGNMENT_TIMEOUT_MS: 300_000,
  MAX_ASSIGNMENT_ROUNDS: 3,

  // ── Intra-city sequencing (D31) ─────────────────────────────
  W_DIST: 0.60,
  W_URG: 0.40,
};

// Loads all admin-configurable fields from batch_config (id = 1)
// and merges them into C. Called once at the start of each batch cycle.
export async function loadConfigFromDB(): Promise<void> {
  const { data, error } = await supabase
    .from('batch_config')
    .select(`
      max_driver_capacity, max_stops_per_batch, min_batch_threshold,
      flow_grouping_window_minutes, max_allowed_wait, max_distance_km,
      weight_shipment_count, weight_urgency, weight_duration,
      base_dead_end_penalty, cost_per_km, road_factor,
      min_time_to_zone_b_for_addition,
      drivers_per_round, max_assignment_rounds, assignment_timeout_seconds
    `)
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.warn('[Config] Could not load batch_config, using defaults:', error?.message);
    return;
  }

  C.MAX_VOLUME                        = data.max_driver_capacity;
  C.MAX_STOPS                         = data.max_stops_per_batch;
  C.MIN_BATCH_THRESHOLD               = data.min_batch_threshold;
  C.CYCLE_INTERVAL_MINUTES            = data.flow_grouping_window_minutes;
  C.MAX_FLOW_WAITING_MINUTES          = data.max_allowed_wait;
  C.MAX_DISTANCE_KM                   = data.max_distance_km;
  C.W_N                               = data.weight_shipment_count;
  C.W_U                               = data.weight_urgency;
  C.W_D                               = data.weight_duration;
  C.BASE_PENALTY                      = data.base_dead_end_penalty;
  C.COST_PER_KM                        = data.cost_per_km;
  C.ROAD_FACTOR                        = data.road_factor;
  C.INTRA_CITY_MIN_TIME_BUFFER_MINUTES = data.min_time_to_zone_b_for_addition;
  if (data.drivers_per_round)          C.DRIVERS_PER_ROUND          = data.drivers_per_round;
  if (data.max_assignment_rounds)      C.MAX_ASSIGNMENT_ROUNDS      = data.max_assignment_rounds;
  if (data.assignment_timeout_seconds) C.ASSIGNMENT_TIMEOUT_MS      = data.assignment_timeout_seconds * 1000;
}