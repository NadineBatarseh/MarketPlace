import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { PC } from '../lib/paymentConfig.js';
import { fetchZoneById, pointInZone } from '../lib/zones.js';
import { createShipmentsForOrder } from '../lib/shipments.js';

/**
 * Orders router — server-authoritative order placement.
 *
 * Mounted at /api/orders. Order creation runs here (service-role key) instead of
 * from the browser because:
 *   - RLS on public.orders denies client INSERT (money/fulfilment table), and
 *   - prices must come from products.price in the DB, never the client cart.
 *
 * The client sends only { product_id, qty }; the server prices every line,
 * stamps user_id from the auth token, and writes order + order_details + the
 * first 'placed' tracking event in one trusted place.
 */
const router = Router();

// products.id is a uuid — a single malformed value makes Postgres reject the
// whole `.in('id', …)` query, so we drop anything that isn't a valid uuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IncomingItem { product_id: string; qty: number }

interface IncomingContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

interface IncomingShipping {
  address?: string;
  apartment?: string;
  city?: string;
  postalCode?: string;
}

/**
 * Structured delivery destination chosen at checkout. Unlike the free-text
 * `shipping` snapshot, this drives fulfilment: zone_id groups shipments into
 * batches, lat/lng feed route optimisation. lat/lng are validated server-side
 * against the chosen zone's bounding box before the order is written.
 */
interface IncomingDropoff {
  zone_id?: string;
  zone?: string;
  lat?: number;
  lng?: number;
  place_id?: string;
  formatted_address?: string;
  description?: string;
}

/** Trim a string; return null for empty/missing so the snapshot stays clean. */
function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

router.post('/create', requireCustomer, async (req: Request, res: Response) => {
  const { items, payment_method, shipping, contact, dropoff } = req.body as {
    items?: IncomingItem[];
    payment_method?: 'paytabs' | 'cod';
    shipping?: IncomingShipping;
    contact?: IncomingContact;
    dropoff?: IncomingDropoff;
  };

  // ── Delivery destination: required + validated server-side ────────────────
  // The frontend must send a chosen zone and an exact map pin. We never trust the
  // zone selection alone — the coordinates must actually fall inside that zone.
  const lat = typeof dropoff?.lat === 'number' ? dropoff.lat : NaN;
  const lng = typeof dropoff?.lng === 'number' ? dropoff.lng : NaN;
  if (!dropoff?.zone_id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok: false, error: 'يرجى اختيار منطقة التوصيل وتحديد الموقع على الخريطة' });
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ ok: false, error: 'إحداثيات الموقع غير صالحة' });
  }
  const zone = await fetchZoneById(dropoff.zone_id);
  if (!zone) {
    return res.status(400).json({ ok: false, error: 'المنطقة المحددة غير صالحة' });
  }
  if (!pointInZone(zone, lat, lng)) {
    return res.status(400).json({
      ok: false,
      error: 'الموقع المحدد خارج حدود المنطقة المختارة. يرجى تغيير المنطقة أو تعديل الموقع على الخريطة.',
    });
  }

  // Snapshot of WHERE this order ships, frozen at purchase time (stored as JSONB
  // on the order). The address is legitimately client-supplied — unlike prices,
  // which are always recomputed from the DB below.
  const shippingAddress = {
    firstName:  clean(contact?.firstName),
    lastName:   clean(contact?.lastName),
    phone:      clean(contact?.phone),
    email:      clean(contact?.email),
    address:    clean(shipping?.address),
    apartment:  clean(shipping?.apartment),
    city:       clean(shipping?.city),
    postalCode: clean(shipping?.postalCode),
  };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'No items provided' });
  }

  // Normalise + dedupe incoming items, keep only valid product ids + positive qty.
  const wanted = new Map<string, number>();
  for (const it of items) {
    const id = typeof it?.product_id === 'string' ? it.product_id.trim() : '';
    if (!UUID_RE.test(id)) continue; // skip corrupt/stale cart entries
    const qty = Math.max(1, Math.floor(Number(it.qty) || 0));
    wanted.set(id, (wanted.get(id) ?? 0) + qty);
  }
  if (wanted.size === 0) return res.status(400).json({ ok: false, error: 'لا توجد منتجات صالحة في السلة' });

  // Price every line from the DB (authoritative). Skip deleted/archived products.
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, price, shop_id, is_deleted, is_archived')
    .in('id', [...wanted.keys()]);

  if (prodErr) return res.status(500).json({ ok: false, error: prodErr.message });

  const lines: Array<{ product_id: string; qty: number; unit_price: number; shop_id: string | null }> = [];
  let subtotal = 0;
  for (const p of products ?? []) {
    if (p.is_deleted || p.is_archived) continue;
    const qty = wanted.get(p.id);
    if (!qty) continue;
    const unit = Number(p.price ?? 0);
    subtotal += unit * qty;
    lines.push({ product_id: p.id, qty, unit_price: unit, shop_id: p.shop_id ?? null });
  }

  if (lines.length === 0) {
    return res.status(400).json({ ok: false, error: 'لا توجد منتجات متاحة للشراء' });
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const total = round(subtotal + PC.deliveryFee);

  // 1. Create the order (owned by the authenticated customer).
  //    Persists BOTH the free-text shipping snapshot and the structured delivery
  //    destination (zone + exact pin + courier directions), frozen at purchase.
  const { data: order, error: ordErr } = await supabase
    .from('orders')
    .insert({
      user_id: req.authUserId,
      status: 'pending',
      total_price: total,
      payment_status: payment_method === 'cod' ? 'cod' : 'unpaid',
      shipping_address: shippingAddress,
      delivery_lat: lat,
      delivery_lng: lng,
      delivery_address: clean(dropoff.formatted_address) ?? clean(shipping?.address),
      dropoff_zone_id: zone.id,
      dropoff_zone: zone.name,
      dropoff_place_id: clean(dropoff.place_id),
      dropoff_formatted_address: clean(dropoff.formatted_address),
      delivery_address_description: clean(dropoff.description),
    })
    .select('id')
    .single();

  if (ordErr || !order) {
    return res.status(500).json({ ok: false, error: ordErr?.message ?? 'فشل إنشاء الطلب' });
  }

  // 2. Insert order_details.
  const detailRows = lines.map((l) => ({
    order_id: order.id,
    product_id: l.product_id,
    qty: l.qty,
    unit_price: l.unit_price,
    shop_id: l.shop_id,
  }));
  const { error: detErr } = await supabase.from('order_details').insert(detailRows);
  if (detErr) {
    // Roll back the order so we never leave a header without items.
    await supabase.from('orders').delete().eq('id', order.id);
    return res.status(500).json({ ok: false, error: detErr.message });
  }

  // 3. First tracking event — best effort.
  await supabase
    .from('order_tracking_events')
    .insert({
      order_id: order.id,
      step: 'placed',
      triggered_by: 'العميل',
      location: zone.name ? `${zone.name}، فلسطين` : (shipping?.city ? `${shipping.city}، فلسطين` : null),
      note: 'تم استلام الطلب',
    })
    .then(undefined, () => {});

  // 4. Create one 'pending' shipment per order line immediately. These stay
  //    invisible to the batch engine until the merchant marks the line ready
  //    (a DB trigger then flips them to 'available'). Idempotent + best-effort:
  //    a shipment-creation hiccup must never fail an otherwise-valid order.
  try {
    await createShipmentsForOrder(order.id);
  } catch (e) {
    console.error('[orders] shipment creation failed for order', order.id, e);
  }

  return res.json({ ok: true, order_id: order.id, total_price: total });
});

