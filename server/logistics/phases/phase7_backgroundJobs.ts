import supabase from '../../supabase.js';
import { C } from '../constants.js';
import { resetToFallback } from '../eta.js';

// ── Job 1 — Release expired reservations (D23) ──────────────────────────────
// reserved_until < NOW normally → status back to 'available'.
// Exception: if the owning batch is still 'pending_assignment' (no driver
// found yet), the A→B clock that reserved_until was tracking never actually
// started, so releasing the shipment would be premature — extend the
// reservation instead and let it expire again later if still unassigned.
async function releaseExpiredReservations(): Promise<void> {
  const { data: expired, error: fetchError } = await supabase
    .from('shipments')
    .select('id, batch_id')
    .eq('status', 'reserved')
    .lt('reserved_until', new Date().toISOString());

  if (fetchError) {
    console.error('[Phase 7 Job 1] fetch expired reservations error:', fetchError.message);
    return;
  }
  if (!expired?.length) return;

  const batchIds = [...new Set(expired.map(s => s.batch_id).filter(Boolean))] as string[];

  const { data: batches, error: batchError } = batchIds.length
    ? await supabase.from('batches').select('id, status').in('id', batchIds)
    : { data: [], error: null };

  if (batchError) {
    console.error('[Phase 7 Job 1] fetch batch statuses error:', batchError.message);
    return;
  }

  const pendingAssignmentBatchIds = new Set(
    (batches ?? []).filter(b => b.status === 'pending_assignment').map(b => b.id)
  );

  const toExtend = expired.filter(s => s.batch_id && pendingAssignmentBatchIds.has(s.batch_id));
  const toRelease = expired.filter(s => !s.batch_id || !pendingAssignmentBatchIds.has(s.batch_id));

  if (toExtend.length) {
    const newReservedUntil = new Date(
      Date.now() + C.RESERVATION_EXTENSION_MINUTES * 60 * 1000
    ).toISOString();
    const extendedBatchIds = [...new Set(toExtend.map(s => s.batch_id))] as string[];

    const [{ error: sErr }, { error: bErr }] = await Promise.all([
      supabase
        .from('shipments')
        .update({ reserved_until: newReservedUntil })
        .in('id', toExtend.map(s => s.id)),
      supabase
        .from('batches')
        .update({ reserved_until: newReservedUntil })
        .in('id', extendedBatchIds),
    ]);

    if (sErr || bErr) {
      console.error('[Phase 7 Job 1] extend reservation error:', sErr?.message ?? bErr?.message);
    } else {
      console.log(`[Phase 7 Job 1] Extended reservation for ${toExtend.length} shipment(s) — batch still pending_assignment.`);
    }
  }

  if (toRelease.length) {
    const { error } = await supabase
      .from('shipments')
      .update({ status: 'available', batch_id: null, reserved_until: null })
      .in('id', toRelease.map(s => s.id));

    if (error) {
      console.error('[Phase 7 Job 1] releaseExpiredReservations error:', error.message);
    } else {
      // These shipments just left their batch — revert to the flat SLA deadline
      // so they never keep a stale, precise-looking route estimate in the pool.
      resetToFallback(toRelease.map(s => s.id));
    }
  }
}

// ── Start background jobs ────────────────────────────────────────────────
export function startBackgroundJobs(): void {
  setInterval(releaseExpiredReservations, 60 * 60_000);  // every hour

  console.log('[Phase 7] Background jobs started.');
}
