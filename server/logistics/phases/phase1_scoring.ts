import { C } from '../constants';
import { computeBatchScore } from '../formulas';
import { CandidateBatch } from '../types';

// ── D7 — N̂ normalization ─────────────────────────────────────────────────────
// N̂_batch = N_batch / max(N_j)
function normalizeCount(batches: CandidateBatch[]): void {
  const maxN = Math.max(...batches.map(b => b.shipment_count), 1);
  batches.forEach(b => (b.n_hat = b.shipment_count / maxN));
}

// ── D8 — Û normalization ──────────────────────────────────────────────────────
// Û_batch = U_batch / max(U_j)
function normalizeUrgency(batches: CandidateBatch[]): void {
  const maxU = Math.max(...batches.map(b => b.raw_urgency), 1e-9);
  batches.forEach(b => (b.u_hat = b.raw_urgency / maxU));
}

// ── D9 — D̂ normalization ──────────────────────────────────────────────────────
// D̂_batch = duration(A→B) / max(duration_j)
function normalizeDistance(batches: CandidateBatch[]): void {
  const maxD = Math.max(...batches.map(b => b.travel_duration_minutes), 1);
  batches.forEach(b => (b.d_hat = b.travel_duration_minutes / maxD));
}

// ── D10 — Score ───────────────────────────────────────────────────────────────
// Score = W_n·N̂ + W_u·Û - W_d·D̂
function applyScores(batches: CandidateBatch[]): void {
  batches.forEach(b => {
    b.score = computeBatchScore(b.n_hat!, b.u_hat!, b.d_hat!);
    b.adjusted_score = b.score;
  });
}

// ── D11 — Ranking ─────────────────────────────────────────────────────────────
// Sort descending by adjusted_score
export function rankBatches(batches: CandidateBatch[]): CandidateBatch[] {
  return [...batches].sort((a, b) => (b.adjusted_score ?? 0) - (a.adjusted_score ?? 0));
}

// ── Main export ───────────────────────────────────────────────────────────────
export function scoreAndRankBatches(batches: CandidateBatch[]): CandidateBatch[] {
  if (batches.length === 0) return [];

  normalizeCount(batches);
  normalizeUrgency(batches);
  normalizeDistance(batches);
  applyScores(batches);

  return rankBatches(batches);
}