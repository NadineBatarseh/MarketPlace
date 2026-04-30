import supabase from '../../supabase';

// Phase 5 — Claim all shipments atomically in one database transaction.
//
// Uses a PostgreSQL stored function (claim_batch_shipments) that runs inside
// a single transaction with SELECT FOR UPDATE SKIP LOCKED.
// If any A→B shipment is already locked by another process → returns false.
// No partial states: either all are claimed or nothing changes.
//
// ── Required SQL function (create once in Supabase SQL editor) ────────────────
//
// CREATE OR REPLACE FUNCTION claim_batch_shipments(
//   p_batch_id      UUID,
//   p_ab_ids        UUID[],
//   p_bc_ids        UUID[],
//   p_reserved_until TIMESTAMPTZ
// ) RETURNS BOOLEAN AS $$
// DECLARE
//   locked_ab_count INT;
// BEGIN
//   -- Attempt to lock all Zone A→B rows (SKIP LOCKED = don't wait, just skip)
//   CREATE TEMP TABLE _locked_ab ON COMMIT DROP AS
//   SELECT id FROM shipments
//   WHERE id = ANY(p_ab_ids)
//     AND status IN ('available', 'delayed')
//   FOR UPDATE SKIP LOCKED;
//
//   SELECT COUNT(*) INTO locked_ab_count FROM _locked_ab;
//
//   -- If we couldn't lock every requested A→B shipment → abort
//   IF locked_ab_count < array_length(p_ab_ids, 1) THEN
//     RETURN FALSE;
//   END IF;
//
//   -- Claim Zone A→B
//   UPDATE shipments
//   SET status         = 'batched',
//       batch_id       = p_batch_id,
//       delayed_reason = NULL,
//       delayed_until  = NULL
//   WHERE id IN (SELECT id FROM _locked_ab);
//
//   -- Claim Zone B→C (if any)
//   IF array_length(p_bc_ids, 1) > 0 THEN
//     UPDATE shipments
//     SET status         = 'reserved',
//         batch_id       = p_batch_id,
//         reserved_until = p_reserved_until,
//         delayed_reason = NULL,
//         delayed_until  = NULL
//     WHERE id = ANY(p_bc_ids)
//       AND status IN ('available', 'delayed');
//   END IF;
//
//   RETURN TRUE;
// END;
// $$ LANGUAGE plpgsql;

export async function claimShipmentsAtomically(
  batchId: string,
  abIds: string[],
  bcIds: string[],
  reservedUntil: Date
): Promise<boolean> {
  if (abIds.length === 0) return false;

  const { data, error } = await supabase.rpc('claim_batch_shipments', {
    p_batch_id: batchId,
    p_ab_ids: abIds,
    p_bc_ids: bcIds,
    p_reserved_until: reservedUntil.toISOString(),
  });

  if (error) {
    console.error('[Phase 5] claimShipmentsAtomically error:', error.message);
    return false;
  }

  return data === true;
}