import { Router, Request, Response } from 'express';
import { runBatchCycle, startBatchCycleScheduler } from './batchCycle.js';
import { startBackgroundJobs } from './phases/phase7_backgroundJobs.js';
import { handleBreakdown } from './phases/phase9_breakdownHandling.js';
import { tryAddShipmentsToBatch } from './phases/phase8_inTransitAdditions.js';
import { sequenceIntraCityTasks } from './phases/phase10_intraCitySequencing.js';
import { sequenceIntraCityTasksGoogle } from './phases/phase10_googleRouteOptimization.js';
import { prefetchPairs } from './distanceProvider.js';
import { atomicAssign } from './driverAssignment.js';
import { autoAssignUnbatchedShipments } from './phases/phase0a_autoAssignUnbatched.js';
import { supabase } from '../supabase.js';
import { C } from './constants.js';
import { loadPaymentConfig } from '../lib/paymentConfig.js';
import type { TrackingEventType } from '../../shared/trackingEvents.js';

export const logisticsRouter = Router();

// ── Driver tracking events ───────────────────────────────────────────────────
// Records a driver action (pickup / delivery) into order_tracking_events so the
// customer-facing tracking timeline stays in sync. Best-effort and NEVER throws
// — it's invoked fire-and-forget (`void insertDriverTrackingEvent(...)`), so an
// unhandled rejection here would crash the request/process.
async function insertDriverTrackingEvent(
  shipmentId: string,
  orderDetailId: number | null,
  eventType: TrackingEventType,
): Promise<void> {
  try {
    // order_tracking_events.order_id is NOT NULL. The shipment's own order_id can
    // be null on older rows, so resolve via the order detail first, then fall back.
    let orderId: number | null = null;
    if (orderDetailId != null) {
      const { data: od } = await supabase
        .from('order_details').select('order_id').eq('id', orderDetailId).maybeSingle();
      orderId = (od?.order_id as number | null) ?? null;
    }
    if (orderId == null) {
      const { data: sh } = await supabase
        .from('shipments').select('order_id').eq('id', shipmentId).maybeSingle();
      orderId = (sh?.order_id as number | null) ?? null;
    }
    if (orderId == null) {
      console.warn(`[tracking] cannot resolve order_id for shipment ${shipmentId} — skipping ${eventType}`);
      return;
    }

    const note =
      eventType === 'driver_picked_up' ? 'استلم السائق الشحنة من المتجر' :
      eventType === 'driver_delivered' ? 'سلّم السائق الشحنة للعميل' : '';

    const { error } = await supabase.from('order_tracking_events').insert({
      order_id:        orderId,
      shipment_id:     shipmentId,
      step:            eventType,
      event_type:      eventType,
      requires_review: false,
      triggered_by:    'السائق',
      note,
    });
    if (error) console.error(`[tracking] insert ${eventType} failed:`, error.message);
  } catch (err) {
    console.error('[tracking] insertDriverTrackingEvent error:', err);
  }
}

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
    // Primary: Google Route Optimization solves the pickup-and-delivery problem
    // with capacity, time windows, and live traffic. On ANY failure (missing
    // config, network/API error, infeasible or invalid result) we fall back to
    // the local Greedy + 2-opt sequencer so dispatch is never blocked.
    let sequence;
    let solver: 'google' | 'greedy_2opt' = 'google';
    try {
      sequence = await sequenceIntraCityTasksGoogle(tasks, entry_point, initial_volume ?? 0);
    } catch (gErr) {
      console.warn('[Logistics] Route Optimization failed, falling back to Greedy+2-opt:',
        (gErr as Error).message);
      solver = 'greedy_2opt';

      // Warm the road-distance cache for every stop the sequencer will evaluate, so the
      // (synchronous) greedy + 2-opt run on real road distances. A prefetch failure is
      // non-fatal: getRoadDistanceKm falls back to Haversine.
      const locations = [entry_point, ...tasks.map((t: { location: unknown }) => t.location)];
      await prefetchPairs(locations as any);

      sequence = sequenceIntraCityTasks(tasks, entry_point, initial_volume ?? 0);
    }
    res.json({ success: true, solver, sequence });
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

  // Defense-in-depth: an assigned batch should always mean the courier is on_route
  // (set atomically in atomicAssign at accept time). Block the start if that invariant
  // is somehow violated, instead of silently proceeding on a desynced status.
  const { data: courier } = await supabase
    .from('couriers')
    .select('status')
    .eq('id', courier_id)
    .maybeSingle();

  if (courier?.status !== 'on_route') {
    res.status(403).json({ success: false, error: 'Driver is not on_route for this batch' });
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
    .select('id, batch_id, status, order_detail_id')
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

  void insertDriverTrackingEvent(shipment_id, shipment.order_detail_id as number | null, 'driver_picked_up');

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

    // Free the courier only if they have no other active batch (one active batch per driver).
    const { count: otherActive } = await supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', courier_id)
      .in('status', ['assigned', 'in_transit']);

    if (!otherActive) {
      await supabase.from('couriers').update({ status: 'available' }).eq('id', courier_id).eq('status', 'on_route');
    }
  }

  void insertDriverTrackingEvent(shipment_id, shipment.order_detail_id as number | null, 'driver_delivered');

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
    const result = await atomicAssign(batch_id, courier_id);
    if (result.success) {
      res.json({ success: true, message: 'Batch assigned to you' });
    } else if (result.reason === 'courier_unavailable') {
      res.status(403).json({ success: false, message: 'Driver is not available or already has an active batch' });
    } else {
      res.status(409).json({ success: false, message: 'Batch already taken' });
    }
  } catch (err) {
    console.error('[Logistics] /accept error:', err);
    res.status(500).json({ success: false, error: 'Assignment failed' });
  }
});

