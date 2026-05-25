import { C } from '../constants.js';
import { computeBatchScore } from '../formulas.js';
import { CandidateBatch } from '../types.js';

// â”€â”€ D7 â€” Nج‚ normalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Nج‚_batch = N_batch / max(N_j)
function normalizeCount(batches: CandidateBatch[]): void {
  const maxN = Math.max(...batches.map(b => b.shipment_count), 1);
  batches.forEach(b => (b.n_hat = b.shipment_count / maxN));
}

// â”€â”€ D8 â€” أ› normalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// أ›_batch = U_batch / max(U_j)
function normalizeUrgency(batches: CandidateBatch[]): void {
  const maxU = Math.max(...batches.map(b => b.raw_urgency), 1e-9);
  batches.forEach(b => (b.u_hat = b.raw_urgency / maxU));
}

// â”€â”€ D9 â€” Dج‚ normalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Dج‚_batch = duration(Aâ†’B) / max(duration_j)
function normalizeDistance(batches: CandidateBatch[]): void {
  const maxD = Math.max(...batches.map(b => b.travel_duration_minutes), 1);
  batches.forEach(b => (b.d_hat = b.travel_duration_minutes / maxD));
}

// â”€â”€ D10 â€” Score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Score = W_nآ·Nج‚ + W_uآ·أ› - W_dآ·Dج‚
function applyScores(batches: CandidateBatch[]): void {
  batches.forEach(b => {
    b.score = computeBatchScore(b.n_hat!, b.u_hat!, b.d_hat!);
    b.adjusted_score = b.score;
  });
}

// â”€â”€ D11 â€” Ranking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sort descending by adjusted_score
export function rankBatches(batches: CandidateBatch[]): CandidateBatch[] {
  return [...batches].sort((a, b) => (b.adjusted_score ?? 0) - (a.adjusted_score ?? 0));
}

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function scoreAndRankBatches(batches: CandidateBatch[]): CandidateBatch[] {
  if (batches.length === 0) return [];

  normalizeCount(batches);
  normalizeUrgency(batches);
  normalizeDistance(batches);
  applyScores(batches);

  return rankBatches(batches);
}