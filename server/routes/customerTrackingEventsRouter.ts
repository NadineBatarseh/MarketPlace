import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import type { TrackingEventType } from '../../shared/trackingEvents.js';

/**
 * Customer delivery-feedback actions — "confirm received" and "report delay".
 *
 * Mounted at /api/tracking-events, behind requireCustomer. The conditions
 * gating each action (ownership, shipment.status, deadline check) are
 * enforced HERE, not just in the UI — a customer could otherwise call these
 * endpoints directly and write an untrustworthy entry into the dispute audit
 * trail. shipments.status / orders.status are never written by this router;
 * only order_tracking_events rows are inserted.
 */
const router = Router();
router.use(requireCustomer);

interface OwnedShipment {
  id: string;
  status: string;
  deadline: string | null;
  order_detail_id: number;
}

async function loadOwnedShipment(
  shipmentId: string,
  userId: string,
): Promise<{ shipment: OwnedShipment; orderId: number } | { error: string }> {
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, status, deadline, order_detail_id')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!shipment) return { error: 'الشحنة غير موجودة' };

  const { data: detail } = await supabase
    .from('order_details')
    .select('order_id')
    .eq('id', shipment.order_detail_id)
    .maybeSingle();
  if (!detail?.order_id) return { error: 'الشحنة غير مرتبطة بطلب' };

  const { data: order } = await supabase
    .from('orders')
    .select('id, user_id')
    .eq('id', detail.order_id)
    .maybeSingle();
  if (!order || order.user_id !== userId) return { error: 'غير مصرح لك بالوصول لهذا الطلب' };

  return { shipment: shipment as OwnedShipment, orderId: order.id };
}

/* ───────────────────────── POST /confirm-received ───────────────────────── */
// Customer confirms they received the product. Only allowed once the driver
// has already marked the shipment delivered. Does NOT touch shipments.status
// — the driver/backend remains the sole authority over the logistics status.
router.post('/confirm-received', async (req: Request, res: Response) => {
  const { shipment_id } = req.body as { shipment_id?: string };
  if (!shipment_id) return res.status(400).json({ ok: false, error: 'shipment_id is required' });

  const result = await loadOwnedShipment(shipment_id, req.authUserId!);
  if ('error' in result) return res.status(403).json({ ok: false, error: result.error });

  if (result.shipment.status !== 'delivered') {
    return res.status(400).json({ ok: false, error: 'لا يمكن تأكيد الاستلام قبل أن يتم تسليم المنتج' });
  }

  const eventType: TrackingEventType = 'customer_confirmed';
  const { error } = await supabase.from('order_tracking_events').insert({
    order_id:          result.orderId,
    shipment_id,
    step:               eventType,
    event_type:         eventType,
    requires_review:    false,
    triggered_by:       'العميل',
    note:               'أكّد العميل استلام المنتج',
    // The customer just performed this action themselves — pre-mark it seen
    // so it never produces a "new update" badge for something they already know.
    customer_seen_at:   new Date().toISOString(),
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.json({ ok: true });
});

/* ────────────────────────── POST /report-delay ──────────────────────────── */
// Customer reports the shipment is late. Only allowed once the predicted
// delivery date (shipments.deadline) has passed and the shipment is not yet
// delivered. Flags requires_review = true for the admin "Delivery Issues"
// queue. Does NOT touch shipments.status or orders.status.
router.post('/report-delay', async (req: Request, res: Response) => {
  const { shipment_id, note } = req.body as { shipment_id?: string; note?: string };
  if (!shipment_id) return res.status(400).json({ ok: false, error: 'shipment_id is required' });
  if (!note?.trim()) return res.status(400).json({ ok: false, error: 'الرجاء كتابة وصف للمشكلة' });

  const result = await loadOwnedShipment(shipment_id, req.authUserId!);
  if ('error' in result) return res.status(403).json({ ok: false, error: result.error });

  if (result.shipment.status === 'delivered') {
    return res.status(400).json({ ok: false, error: 'لا يمكن الإبلاغ عن تأخير لمنتج تم تسليمه بالفعل' });
  }
  const deadline = result.shipment.deadline ? new Date(result.shipment.deadline) : null;
  if (!deadline || new Date() <= deadline) {
    return res.status(400).json({ ok: false, error: 'لم يتم تجاوز الموعد المتوقع للتسليم بعد' });
  }

  const eventType: TrackingEventType = 'delay_reported';
  const { error } = await supabase.from('order_tracking_events').insert({
    order_id:        result.orderId,
    shipment_id,
    step:             eventType,
    event_type:       eventType,
    note:             note.trim(),
    requires_review:  true,
    triggered_by:     'العميل',
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.json({ ok: true });
});

export default router;
