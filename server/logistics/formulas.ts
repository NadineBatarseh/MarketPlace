import { C } from './constants';

// ── F1 ──────────────────────────────────────────────────────────────────────
// urgency_score_i = (NOW - created_at_i) / (deadline_i - created_at_i)
// Range: [0, 1]  — 0 = just created, 1 = deadline passed
export function computeUrgencyScore(
  createdAt: Date,
  deadline: Date,
  now: Date = new Date()
): number {
  const window = deadline.getTime() - createdAt.getTime();
  if (window <= 0) return 1;
  const elapsed = now.getTime() - createdAt.getTime();
  return Math.min(Math.max(elapsed / window, 0), 1);
}

// ── F2 ──────────────────────────────────────────────────────────────────────
// U_batch = (1/N) * Σ urgency_score_i
export function computeBatchRawUrgency(urgencyScores: number[]): number {
  if (urgencyScores.length === 0) return 0;
  return urgencyScores.reduce((sum, s) => sum + s, 0) / urgencyScores.length;
}

// ── F3 ──────────────────────────────────────────────────────────────────────
// cost(X→Y) = distance(X,Y) × COST_PER_KM
export function computeRouteCost(distanceKm: number): number {
  return distanceKm * C.COST_PER_KM;
}

// ── Haversine distance (km) ──────────────────────────────────────────────────
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Haversine × road factor → estimated actual road distance
export function roadDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  return haversineDistance(lat1, lng1, lat2, lng2) * C.ROAD_FACTOR;
}

// Travel duration in minutes from road distance
export function estimateDurationMinutes(distanceKm: number): number {
  return (distanceKm / C.AVERAGE_SPEED_KMH) * 60;
}

// ── D13 ─────────────────────────────────────────────────────────────────────
// penalty = BASE_PENALTY × (1 - Û)
export function computeDeadEndPenalty(uHat: number): number {
  return C.BASE_PENALTY * (1 - uHat);
}

// ── D14 ─────────────────────────────────────────────────────────────────────
// Score_adj = Score - BASE_PENALTY × (1 - Û)
export function computeAdjustedScore(score: number, uHat: number): number {
  return score - computeDeadEndPenalty(uHat);
}

// ── D22 ─────────────────────────────────────────────────────────────────────
// reserved_until = NOW + duration(A→B) + BUFFER
export function computeReservedUntil(travelDurationMinutes: number): Date {
  const totalMs =
    (travelDurationMinutes + C.RESERVATION_BUFFER_MINUTES) * 60 * 1000;
  return new Date(Date.now() + totalMs);
}

// ── D2 / D25 ────────────────────────────────────────────────────────────────
// true if deadline is within URGENCY_OVERRIDE_WINDOW hours
export function isDeadlineOverride(deadline: Date, now: Date = new Date()): boolean {
  const hoursRemaining = (deadline.getTime() - now.getTime()) / 3_600_000;
  return hoursRemaining < C.URGENCY_OVERRIDE_WINDOW_HOURS;
}

// ── D33 — Proximity factor ───────────────────────────────────────────────────
// P = e^(-λ × distance_km)
export function computeProximityFactor(distanceKm: number): number {
  return Math.exp(-C.LAMBDA * distanceKm);
}

// ── D10 — Batch score ────────────────────────────────────────────────────────
// Score = W_n·N̂ + W_u·Û - W_d·D̂
export function computeBatchScore(nHat: number, uHat: number, dHat: number): number {
  return C.W_N * nHat + C.W_U * uHat - C.W_D * dHat;
}

// ── D33 — Driver score ───────────────────────────────────────────────────────
// Driver_Score = W_prox·P + W_cap·C - W_load·L
export function computeDriverScore(
  proximityFactor: number,
  capacityUtilization: number,
  fatigueFactor: number
): number {
  return (
    C.W_PROX * proximityFactor +
    C.W_CAP * capacityUtilization -
    C.W_LOAD * fatigueFactor
  );
}