import supabase from '../../supabase';

// Phase 5 — Claim all shipments AND create the batch record atomically.
//
// The SQL function runs inside a single transaction:
//   1. Inserts the batches row first (satisfies the FK on shipments.batch_id)
//   2. Claims Zone A→B shipments (status → 'batched')
//   3. Claims Zone B→C shipments (status → 'reserved')
//
// Uses SELECT FOR UPDATE SKIP LOCKED so concurrent cycles don't deadlock.
// Returns false if any A→B shipment is already locked by another process.
export async function claimShipmentsAtomically(
  batchId: string,
  abIds: string[],
  bcIds: string[],
  reservedUntil: Date,
  route: string[],
  abTotalVolume: number,
  bcTotalVolume: number
): Promise<boolean> {
  if (abIds.length === 0) return false;

  const { data, error } = await supabase.rpc('claim_batch_shipments', {
    p_batch_id:        batchId,
    p_ab_ids:          abIds,
    p_bc_ids:          bcIds,
    p_reserved_until:  reservedUntil.toISOString(),
    p_route:           route,
    p_ab_total_volume: abTotalVolume,
    p_bc_total_volume: bcTotalVolume,
  });

  if (error) {
    console.error('[Phase 5] claimShipmentsAtomically error:', error.message);
    return false;
  }

  return data === true;
}
