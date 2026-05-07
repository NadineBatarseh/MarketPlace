import supabase from '../../supabase';

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

// ── Start background jobs ─────────────────────────────────────────────────────
export function startBackgroundJobs(): void {
  setInterval(releaseExpiredReservations, 5 * 60_000);  // every 5 min

  console.log('[Phase 7] Background jobs started.');
}
