import { Router, Request, Response } from 'express';
import { runBatchCycle, startBatchCycleScheduler } from './batchCycle';
import { startBackgroundJobs } from './phases/phase7_backgroundJobs';
import { handleBreakdown } from './phases/phase9_breakdownHandling';
import { tryAddShipmentsToBatch } from './phases/phase8_inTransitAdditions';
import { sequenceIntraCityTasks } from './phases/phase10_intraCitySequencing';
import { atomicAssign } from './driverAssignment';
import { C } from './constants';

export const logisticsRouter = Router();

// ── POST /api/logistics/cycle ─────────────────────────────────────────────────
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

// ── POST /api/logistics/breakdown ────────────────────────────────────────────
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

// ── POST /api/logistics/add-shipments ────────────────────────────────────────
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

// ── POST /api/logistics/sequence ─────────────────────────────────────────────
// Compute intra-city stop sequence for a courier arriving at a city (Phase 10)
// Body: { tasks, entry_point, initial_volume }
logisticsRouter.post('/sequence', (req: Request, res: Response) => {
  const { tasks, entry_point, initial_volume } = req.body;

  if (!tasks || !entry_point) {
    res.status(400).json({ success: false, error: 'tasks and entry_point are required' });
    return;
  }

  try {
    const sequence = sequenceIntraCityTasks(tasks, entry_point, initial_volume ?? 0);
    res.json({ success: true, sequence });
  } catch (err) {
    console.error('[Logistics] /sequence error:', err);
    res.status(500).json({ success: false, error: 'Sequencing failed' });
  }
});

// ── POST /api/logistics/accept ───────────────────────────────────────────────
// Courier accepts a batch — atomic assignment (D34)
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

// ── Bootstrap function ────────────────────────────────────────────────────────
// Call this once from server/index.ts during startup
export function bootstrapLogistics(): void {
  startBackgroundJobs();
  startBatchCycleScheduler(C.CYCLE_INTERVAL_MINUTES);
  console.log('[Logistics] Module bootstrapped.');
}