/**
 * Merchant marks their lines of an order ready for pickup.
 *
 * Runs server-side (service-role) because RLS denies the merchant client a direct
 * UPDATE on order_details — the previous client-side update silently affected 0
 * rows, so ready_time was never written and the shipment ready-trigger never fired.
 *
 * Setting order_details.ready_time fires trg_shipment_mark_available, which flips
 * the matching 'pending' shipment(s) to 'available'. We ALSO flip them explicitly
 * (scoped to this order so legacy NULL-order_id seed rows are untouched) so the
 * flow still works even if that trigger is ever dropped.
 *
 * When EVERY shop in the order is ready we advance the order to 'pending_collection'
 * and record a 'collecting' tracking event.
 */
router.post('/:orderId/mark-ready', requireCustomer, async (req: Request, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ ok: false, error: 'رقم طلب غير صالح' });
  }

  // Resolve the caller's shop (auth.users → merchants → shops).
  const { data: shop } = await supabase
    .from('shops')
    .select('shop_id, name, merchants!inner(user_id)')
    .eq('merchants.user_id', req.authUserId!)
    .maybeSingle();
  if (!shop) return res.status(403).json({ ok: false, error: 'لا تملك متجراً' });

  // The shop's lines in this order (also confirms the order belongs to this shop).
  const { data: shopDetails, error: detErr } = await supabase
    .from('order_details')
    .select('id')
    .eq('order_id', orderId)
    .eq('shop_id', shop.shop_id);
  if (detErr) return res.status(500).json({ ok: false, error: detErr.message });
  if (!shopDetails?.length) {
    return res.status(404).json({ ok: false, error: 'لا توجد منتجات لمتجرك في هذا الطلب' });
  }

  const now = new Date().toISOString();
  const detailIds = shopDetails.map((d) => d.id);

  // 1. Stamp ready_time → fires the shipment ready-trigger.
  const { error: updErr } = await supabase
    .from('order_details')
    .update({ ready_time: now })
    .eq('order_id', orderId)
    .eq('shop_id', shop.shop_id);
  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  // 2. Backstop: release this order's pending shipments even if the trigger is absent.
  await supabase
    .from('shipments')
    .update({ status: 'available' })
    .eq('order_id', orderId)
    .in('order_detail_id', detailIds)
    .eq('status', 'pending');

  // 3. If every shop in the order is now ready, advance the order.
  const { data: allDetails } = await supabase
    .from('order_details')
    .select('ready_time')
    .eq('order_id', orderId);
  const allReady = (allDetails?.length ?? 0) > 0 && allDetails!.every((d) => d.ready_time != null);

  if (allReady) {
    await supabase
      .from('order_tracking_events')
      .insert({
        order_id: orderId,
        step: 'collecting',
        triggered_by: shop.name ?? 'المتجر',
        location: 'المتاجر المحلية',
        note: 'جميع المتاجر جهّزت الطلب وهو جاهز للتجميع',
      })
      .then(undefined, () => {});

    await supabase.from('orders').update({ status: 'pending_collection' }).eq('id', orderId);
  }

  return res.json({ ok: true, ready_time: now, all_ready: allReady });
});

export default router;
