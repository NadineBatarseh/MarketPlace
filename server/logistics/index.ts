import { Router, Request, Response } from 'express';
import { runBatchCycle, startBatchCycleScheduler } from './batchCycle.js';
import { startBackgroundJobs } from './phases/phase7_backgroundJobs.js';
import { handleBreakdown } from './phases/phase9_breakdownHandling.js';
import { tryAddShipmentsToBatch } from './phases/phase8_inTransitAdditions.js';
import { sequenceIntraCityTasks } from './phases/phase10_intraCitySequencing.js';
import { prefetchPairs } from './distanceProvider.js';
import { atomicAssign } from './driverAssignment.js';
import { autoAssignUnbatchedShipments } from './phases/phase0a_autoAssignUnbatched.js';
import { supabase } from '../supabase.js';
import { C } from './constants.js';
import { loadPaymentConfig } from '../lib/paymentConfig.js';

export const logisticsRouter = Router();

// â”€â”€ POST /api/logistics/cycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Manually trigger one full batch cycle
logisticsRouter.post('/cycle', async (_req: Request, res: Response) => {
  try {
    await runBatchCycle();
    res.json({ success: true, message: 'Batch cycle completed' });
  } catch (err) {
    console.error('[Logistics] /cycle error:', err);
    res.status(500).json({ success: false, error: 'Batch cycle failed' });
  }
});

// â”€â”€ POST /api/logistics/breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Courier reports a vehicle breakdown
// Body: { batch_id: string }
logisticsRouter.post('/breakdown', async (req: Request, res: Response) => {
  const { batch_id } = req.body as { batch_id: string };

  if (!batch_id) {
    res.status(400).json({ success: false, error: 'batch_id is required' });
    return;
  }

  try {
    const result = await handleBreakdown(batch_id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Logistics] /breakdown error:', err);
    res.status(500).json({ success: false, error: 'Breakdown handling failed' });
  }
});

// â”€â”€ POST /api/logistics/add-shipments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Add new shipments to an in-transit batch (Phase 8)
// Body: { batch_id, zone_b, new_shipment_ids, existing_reserved_until }
logisticsRouter.post('/add-shipments', async (req: Request, res: Response) => {
  const { batch_id, zone_b, new_shipment_ids, existing_reserved_until } = req.body as {
    batch_id: string;
    zone_b: string;
    new_shipment_ids: string[];
    existing_reserved_until: string;
  };

  if (!batch_id || !zone_b || !new_shipment_ids?.length) {
    res.status(400).json({ success: false, error: 'Missing required fields' });
    return;
  }

  try {
    const added = await tryAddShipmentsToBatch({
      batch_id,
      zone_b,
      new_shipment_ids,
      existing_reserved_until,
    });
    res.json({ success: added });
  } catch (err) {
    console.error('[Logistics] /add-shipments error:', err);
    res.status(500).json({ success: false, error: 'Failed to add shipments' });
  }
});

// â”€â”€ POST /api/logistics/sequence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Compute intra-city stop sequence for a courier arriving at a city (Phase 10)
// Body: { tasks, entry_point, initial_volume }
logisticsRouter.post('/sequence', async (req: Request, res: Response) => {
  const { tasks, entry_point, initial_volume } = req.body;

  if (!tasks || !entry_point) {
    res.status(400).json({ success: false, error: 'tasks and entry_point are required' });
    return;
  }

  try {
    // Warm the road-distance cache for every stop the sequencer will evaluate, so the
    // (synchronous) greedy + 2-opt run on real road distances. A prefetch failure is
    // non-fatal: getRoadDistanceKm falls back to Haversine.
    const locations = [entry_point, ...tasks.map((t: { location: unknown }) => t.location)];
    await prefetchPairs(locations as any);

    const sequence = sequenceIntraCityTasks(tasks, entry_point, initial_volume ?? 0);
    res.json({ success: true, sequence });
  } catch (err) {
    console.error('[Logistics] /sequence error:', err);
    res.status(500).json({ success: false, error: 'Sequencing failed' });
  }
});

// â”€â”€ POST /api/logistics/start-batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver starts an assigned batch, transitioning it to in_transit.
// Body: { batch_id, courier_id }
logisticsRouter.post('/start-batch', async (req: Request, res: Response) => {
  const { batch_id, courier_id } = req.body as { batch_id: string; courier_id: string };

  if (!batch_id || !courier_id) {
    res.status(400).json({ success: false, error: 'batch_id and courier_id are required' });
    return;
  }

  const { data, error } = await supabase
    .from('batches')
    .update({ status: 'in_transit', started_at: new Date().toISOString() })
    .eq('id', batch_id)
    .eq('status', 'assigned')
    .eq('assigned_to', courier_id)
    .select('id');

  if (error || !data?.length) {
    res.status(409).json({ success: false, error: 'Batch not found, not assigned, or already started' });
    return;
  }

  res.json({ success: true });
});

