import { C } from './constants.js';

// â”€â”€ F1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// urgency_score_i = (NOW - created_at_i) / (deadline_i - created_at_i)
// Range: [0, 1]  â€” 0 = just created, 1 = deadline passed
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

// â”€â”€ F2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// U_batch = (1/N) * خ£ urgency_score_i
export function computeBatchRawUrgency(urgencyScores: number[]): number {
  if (urgencyScores.length === 0) return 0;
  return urgencyScores.reduce((sum, s) => sum + s, 0) / urgencyScores.length;
}

// â”€â”€ F3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// cost(Xâ†’Y) = distance(X,Y) أ— COST_PER_KM
export function computeRouteCost(distanceKm: number): number {
  return distanceKm * C.COST_PER_KM;
}

// â”€â”€ Haversine distance (km) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// Haversine أ— road factor â†’ estimated actual road distance
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

// â”€â”€ D13 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// penalty = BASE_PENALTY أ— (1 - أ›)
export function computeDeadEndPenalty(uHat: number): number {
  return C.BASE_PENALTY * (1 - uHat);
}

// â”€â”€ D14 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Score_adj = Score - BASE_PENALTY أ— (1 - أ›)
export function computeAdjustedScore(score: number, uHat: number): number {
  return score - computeDeadEndPenalty(uHat);
}

// â”€â”€ D22 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// reserved_until = NOW + duration(Aâ†’B)
export function computeReservedUntil(travelDurationMinutes: number): Date {
  return new Date(Date.now() + travelDurationMinutes * 60 * 1000);
}

// â”€â”€ D33 â€” Proximity factor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// P = e^(-خ» أ— distance_km)
export function computeProximityFactor(distanceKm: number): number {
  return Math.exp(-C.LAMBDA * distanceKm);
}

// â”€â”€ D10 â€” Batch score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Score = W_nآ·Nج‚ + W_uآ·أ› - W_dآ·Dج‚
export function computeBatchScore(nHat: number, uHat: number, dHat: number): number {
  return C.W_N * nHat + C.W_U * uHat - C.W_D * dHat;
}

// â”€â”€ D33 â€” Driver score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver_Score = W_proxآ·P + W_capآ·C - W_loadآ·L
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