import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import type { BatchAdminActionType, BatchAdminReasonCode } from '../../shared/batchAdminActions.js';
import { BATCH_ADMIN_REASON_CODES } from '../../shared/batchAdminActions.js';

/**
 * Admin "Batch Management" — view/modify the division of shipments into
 * batches that the logistics engine already created. Mounted at
 * /api/admin/batches, behind requireAdmin.
 *
 * This router NEVER touches the batch-generation or route-sequencing
 * algorithm (server/logistics/phases/*, distanceProvider.ts). It only edits
 * batch/shipment membership through two transactional Postgres functions
 * (move_shipments_between_batches, remove_shipments_from_batch — see
 * supabase/migrations/admin_batch_management.sql) that re-validate status,
 * zone, capacity and stop limits INSIDE the transaction, then logs every
 * change to batch_admin_actions.
 */
const router = Router();
router.use(requireAdmin);

const REASON_CODE_SET = new Set(BATCH_ADMIN_REASON_CODES.map(r => r.value));
const ACTIVE_BATCH_STATUSES = ['pending_assignment', 'assigned', 'in_transit'] as const;

function validateReason(body: Record<string, unknown>): { reason_code: BatchAdminReasonCode; reason: string } | { error: string } {
  const reason_code = body.reason_code as string | undefined;
  const reason = (body.reason as string | undefined)?.trim();
  if (!reason_code || !REASON_CODE_SET.has(reason_code as BatchAdminReasonCode)) {
    return { error: 'سبب الإجراء غير صالح' };
  }
  if (!reason) {
    return { error: 'يجب كتابة سبب للإجراء' };
  }
  return { reason_code: reason_code as BatchAdminReasonCode, reason };
}

async function getCapacityConfig(): Promise<{ maxVolume: number; maxStops: number; delayThresholdMinutes: number }> {
  const { data } = await supabase
    .from('batch_config')
    .select('max_driver_capacity, max_stops_per_batch, delay_threshold_minutes')
    .eq('id', 1)
    .maybeSingle();
  return {
    maxVolume: data?.max_driver_capacity ?? 100,
    maxStops: data?.max_stops_per_batch ?? 20,
    delayThresholdMinutes: data?.delay_threshold_minutes ?? 180,
  };
}

