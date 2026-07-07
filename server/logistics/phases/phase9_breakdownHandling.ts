import supabase from '../../supabase.js';
import { Shipment } from '../types.js';
import { cancelDeliverySessionAndCloseWork } from '../workSessions.js';
import { resetToFallback, markUnknown } from '../eta.js';

interface BreakdownResult {
  re_pooled: string[];
  stranded: string[];
}

interface BreakdownReport {
  reason?: string | null;
  location?: { lat: number; lng: number } | null;
}

// Phase 9 â€” Breakdown Handling
// When a courier reports a breakdown, shipments are split by physical custody:
//   batched / reserved â†’ re-pool as 'available' (still at origin, not yet collected)
//   picked_up          â†’ mark as 'stranded' (physically in the vehicle)
//
// Also records WHEN/WHY/WHERE on the batch row (breakdown_reported_at/reason/location)
// so the admin "Breakdowns and Required Interventions" view (server/routes/adminBatchesRouter.ts)
// can surface it — this is the only breakdown workflow; the admin view reads these same fields.
export async function handleBreakdown(batchId: string, report: BreakdownReport = {}): Promise<BreakdownResult> {
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, status')
    .eq('batch_id', batchId);

  if (error || !shipments) {
    console.error('[Phase 9] handleBreakdown fetch error:', error?.message);
    return { re_pooled: [], stranded: [] };
  }

  const notYetCollected = (shipments as Pick<Shipment, 'id' | 'status'>[])
    .filter(s => s.status === 'batched' || s.status === 'reserved')
    .map(s => s.id);

  const alreadyCollected = (shipments as Pick<Shipment, 'id' | 'status'>[])
    .filter(s => s.status === 'picked_up')
    .map(s => s.id);

  // Re-pool shipments that haven't been collected yet
  if (notYetCollected.length > 0) {
    const { error: rePoolError } = await supabase
      .from('shipments')
      .update({
        status: 'available',
        batch_id: null,
        reserved_until: null,
        delayed_reason: null,
        delayed_until: null,
      })
      .in('id', notYetCollected);

    if (rePoolError) {
      console.error('[Phase 9] re-pool error:', rePoolError.message);
    } else {
      resetToFallback(notYetCollected);
    }
  }

  // Mark physically collected shipments as stranded
  if (alreadyCollected.length > 0) {
    const { error: strandedError } = await supabase
      .from('shipments')
      .update({ status: 'stranded' })
      .in('id', alreadyCollected);

    if (strandedError) {
      console.error('[Phase 9] stranded update error:', strandedError.message);
    } else {
      // Goods are on a broken-down vehicle with no dispatcher decision yet —
      // never fabricate an ETA for them.
      markUnknown(alreadyCollected);
    }

    // Alert dispatchers â€” in production this would send a push notification or email
    console.warn(
      `[Phase 9] STRANDED shipments require manual handling: [${alreadyCollected.join(', ')}]`
    );
  }

  // Mark the batch as cancelled and record the breakdown report details
  const { data: cancelledBatch } = await supabase
    .from('batches')
    .update({
      status: 'cancelled',
      breakdown_reported_at: new Date().toISOString(),
      breakdown_reason: report.reason ?? null,
      breakdown_location: report.location ?? null,
      requires_manual_intervention: alreadyCollected.length > 0,
    })
    .eq('id', batchId)
    .select('assigned_to')
    .maybeSingle();

  // A breakdown means the driver should not auto-receive a new batch until the issue is resolved.
  // Closing their shift automatically (rather than leaving it open) keeps duty-time data clean —
  // the driver must explicitly "Start Work" again once the issue is resolved.
  const assignedCourier = cancelledBatch?.assigned_to as string | null;
  if (assignedCourier) {
    await supabase.from('couriers').update({ status: 'offline' }).eq('id', assignedCourier);
    await cancelDeliverySessionAndCloseWork(assignedCourier, batchId);
  }

  console.log(
    `[Phase 9] Breakdown handled for batch ${batchId}. ` +
    `Re-pooled: ${notYetCollected.length}, Stranded: ${alreadyCollected.length}`
  );

  return { re_pooled: notYetCollected, stranded: alreadyCollected };
}
