import supabase from '../../supabase';
import { C } from '../constants';

// ── Job 1 — Release expired reservations (D23) ───────────────────────────────
// reserved_until < NOW → status back to 'available'
async function releaseExpiredReservations(): Promise<void> {
  const { error } = await supabase
    .from('shipments')
    .update({ status: 'available', batch_id: null, reserved_until: null })
    .eq('status', 'reserved')
    .lt('reserved_until', new Date().toISOString());

  if (error) {
    console.error('[Phase 7 Job 1] releaseExpiredReservations error:', error.message);
  }
}

// ── Job 2 — Return delayed shipments to available (D24) ──────────────────────
// delayed_until ≤ NOW → status back to 'available'
// Their urgency_score is now higher (more time has passed since created_at).
async function returnDelayedShipments(): Promise<void> {
  const { error } = await supabase
    .from('shipments')
    .update({ status: 'available', delayed_until: null })
    .eq('status', 'delayed')
    .lte('delayed_until', new Date().toISOString());

  if (error) {
    console.error('[Phase 7 Job 2] returnDelayedShipments error:', error.message);
  }
}

// ── Job 3 — Escalate near-deadline delayed shipments (D25) ───────────────────
// (deadline - NOW) < URGENCY_OVERRIDE_WINDOW → force back to 'available'
// These will bypass MIN_BATCH_THRESHOLD in the next cycle (D2 in Phase 0b).
async function escalateNearDeadlineDelayed(): Promise<void> {
  const cutoff = new Date(
    Date.now() + C.URGENCY_OVERRIDE_WINDOW_HOURS * 3_600_000
  ).toISOString();

  const { error } = await supabase
    .from('shipments')
    .update({ status: 'available', delayed_reason: null, delayed_until: null })
    .eq('status', 'delayed')
    .lt('deadline', cutoff);

  if (error) {
    console.error('[Phase 7 Job 3] escalateNearDeadlineDelayed error:', error.message);
  }
}

// ── Start all three jobs on independent intervals ─────────────────────────────
export function startBackgroundJobs(): void {
  setInterval(releaseExpiredReservations, 5 * 60_000);   // every 5 min
  setInterval(returnDelayedShipments,       5 * 60_000);   // every 5 min
  setInterval(escalateNearDeadlineDelayed,  15 * 60_000);  // every 15 min

  console.log('[Phase 7] Background jobs started.');
}
