import supabase from '../../supabase';
import { computeAdjustedScore } from '../formulas';
import { rankBatches } from './phase1_scoring';
import { CandidateBatch } from '../types';

// ── D12 — Dead-end detection ──────────────────────────────────────────────────
// COUNT shipments where pickup_zone = Zone B AND status IN ('available','delayed')
export async function isDeadEnd(zoneB: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .in('status', ['available', 'delayed'])
    .eq('pickup_zone', zoneB);

  if (error) {
    console.error('[Phase 2] isDeadEnd error:', error.message);
    return false;
  }

  return (count ?? 0) === 0;
}

// ── D13, D14 — Apply dead-end penalty and re-rank ────────────────────────────
// Score_adj = Score - BASE_PENALTY × (1 - Û)
function applyPenalty(batch: CandidateBatch): CandidateBatch {
  return {
    ...batch,
    adjusted_score: computeAdjustedScore(batch.score!, batch.u_hat!),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────
// Checks the top batch's Zone B. If dead-end, applies the dynamic penalty
// and re-ranks all batches. Returns the updated ranked list.
export async function applyLookAhead(
  rankedBatches: CandidateBatch[]
): Promise<CandidateBatch[]> {
  if (rankedBatches.length === 0) return [];

  const top = rankedBatches[0];
  const deadEnd = await isDeadEnd(top.destination);

  if (!deadEnd) return rankedBatches;

  const penalized = applyPenalty(top);
  const rest = rankedBatches.slice(1);

  // Re-rank with the penalized top batch re-inserted
  return rankBatches([penalized, ...rest]);
}