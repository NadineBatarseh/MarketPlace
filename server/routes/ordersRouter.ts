import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { PC } from '../lib/paymentConfig.js';

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

/** Trim a string; return null for empty/missing so the snapshot stays clean. */
function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

router.post('/create', requireCustomer, async (req: Request, res: Response) => {
  const { items, payment_method, shipping, contact } = req.body as {
    items?: IncomingItem[];
    payment_method?: 'paytabs' | 'cod';
    shipping?: IncomingShipping;
    contact?: IncomingContact;
  };

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
  const { data: order, error: ordErr } = await supabase
    .from('orders')
    .insert({
      user_id: req.authUserId,
      status: 'pending',
      total_price: total,
      payment_status: payment_method === 'cod' ? 'cod' : 'unpaid',
      shipping_address: shippingAddress,
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
      location: shipping?.city ? `${shipping.city}، فلسطين` : null,
      note: 'تم استلام الطلب',
    })
    .then(undefined, () => {});

  return res.json({ ok: true, order_id: order.id, total_price: total });
});

export default router;