async function logAction(entry: {
  batch_id: string;
  shipment_id?: string | null;
  action_type: BatchAdminActionType;
  from_batch_id?: string | null;
  to_batch_id?: string | null;
  previous_status?: string | null;
  new_status?: string | null;
  reason_code?: string | null;
  reason?: string | null;
  notes?: string | null;
  performed_by: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await supabase.from('batch_admin_actions').insert(entry);
  if (error) console.error('[AdminBatches] audit log insert failed:', error.message);
}

interface BatchVolumeRow { id: string; volume: number; pickup_zone: string; dropoff_zone: string; status: string; batch_id: string | null }

async function fetchShipmentVolumes(ids: string[]): Promise<BatchVolumeRow[]> {
  if (!ids.length) return [];
  const { data } = await supabase
    .from('shipments')
    .select('id, status, batch_id, pickup_zone, dropoff_zone, order_details(qty, products(capacity_units))')
    .in('id', ids);
  return ((data as any[]) ?? []).map(row => ({
    id: row.id,
    status: row.status,
    batch_id: row.batch_id,
    pickup_zone: row.pickup_zone,
    dropoff_zone: row.dropoff_zone,
    volume: (row.order_details?.qty ?? 0) * (row.order_details?.products?.capacity_units ?? 0),
  }));
}

/* ───────────────────────────── GET /reason-codes ───────────────────────────── */
router.get('/reason-codes', (_req: Request, res: Response) => {
  res.json({ ok: true, reason_codes: BATCH_ADMIN_REASON_CODES });
});

/* ───────────────────────────── GET / (list) ───────────────────────────── */
router.get('/', async (req: Request, res: Response) => {
  const { status, driver_id, zone, delayed, breakdown, date_from, date_to, q } = req.query as Record<string, string | undefined>;

  let query = supabase
    .from('batches')
    .select('*, couriers!assigned_to(id, name, status)')
    .order('created_at', { ascending: false })
    .limit(300);

  if (status) query = query.eq('status', status);
  if (driver_id) query = query.eq('assigned_to', driver_id);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', date_to);
  if (breakdown === 'true') query = query.not('breakdown_reported_at', 'is', null);

  if (q?.trim()) {
    const term = q.trim();
    // Search by batch number directly, or resolve a shipment number/id to its batch.
    const { data: viaShipment } = await supabase
      .from('shipments')
      .select('batch_id')
      .or(`shipment_number.eq.${term},id.eq.${term}`)
      .not('batch_id', 'is', null)
      .limit(5);
    const batchIdsFromShipment = [...new Set((viaShipment ?? []).map(s => s.batch_id))];
    if (batchIdsFromShipment.length) {
      query = query.or(`batch_number.ilike.%${term}%,id.in.(${batchIdsFromShipment.join(',')})`);
    } else {
      query = query.ilike('batch_number', `%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const rows = (data as any[]) ?? [];
  const config = await getCapacityConfig();
  const now = Date.now();

  const allShipmentIds = rows.flatMap(b => [...(b.ab_shipment_ids ?? []), ...(b.bc_shipment_ids ?? [])]);
  const { data: shipStatusRows } = allShipmentIds.length
    ? await supabase.from('shipments').select('id, batch_id, status').in('id', allShipmentIds)
    : { data: [] as any[] };
  const statusByBatch = new Map<string, { picked_up: number; not_picked_up: number; delivered: number; stranded: number }>();
  for (const s of shipStatusRows ?? []) {
    const bucket = statusByBatch.get(s.batch_id) ?? { picked_up: 0, not_picked_up: 0, delivered: 0, stranded: 0 };
    if (s.status === 'picked_up') bucket.picked_up++;
    else if (s.status === 'delivered') bucket.delivered++;
    else if (s.status === 'stranded') bucket.stranded++;
    else bucket.not_picked_up++;
    statusByBatch.set(s.batch_id, bucket);
  }

  let batches = rows.map(b => {
    const counts = statusByBatch.get(b.id) ?? { picked_up: 0, not_picked_up: 0, delivered: 0, stranded: 0 };
    const startedMinutesAgo = b.started_at ? (now - new Date(b.started_at).getTime()) / 60000 : null;

    const autoDelayed = b.status === 'in_transit' && startedMinutesAgo !== null && startedMinutesAgo > config.delayThresholdMinutes;
    const deadlineDelayed = !!b.expected_completion_at && new Date(b.expected_completion_at).getTime() < now
      && !['completed', 'cancelled'].includes(b.status);
    const reportedDelayed = !!b.delay_reported_at;
    const is_delayed = autoDelayed || deadlineDelayed || reportedDelayed;

    let delay_minutes = 0;
    if (is_delayed) {
      const ref = b.expected_completion_at
        ? new Date(b.expected_completion_at).getTime()
        : b.delay_reported_at
          ? new Date(b.delay_reported_at).getTime()
          : (b.started_at ? new Date(b.started_at).getTime() + config.delayThresholdMinutes * 60000 : now);
      delay_minutes = Math.max(0, Math.round((now - ref) / 60000));
    }

    const has_active_breakdown = !!b.breakdown_reported_at && !b.breakdown_resolved_at;

    return {
      id: b.id,
      batch_number: b.batch_number,
      status: b.status,
      route: b.route ?? [],
      zone: (b.route ?? [])[0] ?? null,
      total_volume: b.total_volume,
      max_volume: config.maxVolume,
      max_stops: config.maxStops,
      reserved_until: b.reserved_until,
      needs_dispatcher: b.needs_dispatcher,
      estimated_minutes_to_next_zone: b.estimated_minutes_to_next_zone ?? null,
      stops_used: (b.ab_shipment_ids?.length ?? 0) + (b.bc_shipment_ids?.length ?? 0),
      shipment_count: (b.ab_shipment_ids?.length ?? 0) + (b.bc_shipment_ids?.length ?? 0),
      picked_up_count: counts.picked_up,
      not_picked_up_count: counts.not_picked_up,
      delivered_count: counts.delivered,
      stranded_count: counts.stranded,
      created_at: b.created_at,
      started_at: b.started_at,
      completed_at: b.completed_at,
      expected_completion_at: b.expected_completion_at,
      courier: b.couriers ? { id: b.couriers.id, name: b.couriers.name, status: b.couriers.status } : null,
      is_delayed,
      delay_minutes,
      delay_reason: b.delay_reason,
      delay_reported_at: b.delay_reported_at,
      delay_reported_by: b.delay_reported_by,
      under_monitoring: b.under_monitoring,
      requires_manual_intervention: b.requires_manual_intervention,
      has_active_breakdown,
      breakdown_reported_at: b.breakdown_reported_at,
      breakdown_reason: b.breakdown_reason,
      breakdown_resolved_at: b.breakdown_resolved_at,
    };
  });

  if (zone) batches = batches.filter(b => b.zone === zone);
  if (delayed === 'true') batches = batches.filter(b => b.is_delayed);
  if (delayed === 'lt1h') batches = batches.filter(b => b.is_delayed && b.delay_minutes < 60);
  if (delayed === 'gt1h') batches = batches.filter(b => b.is_delayed && b.delay_minutes >= 60);
  if (delayed === 'severe') batches = batches.filter(b => b.is_delayed && b.delay_minutes >= 240);
  if (delayed === 'with_reason') batches = batches.filter(b => b.is_delayed && !!b.delay_reason);
  if (delayed === 'without_reason') batches = batches.filter(b => b.is_delayed && !b.delay_reason);

  res.json({ ok: true, batches, config });
});

/* ───────────────────────────── GET /breakdowns ───────────────────────────── */
// Registered before the /:batchId param route so it isn't shadowed.
router.get('/breakdowns', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('batches')
    .select('*, couriers!assigned_to(id, name, status, location)')
    .not('breakdown_reported_at', 'is', null)
    .order('breakdown_reported_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const rows = (data as any[]) ?? [];
  const allIds = rows.flatMap(b => [...(b.ab_shipment_ids ?? []), ...(b.bc_shipment_ids ?? [])]);
  const { data: shipRows } = allIds.length
    ? await supabase.from('shipments').select('id, batch_id, status, shipment_number').in('id', allIds)
    : { data: [] as any[] };

  const byBatch = new Map<string, any[]>();
  for (const s of shipRows ?? []) {
    const arr = byBatch.get(s.batch_id) ?? [];
    arr.push(s);
    byBatch.set(s.batch_id, arr);
  }

  const cases = rows.map(b => {
    const ships = byBatch.get(b.id) ?? [];
    return {
      id: b.id,
      batch_number: b.batch_number,
      status: b.status,
      route: b.route ?? [],
      courier: b.couriers ? { id: b.couriers.id, name: b.couriers.name, location: b.couriers.location } : null,
      breakdown_reported_at: b.breakdown_reported_at,
      breakdown_reason: b.breakdown_reason,
      breakdown_location: b.breakdown_location,
      breakdown_resolved_at: b.breakdown_resolved_at,
      breakdown_resolution: b.breakdown_resolution,
      requires_manual_intervention: b.requires_manual_intervention,
      not_picked_up: ships.filter(s => s.status === 'batched' || s.status === 'reserved' || s.status === 'available').length,
      stranded: ships.filter(s => s.status === 'stranded').map(s => ({ id: s.id, shipment_number: s.shipment_number })),
      is_active: !b.breakdown_resolved_at,
    };
  });

  res.json({ ok: true, cases });
});

/* ───────────────────────────── GET /:batchId ───────────────────────────── */
router.get('/:batchId', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };

  const { data: batch, error } = await supabase
    .from('batches')
    .select('*, couriers!assigned_to(id, name, status, location, max_volume)')
    .eq('id', batchId)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!batch) return res.status(404).json({ ok: false, error: 'التجميعة غير موجودة' });

  const allIds = [...(batch.ab_shipment_ids ?? []), ...(batch.bc_shipment_ids ?? [])];
  const { data: shipRows } = allIds.length
    ? await supabase
        .from('shipments')
        .select(`
          id, shipment_number, status, order_id, order_detail_id, store_id,
          pickup_zone, dropoff_zone, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
          picked_up_at, delivered_at, deadline, created_at,
          order_details!order_detail_id(order_id, qty, products!product_id(title, capacity_units), shops!shop_id(name))
        `)
        .in('id', allIds)
    : { data: [] as any[] };

  // Resolve buyer (customer) names the same way the driver "pickup-delivery" view
  // does: orders.shipping_address snapshot first, customer_profiles as fallback.
  const orderIds = [...new Set((shipRows ?? []).map((s: any) => s.order_details?.order_id ?? s.order_id).filter((v: unknown) => v != null))];
  const { data: orders } = orderIds.length
    ? await supabase.from('orders').select('id, user_id, shipping_address').in('id', orderIds)
    : { data: [] as any[] };
  const orderMap = new Map<number, any>((orders ?? []).map((o: any) => [o.id, o]));
  const userIds = [...new Set((orders ?? []).map((o: any) => o.user_id).filter(Boolean))] as string[];
  const { data: profiles } = userIds.length
    ? await supabase.from('customer_profiles').select('user_id, first_name, last_name').in('user_id', userIds)
    : { data: [] as any[] };
  const profileMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));

  const shipments = ((shipRows as any[]) ?? []).map(s => {
    const orderId = s.order_details?.order_id ?? s.order_id ?? null;
    const order = orderId != null ? orderMap.get(orderId) : null;
    const sa = order?.shipping_address ?? {};
    const prof = order?.user_id ? profileMap.get(order.user_id) : null;
    const customerName =
      [sa.firstName, sa.lastName].filter(Boolean).join(' ').trim() ||
      [prof?.first_name, prof?.last_name].filter(Boolean).join(' ').trim() || null;

    return {
      id: s.id,
      shipment_number: s.shipment_number,
      status: s.status,
      order_id: orderId,
      merchant_name: s.order_details?.shops?.name ?? null,
      customer_name: customerName,
      pickup_zone: s.pickup_zone,
      dropoff_zone: s.dropoff_zone,
      pickup_lat: s.pickup_lat,
      pickup_lng: s.pickup_lng,
      dropoff_lat: s.dropoff_lat,
      dropoff_lng: s.dropoff_lng,
      volume: (s.order_details?.qty ?? 0) * (s.order_details?.products?.capacity_units ?? 0),
      deadline: s.deadline,
      picked_up_at: s.picked_up_at,
      delivered_at: s.delivered_at,
      leg: (batch.ab_shipment_ids ?? []).includes(s.id) ? 'ab' : 'bc',
      not_picked_up: s.status === 'batched' || s.status === 'reserved',
      in_driver_custody: s.status === 'picked_up',
      delivered: s.status === 'delivered',
      requires_manual_handling: s.status === 'stranded',
    };
  });

  const { data: auditLog } = await supabase
    .from('batch_admin_actions')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false })
    .limit(100);

  const performerIds = [...new Set((auditLog ?? []).map(a => a.performed_by))];
  const { data: performers } = performerIds.length
    ? await supabase.from('Users').select('user_id, name').in('user_id', performerIds)
    : { data: [] as any[] };
  const performerMap = new Map((performers ?? []).map(p => [p.user_id, p.name]));

  const config = await getCapacityConfig();

  res.json({
    ok: true,
    batch: {
      id: batch.id,
      batch_number: batch.batch_number,
      status: batch.status,
      route: batch.route ?? [],
      total_volume: batch.total_volume,
      max_volume: config.maxVolume,
      max_stops: config.maxStops,
      remaining_capacity: Math.max(0, config.maxVolume - (batch.total_volume ?? 0)),
      created_at: batch.created_at,
      started_at: batch.started_at,
      completed_at: batch.completed_at,
      assigned_at: batch.assigned_at,
      expected_completion_at: batch.expected_completion_at,
      reserved_until: batch.reserved_until,
      courier: batch.couriers
        ? { id: batch.couriers.id, name: batch.couriers.name, status: batch.couriers.status, location: batch.couriers.location, max_volume: batch.couriers.max_volume }
        : null,
      delay_reported_at: batch.delay_reported_at,
      delay_reason: batch.delay_reason,
      delay_reported_by: batch.delay_reported_by,
      under_monitoring: batch.under_monitoring,
      requires_manual_intervention: batch.requires_manual_intervention,
      breakdown_reported_at: batch.breakdown_reported_at,
      breakdown_reason: batch.breakdown_reason,
      breakdown_location: batch.breakdown_location,
      breakdown_resolved_at: batch.breakdown_resolved_at,
      breakdown_resolution: batch.breakdown_resolution,
    },
    shipments,
    audit_log: (auditLog ?? []).map(a => ({ ...a, performed_by_name: performerMap.get(a.performed_by) ?? null })),
  });
});

/* ───────────────────── GET /:batchId/eligible-destinations ───────────────────── */
router.get('/:batchId/eligible-destinations', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const shipmentIds = String(req.query.shipment_ids ?? '').split(',').filter(Boolean);
  if (!shipmentIds.length) return res.status(400).json({ ok: false, error: 'shipment_ids مطلوبة' });

  const { data: source } = await supabase.from('batches').select('*').eq('id', batchId).maybeSingle();
  if (!source) return res.status(404).json({ ok: false, error: 'التجميعة غير موجودة' });

  const ships = await fetchShipmentVolumes(shipmentIds);
  const sourceAb = new Set(source.ab_shipment_ids ?? []);
  const sourceBc = new Set(source.bc_shipment_ids ?? []);
  const invalid = ships.filter(s =>
    s.batch_id !== batchId ||
    !['batched', 'reserved'].includes(s.status) ||
    !(sourceAb.has(s.id) || sourceBc.has(s.id)),
  );
  if (invalid.length || ships.length !== shipmentIds.length) {
    return res.status(400).json({ ok: false, error: 'بعض الشحنات غير مؤهلة للنقل', invalid_shipment_ids: invalid.map(s => s.id) });
  }

  const movingVolume = ships.reduce((sum, s) => sum + s.volume, 0);
  const movingCount = ships.length;
  // A single move may carry shipments from both the A→B leg and the B→C leg —
  // each leg has its own fixed zone pair, so collect every distinct pair present.
  const zonePairs = [...new Map(ships.map(s => [`${s.pickup_zone}→${s.dropoff_zone}`, { from: s.pickup_zone, to: s.dropoff_zone }])).values()];

  const { data: candidates } = await supabase
    .from('batches')
    .select('*, couriers!assigned_to(name)')
    .in('status', ['pending_assignment', 'assigned'])
    .neq('id', batchId)
    .order('created_at', { ascending: false })
    .limit(200);

  const config = await getCapacityConfig();

  const destinations = (candidates ?? []).map((b: any) => {
    const reasons: string[] = [];
    const route = b.route ?? [];
    // Every distinct zone pair among the selected shipments must match one of
    // the destination's two existing legs (A→B, or B→C if it has a 3rd zone).
    // We never create a new leg/zone on the destination — only match into
    // slots that already exist on its route.
    const destAbPair = route.length >= 2 ? `${route[0]}→${route[1]}` : null;
    const destBcPair = route.length >= 3 ? `${route[1]}→${route[2]}` : null;
    const allPairsMatch = zonePairs.every(p => `${p.from}→${p.to}` === destAbPair || `${p.from}→${p.to}` === destBcPair);
    if (!allPairsMatch) reasons.push('different_zone');
    const stopsUsed = (b.ab_shipment_ids?.length ?? 0) + (b.bc_shipment_ids?.length ?? 0);
    if (stopsUsed + movingCount > config.maxStops) reasons.push('max_stops_exceeded');
    if ((b.total_volume ?? 0) + movingVolume > config.maxVolume) reasons.push('insufficient_capacity');
    if (b.breakdown_reported_at && !b.breakdown_resolved_at) reasons.push('active_breakdown');

    return {
      id: b.id,
      batch_number: b.batch_number,
      status: b.status,
      route,
      courier_name: b.couriers?.name ?? null,
      total_volume: b.total_volume,
      max_volume: config.maxVolume,
      capacity_after: (b.total_volume ?? 0) + movingVolume,
      stops_used: stopsUsed,
      stops_after: stopsUsed + movingCount,
      max_stops: config.maxStops,
      eligible: reasons.length === 0,
      blocked_reasons: reasons,
    };
  });

  res.json({ ok: true, moving_volume: movingVolume, moving_count: movingCount, zone_pairs: zonePairs, destinations });
});

/* ───────────────────────── POST /:batchId/move-shipments ───────────────────── */
router.post('/:batchId/move-shipments', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const shipment_ids = body.shipment_ids as string[] | undefined;
  const destination_batch_id = body.destination_batch_id as string | undefined;
  const notes = (body.notes as string | undefined)?.trim() || null;

  if (!shipment_ids?.length) return res.status(400).json({ ok: false, error: 'يجب اختيار شحنة واحدة على الأقل' });
  if (!destination_batch_id) return res.status(400).json({ ok: false, error: 'التجميعة الوجهة مطلوبة' });

  const reasonResult = validateReason(body);
  if ('error' in reasonResult) return res.status(400).json({ ok: false, error: reasonResult.error });

  const { data: result, error } = await supabase.rpc('move_shipments_between_batches', {
    p_shipment_ids: shipment_ids,
    p_source_batch_id: batchId,
    p_destination_batch_id: destination_batch_id,
  });

  if (error) {
    console.error('[AdminBatches] move-shipments RPC error:', error.message);
    return res.status(500).json({ ok: false, error: 'فشل تنفيذ عملية النقل' });
  }

  const r = result as { success: boolean; error_code?: string; moved_volume?: number; source_emptied?: boolean };
  if (!r.success) {
    const messages: Record<string, string> = {
      same_batch: 'لا يمكن النقل إلى نفس التجميعة',
      no_shipments: 'لم يتم تحديد شحنات',
      source_not_found: 'تجميعة المصدر غير موجودة',
      destination_not_found: 'تجميعة الوجهة غير موجودة',
      destination_not_eligible: 'تجميعة الوجهة لا تقبل إضافة شحنات (بدأ التسليم أو اكتملت أو أُلغيت)',
      destination_no_route: 'تجميعة الوجهة لا تملك مساراً محدداً',
      shipment_not_found: 'بعض الشحنات غير موجودة',
      shipment_not_eligible: 'بعض الشحنات غير مؤهلة للنقل (تم استلامها من السائق أو تسليمها)',
      destination_zone_mismatch: 'منطقة الاستلام/التسليم لبعض الشحنات لا تطابق أي مسار في تجميعة الوجهة',
      capacity_exceeded: 'سعة المركبة في تجميعة الوجهة غير كافية',
      max_stops_exceeded: 'عدد محطات تجميعة الوجهة سيتجاوز الحد المسموح',
    };
    return res.status(409).json({ ok: false, error: messages[r.error_code ?? ''] ?? 'تعذّر تنفيذ عملية النقل', error_code: r.error_code });
  }

  const actionType: BatchAdminActionType = shipment_ids.length > 1 ? 'move_shipments_bulk' : 'move_shipment';
  await logAction({
    batch_id: batchId,
    shipment_id: shipment_ids.length === 1 ? shipment_ids[0] : null,
    action_type: actionType,
    from_batch_id: batchId,
    to_batch_id: destination_batch_id,
    reason_code: reasonResult.reason_code,
    reason: reasonResult.reason,
    notes,
    performed_by: req.adminUserId!,
    metadata: { shipment_ids, moved_volume: r.moved_volume, source_emptied: r.source_emptied },
  });

  res.json({ ok: true, moved_volume: r.moved_volume, source_emptied: r.source_emptied });
});

/* ──────────────────────── POST /:batchId/remove-shipments ──────────────────── */
router.post('/:batchId/remove-shipments', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const shipment_ids = body.shipment_ids as string[] | undefined;
  const notes = (body.notes as string | undefined)?.trim() || null;

  if (!shipment_ids?.length) return res.status(400).json({ ok: false, error: 'يجب اختيار شحنة واحدة على الأقل' });

  const reasonResult = validateReason(body);
  if ('error' in reasonResult) return res.status(400).json({ ok: false, error: reasonResult.error });

  const { data: result, error } = await supabase.rpc('remove_shipments_from_batch', {
    p_shipment_ids: shipment_ids,
    p_batch_id: batchId,
  });

  if (error) {
    console.error('[AdminBatches] remove-shipments RPC error:', error.message);
    return res.status(500).json({ ok: false, error: 'فشل تنفيذ عملية الإزالة' });
  }

  const r = result as { success: boolean; error_code?: string; removed_volume?: number; batch_emptied?: boolean };
  if (!r.success) {
    const messages: Record<string, string> = {
      no_shipments: 'لم يتم تحديد شحنات',
      batch_not_found: 'التجميعة غير موجودة',
      shipment_not_found: 'بعض الشحنات غير موجودة',
      shipment_not_eligible: 'لا يمكن إزالة شحنة تم استلامها من السائق أو تسليمها — تتطلب معالجة يدوية',
    };
    return res.status(409).json({ ok: false, error: messages[r.error_code ?? ''] ?? 'تعذّر تنفيذ عملية الإزالة', error_code: r.error_code });
  }

  for (const shipmentId of shipment_ids) {
    await logAction({
      batch_id: batchId,
      shipment_id: shipmentId,
      action_type: 'remove_shipment',
      from_batch_id: batchId,
      previous_status: 'batched_or_reserved',
      new_status: 'available',
      reason_code: reasonResult.reason_code,
      reason: reasonResult.reason,
      notes,
      performed_by: req.adminUserId!,
      metadata: { removed_volume: r.removed_volume, batch_emptied: r.batch_emptied },
    });
  }

  res.json({ ok: true, removed_volume: r.removed_volume, batch_emptied: r.batch_emptied });
});

/* ──────────────────── POST /:batchId/update-estimated-time ─────────────────── */
router.post('/:batchId/update-estimated-time', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const expected_completion_at = body.expected_completion_at as string | undefined;
  const reason = (body.reason as string | undefined)?.trim();

  if (!expected_completion_at || Number.isNaN(new Date(expected_completion_at).getTime())) {
    return res.status(400).json({ ok: false, error: 'وقت الإنجاز المتوقع غير صالح' });
  }
  if (!reason) return res.status(400).json({ ok: false, error: 'يجب كتابة سبب للتحديث' });

  const { data: batch } = await supabase.from('batches').select('id, status, expected_completion_at').eq('id', batchId).maybeSingle();
  if (!batch) return res.status(404).json({ ok: false, error: 'التجميعة غير موجودة' });
  if (['completed', 'cancelled'].includes(batch.status)) {
    return res.status(409).json({ ok: false, error: 'لا يمكن تعديل تجميعة مكتملة أو ملغاة' });
  }

  const { error } = await supabase.from('batches').update({ expected_completion_at }).eq('id', batchId);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  await logAction({
    batch_id: batchId,
    action_type: 'update_estimated_time',
    reason,
    performed_by: req.adminUserId!,
    metadata: { previous_expected_completion_at: batch.expected_completion_at, new_expected_completion_at: expected_completion_at },
  });

  res.json({ ok: true });
});

/* ───────────────────────────── POST /:batchId/add-note ──────────────────────── */
router.post('/:batchId/add-note', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const note = (body.note as string | undefined)?.trim();
  const under_monitoring = body.under_monitoring as boolean | undefined;
  const manual_intervention = body.manual_intervention as boolean | undefined;
  const driver_contacted = body.driver_contacted as boolean | undefined;

  if (!note) return res.status(400).json({ ok: false, error: 'يجب كتابة ملاحظة' });

  const { data: batch } = await supabase.from('batches').select('id').eq('id', batchId).maybeSingle();
  if (!batch) return res.status(404).json({ ok: false, error: 'التجميعة غير موجودة' });

  const patch: Record<string, unknown> = {};
  if (under_monitoring !== undefined) patch.under_monitoring = under_monitoring;
  if (manual_intervention !== undefined) patch.requires_manual_intervention = manual_intervention;

  if (Object.keys(patch).length) {
    const { error } = await supabase.from('batches').update(patch).eq('id', batchId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
  }

  const actionType: BatchAdminActionType = manual_intervention
    ? 'escalate_manual_intervention'
    : under_monitoring
      ? 'mark_under_monitoring'
      : 'add_note';

  await logAction({
    batch_id: batchId,
    action_type: actionType,
    notes: note,
    performed_by: req.adminUserId!,
    metadata: { under_monitoring, manual_intervention, driver_contacted },
  });

  res.json({ ok: true });
});

/* ───────────────────────── POST /:batchId/resolve-breakdown ─────────────────── */
router.post('/:batchId/resolve-breakdown', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const resolution = body.resolution as string | undefined;
  const note = (body.note as string | undefined)?.trim();
  const stranded_dispositions = (body.stranded_dispositions as { shipment_id: string; disposition: string }[] | undefined) ?? [];

  const VALID_RESOLUTIONS = ['shipments_repooled', 'manual_intervention_pending', 'returned_to_warehouse', 'follow_up_required'];
  if (!resolution || !VALID_RESOLUTIONS.includes(resolution)) {
    return res.status(400).json({ ok: false, error: 'نوع المعالجة غير صالح' });
  }
  if (!note) return res.status(400).json({ ok: false, error: 'يجب كتابة سبب/ملاحظة لإغلاق العطل' });

  const { data: batch } = await supabase.from('batches').select('id, breakdown_reported_at, breakdown_resolved_at').eq('id', batchId).maybeSingle();
  if (!batch) return res.status(404).json({ ok: false, error: 'التجميعة غير موجودة' });
  if (!batch.breakdown_reported_at) return res.status(400).json({ ok: false, error: 'لا يوجد عطل مسجّل لهذه التجميعة' });
  if (batch.breakdown_resolved_at) return res.status(400).json({ ok: false, error: 'تمت معالجة هذا العطل مسبقاً' });

  // Only shipments explicitly confirmed "returned_to_warehouse" leave the stranded
  // state — never a blanket status change. Everything else stays 'stranded'.
  const returnedIds = stranded_dispositions
    .filter(d => d.disposition === 'returned_to_warehouse')
    .map(d => d.shipment_id);

  if (returnedIds.length) {
    const { error: shipErr } = await supabase
      .from('shipments')
      .update({ status: 'available', batch_id: null, reserved_until: null })
      .in('id', returnedIds)
      .eq('status', 'stranded');
    if (shipErr) return res.status(500).json({ ok: false, error: shipErr.message });
  }

  const { count: stillStranded } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('status', 'stranded');

  const { error: updErr } = await supabase
    .from('batches')
    .update({
      breakdown_resolved_at: new Date().toISOString(),
      breakdown_resolution: resolution,
      requires_manual_intervention: (stillStranded ?? 0) > 0,
    })
    .eq('id', batchId);
  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  await logAction({
    batch_id: batchId,
    action_type: 'resolve_breakdown',
    reason: resolution,
    notes: note,
    performed_by: req.adminUserId!,
    metadata: { resolution, stranded_dispositions, returned_count: returnedIds.length, still_stranded: stillStranded ?? 0 },
  });

  res.json({ ok: true, returned_count: returnedIds.length, still_stranded: stillStranded ?? 0 });
});

/* ───────────────────────────── POST /:batchId/change-driver ─────────────────── */
// Assign or change the courier on a batch. Hidden/blocked entirely for
// completed/cancelled batches. If the batch is already in_transit (the
// current driver has physically departed), the client must show the admin an
// explicit warning and re-submit with confirm_departed: true — enforced here
// too, not just in the UI, since the backend is the source of truth.
router.post('/:batchId/change-driver', async (req: Request, res: Response) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const courier_id = body.courier_id as string | undefined;
  const confirm_departed = body.confirm_departed === true;
  const notes = (body.notes as string | undefined)?.trim() || null;

  if (!courier_id) return res.status(400).json({ ok: false, error: 'السائق مطلوب' });

  const reasonResult = validateReason(body);
  if ('error' in reasonResult) return res.status(400).json({ ok: false, error: reasonResult.error });

  const { data: batch } = await supabase.from('batches').select('id, status, assigned_to').eq('id', batchId).maybeSingle();
  if (!batch) return res.status(404).json({ ok: false, error: 'التجميعة غير موجودة' });

  if (['completed', 'cancelled'].includes(batch.status)) {
    return res.status(409).json({ ok: false, error: 'لا يمكن تغيير السائق لتجميعة مكتملة أو ملغاة', error_code: 'batch_closed' });
  }
  if (batch.assigned_to === courier_id) {
    return res.status(400).json({ ok: false, error: 'هذا السائق معيّن لهذه التجميعة بالفعل' });
  }
  if (batch.status === 'in_transit' && batch.assigned_to && !confirm_departed) {
    return res.status(409).json({ ok: false, error: 'السائق الحالي خرج بالفعل لتنفيذ المهمة — يلزم تأكيد إضافي', error_code: 'driver_already_departed' });
  }

  const { data: courier } = await supabase.from('couriers').select('id, name').eq('id', courier_id).maybeSingle();
  if (!courier) return res.status(404).json({ ok: false, error: 'السائق غير موجود' });

  const { data: prevCourier } = batch.assigned_to
    ? await supabase.from('couriers').select('name').eq('id', batch.assigned_to).maybeSingle()
    : { data: null as { name: string } | null };

  const newStatus = batch.status === 'pending_assignment' ? 'assigned' : batch.status;
  const { error: updErr } = await supabase
    .from('batches')
    .update({ assigned_to: courier_id, assigned_at: new Date().toISOString(), needs_dispatcher: false, status: newStatus })
    .eq('id', batchId);
  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  await supabase.from('driver_notifications').insert({ courier_id, batch_id: batchId, is_accepted: true });

  await logAction({
    batch_id: batchId,
    action_type: 'change_driver',
    previous_status: batch.status,
    new_status: newStatus,
    reason_code: reasonResult.reason_code,
    reason: reasonResult.reason,
    notes,
    performed_by: req.adminUserId!,
    metadata: {
      previous_courier_id: batch.assigned_to,
      previous_courier_name: prevCourier?.name ?? null,
      new_courier_id: courier_id,
      new_courier_name: courier.name,
      driver_already_departed: batch.status === 'in_transit' && !!batch.assigned_to,
    },
  });

  res.json({ ok: true });
});

export default router;