// â”€â”€ POST /api/logistics/pickup-shipment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver confirms pickup of a shipment from the shop.
// Validates: batch is in_transit and belongs to this courier; shipment is batched/reserved.
// Body: { shipment_id, courier_id }
logisticsRouter.post('/pickup-shipment', async (req: Request, res: Response) => {
  const { shipment_id, courier_id } = req.body as { shipment_id: string; courier_id: string };

  if (!shipment_id || !courier_id) {
    res.status(400).json({ success: false, error: 'shipment_id and courier_id are required' });
    return;
  }

  // Fetch the shipment to get its batch
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, batch_id, status')
    .eq('id', shipment_id)
    .maybeSingle();

  if (!shipment?.batch_id) {
    res.status(404).json({ success: false, error: 'Shipment not found or not in a batch' });
    return;
  }

  if (shipment.status !== 'batched' && shipment.status !== 'reserved') {
    res.status(400).json({ success: false, error: 'Shipment is not ready for pickup' });
    return;
  }

  // Verify the batch is in_transit and belongs to this courier
  const { data: batch } = await supabase
    .from('batches')
    .select('id')
    .eq('id', shipment.batch_id)
    .eq('assigned_to', courier_id)
    .eq('status', 'in_transit')
    .maybeSingle();

  if (!batch) {
    res.status(403).json({ success: false, error: 'Batch is not in transit or not yours' });
    return;
  }

  const { data: updated } = await supabase
    .from('shipments')
    .update({ status: 'picked_up', picked_up_at: new Date().toISOString() })
    .eq('id', shipment_id)
    .in('status', ['batched', 'reserved'])
    .select('id');

  if (!updated?.length) {
    res.status(409).json({ success: false, error: 'Pickup failed â€” shipment status changed' });
    return;
  }

  res.json({ success: true });
});

// â”€â”€ POST /api/logistics/deliver-shipment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver confirms delivery of a shipment to the customer.
// Validates: batch is in_transit and belongs to this courier; shipment is picked_up.
// Auto-completes the batch when all its shipments are delivered.
// Body: { shipment_id, courier_id }
logisticsRouter.post('/deliver-shipment', async (req: Request, res: Response) => {
  const { shipment_id, courier_id } = req.body as { shipment_id: string; courier_id: string };

  if (!shipment_id || !courier_id) {
    res.status(400).json({ success: false, error: 'shipment_id and courier_id are required' });
    return;
  }

  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, batch_id, status, order_detail_id')
    .eq('id', shipment_id)
    .maybeSingle();

  if (!shipment?.batch_id) {
    res.status(404).json({ success: false, error: 'Shipment not found or not in a batch' });
    return;
  }

  if (shipment.status !== 'picked_up') {
    res.status(400).json({ success: false, error: 'Shipment must be picked up before delivery' });
    return;
  }

  const { data: batch } = await supabase
    .from('batches')
    .select('id, ab_shipment_ids, bc_shipment_ids')
    .eq('id', shipment.batch_id)
    .eq('assigned_to', courier_id)
    .eq('status', 'in_transit')
    .maybeSingle();

  if (!batch) {
    res.status(403).json({ success: false, error: 'Batch is not in transit or not yours' });
    return;
  }

  const { data: updated } = await supabase
    .from('shipments')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', shipment_id)
    .eq('status', 'picked_up')
    .select('id');

  if (!updated?.length) {
    res.status(409).json({ success: false, error: 'Delivery failed â€” shipment status changed' });
    return;
  }

  // Vendor payouts happen at pay-in via PayTabs Split Payout (see paytabsRouter); there's
  // no post-delivery settlement step here anymore.

  // Auto-complete batch if every shipment is now delivered
  const allIds = [
    ...((batch.ab_shipment_ids as string[]) ?? []),
    ...((batch.bc_shipment_ids as string[]) ?? []),
  ];
  const { count } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .in('id', allIds)
    .neq('status', 'delivered');

  if (count === 0) {
    await supabase.from('batches').update({ status: 'completed' }).eq('id', batch.id);
  }

  res.json({ success: true, batch_completed: count === 0 });
});

// â”€â”€ POST /api/logistics/accept â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Courier accepts a batch â€” atomic assignment (D34)
// Body: { batch_id, courier_id }
logisticsRouter.post('/accept', async (req: Request, res: Response) => {
  const { batch_id, courier_id } = req.body as {
    batch_id: string;
    courier_id: string;
  };

  if (!batch_id || !courier_id) {
    res.status(400).json({ success: false, error: 'batch_id and courier_id are required' });
    return;
  }

  try {
    const assigned = await atomicAssign(batch_id, courier_id);
    if (assigned) {
      res.json({ success: true, message: 'Batch assigned to you' });
    } else {
      res.status(409).json({ success: false, message: 'Batch already taken' });
    }
  } catch (err) {
    console.error('[Logistics] /accept error:', err);
    res.status(500).json({ success: false, error: 'Assignment failed' });
  }
});

// â”€â”€ Real-time auto-assignment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Listens for new shipment inserts and immediately tries to slot them into an
// existing assigned/in_transit batch. A lock prevents overlapping runs when
// multiple shipments arrive at once.
function startShipmentWatcher(): void {
  let running = false;

  supabase
    .channel('shipments-insert')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shipments' },
      async (payload) => {
        const row = payload.new as { batch_id: string | null; status: string };

        // Only act on unbatched, dispatchable shipments
        if (row.batch_id !== null) return;
        if (row.status !== 'available' && row.status !== 'delayed') return;

        if (running) return; // a run is already in progress â€” it will pick this up
        running = true;

        try {
          await autoAssignUnbatchedShipments();
        } catch (err) {
          console.error('[Shipment Watcher] autoAssign error:', err);
        } finally {
          running = false;
        }
      },
    )
    .subscribe((status) => {
      console.log('[Shipment Watcher] Realtime status:', status);
    });
}

// â”€â”€ Bootstrap function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Call this once from server/index.ts during startup
export async function bootstrapLogistics(): Promise<void> {
  // Load admin-editable payment/settlement config before starting timers that read it.
  await loadPaymentConfig();
  startBackgroundJobs();
  startBatchCycleScheduler(C.CYCLE_INTERVAL_MINUTES);
  startShipmentWatcher();
  console.log('[Logistics] Module bootstrapped.');
}