// ── GET /api/logistics/pickup-delivery ───────────────────────────────────────
// Driver "التسليم والاستلام" view: in_transit batches for a courier, each with
// its shipments enriched with STORE (pickup) and BUYER (delivery) details.
// Runs server-side with the service-role client so it bypasses the RLS that
// blocks the driver's browser client from reading orders / shops.
// Query: ?courier_id=<uuid>
logisticsRouter.get('/pickup-delivery', async (req: Request, res: Response) => {
  const courier_id = req.query.courier_id as string | undefined;
  if (!courier_id) {
    res.status(400).json({ success: false, error: 'courier_id is required' });
    return;
  }

  try {
    const { data: batchRows } = await supabase
      .from('batches')
      .select('id, batch_number, route, started_at')
      .eq('assigned_to', courier_id)
      .eq('status', 'in_transit')
      .order('started_at', { ascending: false });

    if (!batchRows?.length) {
      res.json({ success: true, batches: [] });
      return;
    }

    const batchIds = batchRows.map((b) => b.id as string);

    const { data: ships } = await supabase
      .from('shipments')
      .select(
        'id, shipment_number, status, batch_id, pickup_zone, dropoff_zone, picked_up_at, delivered_at, ' +
        'dropoff_lat, dropoff_lng, dropoff_formatted_address, delivery_address_description, order_id, store_id, order_detail_id',
      )
      .in('batch_id', batchIds);

    const shipRows = (ships ?? []) as any[];

    // Resolve store + order through order_details, because older shipments have
    // store_id / order_id left NULL (those columns were populated later). The
    // order_detail link is always present and carries shop_id + order_id.
    const detailIds = [...new Set(shipRows.map((s) => s.order_detail_id).filter((v) => v != null))];
    const { data: details } = detailIds.length
      ? await supabase.from('order_details').select('id, shop_id, order_id').in('id', detailIds)
      : { data: [] as any[] };
    const detailMap = new Map<number, any>((details ?? []).map((d: any) => [d.id, d]));

    // Store details — shops keyed by shop_id (from shipment.store_id or order_detail.shop_id)
    const shopIds = [...new Set([
      ...shipRows.map((s) => s.store_id),
      ...((details ?? []).map((d: any) => d.shop_id)),
    ].filter(Boolean))] as string[];
    const { data: shops } = shopIds.length
      ? await supabase.from('shops').select('shop_id, name, location, shop_lat, shop_lng, whatsapp').in('shop_id', shopIds)
      : { data: [] as any[] };
    const shopMap = new Map<string, any>((shops ?? []).map((s: any) => [s.shop_id, s]));

    // Buyer details — order's checkout snapshot, with customer_profiles as fallback
    const orderIds = [...new Set([
      ...shipRows.map((s) => s.order_id),
      ...((details ?? []).map((d: any) => d.order_id)),
    ].filter((v) => v != null))];
    const { data: orders } = orderIds.length
      ? await supabase.from('orders').select('id, user_id, shipping_address, delivery_address_description').in('id', orderIds)
      : { data: [] as any[] };
    const orderMap = new Map<number, any>((orders ?? []).map((o: any) => [o.id, o]));

    const userIds = [...new Set((orders ?? []).map((o: any) => o.user_id).filter(Boolean))] as string[];
    const { data: profiles } = userIds.length
      ? await supabase.from('customer_profiles').select('user_id, first_name, last_name, phone, street, apartment, city, delivery_address_description').in('user_id', userIds)
      : { data: [] as any[] };
    const profileMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));

    const shipByBatch = new Map<string, any[]>();
    for (const s of shipRows) {
      const detail  = s.order_detail_id != null ? detailMap.get(s.order_detail_id) : null;
      const shopId  = s.store_id ?? detail?.shop_id ?? null;
      const shop    = shopId ? shopMap.get(shopId) ?? {} : {};
      const orderId = s.order_id ?? detail?.order_id ?? null;
      const order   = orderId != null ? orderMap.get(orderId) : null;
      const sa      = order?.shipping_address ?? {};
      const prof    = order?.user_id ? profileMap.get(order.user_id) : null;

      const buyerName =
        [sa.firstName, sa.lastName].filter(Boolean).join(' ').trim() ||
        [prof?.first_name, prof?.last_name].filter(Boolean).join(' ').trim();
      const buyerPhone = sa.phone ?? prof?.phone ?? null;
      const buyerAddr =
        [sa.address, sa.apartment, sa.city].filter(Boolean).join('، ') ||
        [prof?.street, prof?.apartment, prof?.city].filter(Boolean).join('، ') ||
        s.dropoff_formatted_address || s.dropoff_zone || null;
      const buyerNote =
        s.delivery_address_description ?? order?.delivery_address_description ?? prof?.delivery_address_description ?? null;

      const mapped = {
        id:             s.id,
        shipmentNumber: s.shipment_number ?? '',
        status:         s.status,
        pickupZone:     s.pickup_zone ?? '—',
        dropoffZone:    s.dropoff_zone ?? '—',
        pickedUpAt:     s.picked_up_at ?? null,
        deliveredAt:    s.delivered_at ?? null,
        store: {
          name:     shop.name ?? '—',
          location: shop.location ?? null,
          lat:      shop.shop_lat ?? null,
          lng:      shop.shop_lng ?? null,
          whatsapp: shop.whatsapp ?? null,
        },
        buyer: {
          name:    buyerName || '—',
          phone:   buyerPhone,
          address: buyerAddr,
          note:    buyerNote,
          lat:     s.dropoff_lat ?? null,
          lng:     s.dropoff_lng ?? null,
        },
      };
      const arr = shipByBatch.get(s.batch_id) ?? [];
      arr.push(mapped);
      shipByBatch.set(s.batch_id, arr);
    }

    const batches = batchRows.map((b) => ({
      id:          b.id as string,
      batchNumber: (b.batch_number as string) ?? '',
      route:       (b.route as string[]) ?? [],
      shipments:   shipByBatch.get(b.id as string) ?? [],
    }));

    res.json({ success: true, batches });
  } catch (err) {
    console.error('[Logistics] /pickup-delivery error:', err);
    res.status(500).json({ success: false, error: 'Failed to load pickup & delivery data' });
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
