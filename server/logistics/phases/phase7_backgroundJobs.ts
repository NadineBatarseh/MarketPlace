import supabase from '../../supabase.js';

// â”€â”€ Job 1 â€” Release expired reservations (D23) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// reserved_until < NOW â†’ status back to 'available'
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

// â”€â”€ Start background jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function startBackgroundJobs(): void {
  setInterval(releaseExpiredReservations, 5 * 60_000);  // every 5 min

  console.log('[Phase 7] Background jobs started.');
}
