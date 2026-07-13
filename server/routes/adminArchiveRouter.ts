import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { adminEndWork } from '../logistics/workSessions.js';
import { handleBreakdown } from '../logistics/phases/phase9_breakdownHandling.js';

/**
 * Admin Archive router — recoverable, audit-tracked archiving that replaces the
 * destructive hard-deletes that previously ran from the browser with the anon key.
 *
 * Mounted at /api/admin. Every route is behind requireAdmin (service-role client
 * bypasses RLS, so writes succeed while client DELETE stays denied by RLS).
 *
 * Endpoints:
 *   POST /api/admin/shops/:id/archive            body: { reason?, force? }
 *   POST /api/admin/shops/:id/restore
 *   POST /api/admin/couriers/:id/archive         body: { reason?, force? }
 *   POST /api/admin/couriers/:id/restore
 *   POST /api/admin/applications/:type/:id/archive   type: merchant|delivery
 *   POST /api/admin/applications/:type/:id/restore
 */
const router = Router();

router.use(requireAdmin);

// Order/batch statuses that mean "still in flight" — archiving the parent is risky.
const ACTIVE_ORDER_STATUSES = ['pending', 'delivering'];
const ACTIVE_BATCH_STATUSES = ['pending_assignment', 'assigned', 'in_transit'];

const APP_TABLES: Record<string, string> = {
  merchant: 'merchant_applications',
  delivery: 'delivery_applications',
};

function archivePayload(adminId: string | undefined, reason: unknown) {
  return {
    is_archived: true,
    archived_at: new Date().toISOString(),
    archived_by: adminId ?? null,
    archive_reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
  };
}

const RESTORE_PAYLOAD = {
  is_archived: false,
  archived_at: null,
  archived_by: null,
  archive_reason: null,
};

/* ----------------------------- SHOPS ----------------------------- */
router.post('/shops/:id/archive', async (req: Request, res: Response) => {
  const shopId = req.params.id;
  const { force } = req.body ?? {};

  // Orders are multi-shop; a shop's orders are reached via order_details.shop_id.
  const { data: detailRows, error: detErr } = await supabase
    .from('order_details')
    .select('order_id')
    .eq('shop_id', shopId);

  if (detErr) return res.status(500).json({ ok: false, error: detErr.message });

  const orderIds = [...new Set((detailRows ?? []).map(d => d.order_id))];
  let activeCount = 0;
  if (orderIds.length > 0) {
    const { count, error: countErr } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('id', orderIds)
      .in('status', ACTIVE_ORDER_STATUSES);
    if (countErr) return res.status(500).json({ ok: false, error: countErr.message });
    activeCount = count ?? 0;
  }

  if (activeCount > 0 && !force) {
    return res.status(409).json({
      ok: false,
      code: 'ACTIVE_ORDERS',
      activeCount,
      error: `This store has ${activeCount} active order(s). Resolve them or confirm to archive anyway.`,
    });
  }

  const { error } = await supabase
    .from('shops')
    .update(archivePayload(req.adminUserId, req.body?.reason))
    .eq('shop_id', shopId);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

router.post('/shops/:id/restore', async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('shops')
    .update(RESTORE_PAYLOAD)
    .eq('shop_id', req.params.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

/* ---------------------------- COURIERS ---------------------------- */
router.post('/couriers/:id/archive', async (req: Request, res: Response) => {
  const courierId = req.params.id;
  const { force } = req.body ?? {};

  const { count, error: countErr } = await supabase
    .from('batches')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', courierId)
    .in('status', ACTIVE_BATCH_STATUSES);

  if (countErr) return res.status(500).json({ ok: false, error: countErr.message });

  if ((count ?? 0) > 0 && !force) {
    return res.status(409).json({
      ok: false,
      code: 'ACTIVE_BATCHES',
      activeCount: count,
      error: `This courier has ${count} active batch(es). Reassign them or confirm to archive anyway.`,
    });
  }

  const { error } = await supabase
    .from('couriers')
    .update(archivePayload(req.adminUserId, req.body?.reason))
    .eq('id', courierId);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

router.post('/couriers/:id/restore', async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('couriers')
    .update(RESTORE_PAYLOAD)
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// Admin-forced "End Work" — allowed even while the courier is on_route. If they
// have a real active batch, it's routed through the same breakdown flow used for
// vehicle breakdowns (re-pools/strands its shipments and cancels the batch) so it
// isn't silently orphaned; then the shift is force-closed.
router.post('/couriers/:id/end-work', async (req: Request, res: Response) => {
  const courierId = req.params.id;
  try {
    const { data: activeBatch } = await supabase
      .from('batches')
      .select('id')
      .eq('assigned_to', courierId)
      .in('status', ['assigned', 'in_transit'])
      .maybeSingle();

    if (activeBatch) {
      await handleBreakdown(activeBatch.id as string, { reason: 'admin_force_end_work' });
    }

    const result = await adminEndWork(courierId);
    if (!result.success) return res.status(409).json({ ok: false, error: result.error });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] /couriers/:id/end-work error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to force end work' });
  }
});

/* -------------------------- APPLICATIONS -------------------------- */
router.post('/applications/:type/:id/archive', async (req: Request, res: Response) => {
  const table = APP_TABLES[String(req.params.type)];
  if (!table) return res.status(400).json({ ok: false, error: 'Unknown application type' });

  // Note: archiving keeps the row AND its uploaded ID/license docs (unlike the
  // old hard-delete which also removed the storage files).
  const { error } = await supabase
    .from(table)
    .update(archivePayload(req.adminUserId, req.body?.reason))
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

router.post('/applications/:type/:id/restore', async (req: Request, res: Response) => {
  const table = APP_TABLES[String(req.params.type)];
  if (!table) return res.status(400).json({ ok: false, error: 'Unknown application type' });

  const { error } = await supabase
    .from(table)
    .update(RESTORE_PAYLOAD)
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

export default router;
