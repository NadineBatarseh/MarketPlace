import supabase from '../../supabase.js';
import { computeAdjustedScore } from '../formulas.js';
import { rankBatches } from './phase1_scoring.js';
import { CandidateBatch } from '../types.js';

// â”€â”€ D12 â€” Dead-end detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ D13, D14 â€” Apply dead-end penalty and re-rank â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Score_adj = Score - BASE_PENALTY أ— (1 - أ›)
function applyPenalty(batch: CandidateBatch): CandidateBatch {
  return {
    ...batch,
    adjusted_score: computeAdjustedScore(batch.score!, batch.u_hat!),
  };
}

// â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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