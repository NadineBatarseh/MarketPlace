import { supabase } from '../supabase';

export const C = {
  // ── Capacity (overridable from batch_config) ─────────────────
  MAX_VOLUME: 100,
  MAX_STOPS: 20,

  // ── Batch threshold (D5) ─────────────────────────────────────
  MIN_BATCH_THRESHOLD: 5,

  // ── Time windows (MAX_FLOW_WAITING_MINUTES overridable) ──────
  URGENCY_OVERRIDE_WINDOW_HOURS: 2,
  CYCLE_INTERVAL_MINUTES: 30,
  MAX_FLOW_WAITING_MINUTES: 120,
  RESERVATION_BUFFER_MINUTES: 30,
  INTRA_CITY_MIN_TIME_BUFFER_MINUTES: 15,

  // ── Max distance between stops (overridable from batch_config)
  MAX_DISTANCE_KM: 50,

  // ── Max days a shipment waits before its deadline (overridable from batch_config)
  MAX_WAIT_DAYS: 3,

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
  ASSIGNMENT_TIMEOUT_MS: 90_000,
  MAX_ASSIGNMENT_ROUNDS: 3,

  // ── Intra-city sequencing (D31) ─────────────────────────────
  W_DIST: 0.60,
  W_URG: 0.40,
};

// Loads the four admin-configurable fields from batch_config (id = 1)
// and merges them into C. Called once at the start of each batch cycle.
export async function loadConfigFromDB(): Promise<void> {
  const { data, error } = await supabase
    .from('batch_config')
    .select('max_driver_capacity, max_stops_per_batch, max_allowed_wait, max_distance_km, max_wait_days')
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.warn('[Config] Could not load batch_config, using defaults:', error?.message);
    return;
  }

  C.MAX_VOLUME               = data.max_driver_capacity;
  C.MAX_STOPS                = data.max_stops_per_batch;
  C.MAX_FLOW_WAITING_MINUTES = data.max_allowed_wait;
  C.MAX_DISTANCE_KM          = data.max_distance_km;
  C.MAX_WAIT_DAYS            = data.max_wait_days;

  console.log('[Config] Loaded from DB:', {
    MAX_VOLUME: C.MAX_VOLUME,
    MAX_STOPS: C.MAX_STOPS,
    MAX_FLOW_WAITING_MINUTES: C.MAX_FLOW_WAITING_MINUTES,
    MAX_DISTANCE_KM: C.MAX_DISTANCE_KM,
  });
}