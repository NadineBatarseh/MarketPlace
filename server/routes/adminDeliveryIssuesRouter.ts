import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import type { TrackingEventType } from '../../shared/trackingEvents.js';

/**
 * Admin "Delivery Issues" queue — lists unresolved customer delay reports and
 * lets an admin mark them resolved.
 *
 * Mounted at /api/admin/delivery-issues, behind requireAdmin. Resolving an
 * issue writes resolved_at/resolved_by on the original order_tracking_events
 * row (service-role only — never client-writable) and appends a separate
 * 'admin_resolved' event, mirroring the audit-trail design used everywhere
 * else in this feature.
 */
const router = Router();
router.use(requireAdmin);

interface DelayEventRow {
  id: number;
  order_id: number;
  shipment_id: string | null;
  note: string | null;
  created_at: string;
}

/* ───────────────────────────── GET / ───────────────────────────── */
router.get('/', async (_req: Request, res: Response) => {
  const { data: events, error } = await supabase
    .from('order_tracking_events')
    .select('id, order_id, shipment_id, note, created_at')
    .eq('event_type', 'delay_reported')
    .eq('requires_review', true)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!events?.length) return res.json({ ok: true, issues: [] });

  const rows = events as DelayEventRow[];
  const orderIds = [...new Set(rows.map(e => e.order_id))];
  const shipmentIds = [...new Set(rows.map(e => e.shipment_id).filter(Boolean))] as string[];

  const [{ data: orders }, { data: shipments }] = await Promise.all([
    supabase.from('orders').select('id, user_id').in('id', orderIds),
    shipmentIds.length
      ? supabase.from('shipments').select('id, status').in('id', shipmentIds)
      : Promise.resolve({ data: [] as { id: string; status: string }[] }),
  ]);

  const userIds = [...new Set((orders ?? []).map(o => o.user_id).filter(Boolean))] as string[];
  const { data: users } = userIds.length
    ? await supabase.from('Users').select('user_id, name').in('user_id', userIds)
    : { data: [] as { user_id: string; name: string | null }[] };

  const orderUserMap     = new Map((orders ?? []).map(o => [o.id, o.user_id as string | null]));
  const userNameMap      = new Map((users ?? []).map(u => [u.user_id, u.name]));
  const shipmentStatusMap = new Map((shipments ?? []).map(s => [s.id, s.status]));

  const issues = rows.map(e => ({
    id:              e.id,
    order_id:        e.order_id,
    shipment_id:     e.shipment_id,
    note:            e.note,
    reported_at:     e.created_at,
    customer_name:   userNameMap.get(orderUserMap.get(e.order_id) ?? '') ?? null,
    shipment_status: e.shipment_id ? (shipmentStatusMap.get(e.shipment_id) ?? null) : null,
  }));

  return res.json({ ok: true, issues });
});

/* ───────────────────────── POST /:id/resolve ───────────────────────── */
router.post('/:id/resolve', async (req: Request, res: Response) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId)) return res.status(400).json({ ok: false, error: 'Invalid id' });

  const { data: original } = await supabase
    .from('order_tracking_events')
    .select('id, order_id, shipment_id, event_type')
    .eq('id', eventId)
    .maybeSingle();

  if (!original) return res.status(404).json({ ok: false, error: 'Issue not found' });
  if (original.event_type !== 'delay_reported') {
    return res.status(400).json({ ok: false, error: 'This event is not a delay report' });
  }

  const resolvedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('order_tracking_events')
    .update({ requires_review: false, resolved_at: resolvedAt, resolved_by: req.adminUserId })
    .eq('id', eventId);

  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  const eventType: TrackingEventType = 'admin_resolved';
  await supabase.from('order_tracking_events').insert({
    order_id:    original.order_id,
    shipment_id: original.shipment_id,
    step:        eventType,
    event_type:  eventType,
    triggered_by: 'admin',
    note:        'تم حل المشكلة من قبل الإدارة',
  });

  return res.json({ ok: true });
});

export default router;
