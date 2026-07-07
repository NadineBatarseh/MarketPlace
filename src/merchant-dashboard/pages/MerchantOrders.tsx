import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';
import { fetchBatchNumbers } from '../../lib/batchNumbers';

const API_BASE = 'http://localhost:4000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: number;
  product_id: string;
  product_title: string;
  product_image: string | null;
  qty: number;
  unit_price: number;
  ready_time: string | null;
  /** Human-readable display code, e.g. "S-100234" — see shipments.shipment_number. */
  shipment_number: string | null;
  /** Display code of the logistics batch this shipment is grouped into, if any. */
  batch_number: string | null;
}

/** The order owner's identifying info, taken from the frozen checkout snapshot. */
interface OrderCustomer {
  name: string;
  phone: string | null;
}

interface MerchantOrder {
  id: number;
  /** Human-readable display code, e.g. "O-100066" — see orders.order_number. */
  order_number: string;
  status: string;
  total_price: number;
  created_at: string;
  ready_time: string | null;
  items: OrderItem[];
  customer: OrderCustomer | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'pending' | 'processed';

const PROCESSED_STATUSES = ['delivering', 'completed'];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:    { label: 'في انتظار المعالجة', color: '#f59e0b' },
  delivering: { label: 'تمت المعالجة',        color: '#0ea5e9' },
  completed:  { label: 'تمت المعالجة',        color: '#22c55e' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MerchantOrders() {
  const { merchant } = useMerchantAuth();
  const [orders, setOrders]     = useState<MerchantOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [marking, setMarking]   = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter]     = useState<FilterKey>('all');

  const shopId = merchant?.shop?.shop_id;

  useEffect(() => {
    if (shopId) load(shopId);
    else setLoading(false);
  }, [shopId]);

  const load = async (sid: string) => {
    setLoading(true);
    setError('');
    try {
      // 1. Get all order_details rows for this shop (ready_time lives here)
      const { data: details, error: detErr } = await supabase
        .from('order_details')
        .select('id, order_id, product_id, qty, unit_price, ready_time')
        .eq('shop_id', sid);

      if (detErr) throw detErr;
      if (!details?.length) { setOrders([]); setLoading(false); return; }

      const orderIds  = [...new Set(details.map(d => d.order_id as number))];
      const productIds = [...new Set(details.map(d => d.product_id as string).filter(Boolean))];

      // 2. Fetch orders (no ready_time here — it lives in order_details)
      const { data: ordersData, error: ordErr } = await supabase
        .from('orders')
        .select('id, order_number, status, total_price, created_at, shipping_address')
        .in('id', orderIds)
        .order('created_at', { ascending: false });

      if (ordErr) throw ordErr;

      // 3. Fetch product info for item display
      const { data: products } = await supabase
        .from('products')
        .select('id, title, image_urls')
        .in('id', productIds);

      const productMap = new Map(
        (products ?? []).map(p => [p.id, { title: p.title, image: p.image_urls?.[0] ?? null }])
      );

      // 3b. Fetch each line's shipment (for its display number) and, for lines
      // already grouped into a batch, that batch's display number. batch_number
      // goes through fetchBatchNumbers() since the batches table isn't exposed
      // to merchant clients directly — see server/routes/ordersRouter.ts.
      const detailIds2 = details.map(d => d.id as number);
      const { data: shipmentsData } = detailIds2.length
        ? await supabase.from('shipments').select('id, order_detail_id, shipment_number, batch_id').in('order_detail_id', detailIds2)
        : { data: [] as any[] };

      const shipmentIdsWithBatch = (shipmentsData ?? [])
        .filter((s: any) => s.batch_id)
        .map((s: any) => s.id as string);
      const batchNumberByShipment = await fetchBatchNumbers(shipmentIdsWithBatch);

      const shipmentByDetail = new Map<number, { shipment_number: string; batch_number: string | null }>();
      (shipmentsData ?? []).forEach((s: any) => {
        shipmentByDetail.set(s.order_detail_id as number, {
          shipment_number: s.shipment_number,
          batch_number: batchNumberByShipment[s.id] ?? null,
        });
      });

      // 4. Build order → items map and derive ready_time per order from details rows
      const itemsByOrder   = new Map<number, OrderItem[]>();

      for (const d of details) {
        if (!itemsByOrder.has(d.order_id)) {
          itemsByOrder.set(d.order_id, []);
        }
        const prod = productMap.get(d.product_id);
        const shipmentInfo = shipmentByDetail.get(d.id);
        itemsByOrder.get(d.order_id)!.push({
          id:              d.id,
          product_id:      d.product_id,
          product_title:   prod?.title ?? 'منتج محذوف',
          product_image:   prod?.image ?? null,
          qty:             d.qty ?? 1,
          unit_price:      Number(d.unit_price) || 0,
          ready_time:      d.ready_time ?? null,
          shipment_number: shipmentInfo?.shipment_number ?? null,
          batch_number:    shipmentInfo?.batch_number ?? null,
        });
      }

      // The order is ready for this shop only when ALL its detail rows have
      // ready_time set — computed after the full items list per order is known,
      // so a single ready item can't flip the whole order's badge early.
      const readyTimeByOrder = new Map<number, string | null>();
      for (const [orderId, items] of itemsByOrder) {
        const allReady = items.every(it => it.ready_time);
        readyTimeByOrder.set(
          orderId,
          allReady ? items.map(it => it.ready_time as string).sort()[0] : null
        );
      }

      // 4b. Derive the order owner's display name/phone from the frozen checkout snapshot.
      const customerFromSnapshot = (raw: unknown): OrderCustomer | null => {
        const s = raw as { firstName?: string; lastName?: string; phone?: string } | null;
        if (!s) return null;
        const name = [s.firstName, s.lastName].filter(Boolean).join(' ').trim();
        if (!name && !s.phone) return null;
        return { name: name || 'عميل', phone: s.phone ?? null };
      };

      // 5. Merge into final list
      const result: MerchantOrder[] = (ordersData ?? []).map(o => ({
        id:           o.id,
        order_number: (o as any).order_number,
        status:      o.status,
        total_price: Number(o.total_price) || 0,
        created_at:  o.created_at,
        ready_time:  readyTimeByOrder.get(o.id) ?? null,
        items:       itemsByOrder.get(o.id) ?? [],
        customer:    customerFromSnapshot(o.shipping_address),
      }));

      setOrders(result);
    } catch (err: any) {
      setError('تعذّر تحميل الطلبات');
      console.error(err);
    }
    setLoading(false);
  };

  // Mark a single order line (one product) ready for pickup, independent of the
  // rest of the order. Done via the server (service-role) because RLS denies the
  // merchant client a direct UPDATE on order_details — a client-side update would
  // silently affect 0 rows, so ready_time would never persist and the shipment
  // trigger would never fire.
  const markItemReady = async (orderId: number, detailId: number) => {
    setMarking(detailId);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('no-session');

      const res = await fetch(`${API_BASE}/api/orders/${orderId}/details/${detailId}/mark-ready`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'failed');

      // Only reflect success in the UI after the server confirms the write.
      // orders.status itself never changes here (server-side it only ever
      // holds 'pending' | 'delivering' | 'completed') — "ready for pickup"
      // is reflected by each item's ready_time + its shipment flipping to 'available'.
      setOrders(prev =>
        prev.map(o => {
          if (o.id !== orderId) return o;
          const items = o.items.map(it =>
            it.id === detailId ? { ...it, ready_time: json.ready_time as string } : it
          );
          const allReady = items.every(it => it.ready_time);
          const ready_time = allReady
            ? items.map(it => it.ready_time as string).sort()[0]
            : null;
          return { ...o, items, ready_time };
        })
      );
    } catch (err: any) {
      setError(err?.message === 'no-session' ? 'انتهت الجلسة، يرجى تسجيل الدخول من جديد' : 'فشل تحديث حالة المنتج');
    } finally {
      setMarking(null);
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <div className="mo-center">جاري تحميل الطلبات...</div>;

  if (!shopId) return <div className="mo-center">لم تقم بإنشاء متجرك بعد.</div>;

  return (
    <div className="mo-root">
      <div className="mo-header">
        <h1 className="mo-title">طلباتي</h1>
        <button className="mo-refresh-btn" onClick={() => load(shopId)}>↻ تحديث</button>
      </div>

      {error && <div className="mo-error">{error}</div>}

      {/* Filter tabs */}
      <div className="mo-filters">
        {([
          { key: 'all',       label: 'الكل' },
          { key: 'pending',   label: 'في انتظار المعالجة' },
          { key: 'processed', label: 'تمت المعالجة' },
        ] as { key: FilterKey; label: string }[]).map(f => (
          <button
            key={f.key}
            className={`mo-filter-btn${filter === f.key ? ' mo-filter-btn--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="mo-filter-count">
              {f.key === 'all'       ? orders.length
               : f.key === 'pending'  ? orders.filter(o => !PROCESSED_STATUSES.includes(o.status)).length
               : orders.filter(o => PROCESSED_STATUSES.includes(o.status)).length}
            </span>
          </button>
        ))}
      </div>

      {(() => {
        const visible = orders.filter(o =>
          filter === 'all'       ? true
          : filter === 'pending'   ? !PROCESSED_STATUSES.includes(o.status)
          : PROCESSED_STATUSES.includes(o.status)
        );
        return visible.length === 0 ? (
          <div className="mo-empty">
            <div className="mo-empty-icon">📭</div>
            <p>لا توجد طلبات في هذه الفئة</p>
          </div>
        ) : (
          <div className="mo-list">
            {visible.map(order => {
            const statusCfg = STATUS_LABEL[order.status] ?? { label: order.status, color: '#6b7280' };
            const isOpen    = expanded.has(order.id);
            const isMarked  = !!order.ready_time;

            return (
              <div key={order.id} className="mo-card">
                {/* ── Card header ── */}
                <div className="mo-card-header" onClick={() => toggleExpand(order.id)}>
                  <div className="mo-card-left">
                    <span className="mo-order-id">{order.order_number}</span>
                    <span
                      className="mo-status-badge"
                      style={{ background: statusCfg.color + '22', color: statusCfg.color, borderColor: statusCfg.color + '55' }}
                    >
                      {statusCfg.label}
                    </span>
                    {isMarked && (
                      <span className="mo-ready-badge">✔ جاهز للاستلام</span>
                    )}
                    {order.customer && (
                      <span className="mo-customer-info">
                        👤 {order.customer.name}
                        {order.customer.phone ? ` • ${order.customer.phone}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="mo-card-right">
                    <span className="mo-price">{order.total_price.toLocaleString('en-US')} ₪</span>
                    <span className="mo-date">
                      {new Date(order.created_at).toLocaleDateString('ar-EG-u-nu-latn', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                    <span className="mo-chevron">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* ── Expanded details ── */}
                {isOpen && (
                  <div className="mo-card-body">
                    {/* Items table — each product can be marked ready independently */}
                    <div className="mo-items">
                      {order.items.map(item => {
                        const canMarkItem = order.status === 'pending' && !item.ready_time;
                        return (
                          <div key={item.id} className="mo-item-row">
                            {item.product_image ? (
                              <img src={item.product_image} alt={item.product_title} className="mo-item-img" />
                            ) : (
                              <div className="mo-item-img mo-item-img--placeholder">📦</div>
                            )}
                            <div className="mo-item-info">
                              <span className="mo-item-title">{item.product_title}</span>
                              <span className="mo-item-meta">
                                الكمية: {item.qty} × {item.unit_price.toLocaleString('ar-EG')} ₪
                              </span>
                              {item.shipment_number && (
                                <span className="mo-item-shipment-num">
                                  رقم الشحنة: {item.shipment_number}
                                  {item.batch_number && <> · رقم التجميعة: {item.batch_number}</>}
                                </span>
                              )}
                            </div>
                            <span className="mo-item-subtotal">
                              {(item.qty * item.unit_price).toLocaleString('ar-EG')} ₪
                            </span>
                            {item.ready_time ? (
                              <span className="mo-item-ready">✔ جاهز</span>
                            ) : canMarkItem ? (
                              <button
                                className="mo-item-mark-btn"
                                disabled={marking === item.id}
                                onClick={() => markItemReady(order.id, item.id)}
                              >
                                {marking === item.id ? '...' : 'جاهز للاستلام'}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {/* Ready time info */}
                    {order.ready_time && (
                      <div className="mo-ready-info">
                        ✅ تم تجهيز جميع منتجات هذا الطلب في:{' '}
                        {new Date(order.ready_time).toLocaleString('ar-EG', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        );
      })()}
    </div>
  );
}
