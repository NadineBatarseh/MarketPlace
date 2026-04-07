import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: number;
  product_id: string;
  product_title: string;
  product_image: string | null;
  qty: number;
  unit_price: number;
}

interface MerchantOrder {
  id: number;
  status: string;
  total_price: number;
  created_at: string;
  ready_time: string | null;
  items: OrderItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (id: number) => `ORD-${String(id).padStart(3, '0')}`;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_collection: { label: 'بانتظار الاستلام', color: '#f59e0b' },
  at_hub:             { label: 'في نقطة التجميع', color: '#3b82f6' },
  consolidated:       { label: 'جاهز للتوصيل',   color: '#8b5cf6' },
  delivering:         { label: 'قيد التوصيل',     color: '#0ea5e9' },
  completed:          { label: 'تم التسليم',       color: '#22c55e' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MerchantOrders() {
  const { merchant } = useMerchantAuth();
  const [orders, setOrders]     = useState<MerchantOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [marking, setMarking]   = useState<number | null>(null); // orderId being marked
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const shopId = merchant?.shop?.shop_id;

  useEffect(() => {
    if (shopId) load(shopId);
    else setLoading(false);
  }, [shopId]);

  const load = async (sid: string) => {
    setLoading(true);
    setError('');
    try {
      // 1. Get all order_details rows for this shop
      const { data: details, error: detErr } = await supabase
        .from('order_details')
        .select('id, order_id, product_id, qty, unit_price')
        .eq('shop_id', sid);

      if (detErr) throw detErr;
      if (!details?.length) { setOrders([]); setLoading(false); return; }

      const orderIds  = [...new Set(details.map(d => d.order_id as number))];
      const productIds = [...new Set(details.map(d => d.product_id as string).filter(Boolean))];

      // 2. Fetch orders
      const { data: ordersData, error: ordErr } = await supabase
        .from('orders')
        .select('id, status, total_price, created_at, ready_time')
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

      // 4. Build order → items map (only this shop's items)
      const itemsByOrder = new Map<number, OrderItem[]>();
      for (const d of details) {
        if (!itemsByOrder.has(d.order_id)) itemsByOrder.set(d.order_id, []);
        const prod = productMap.get(d.product_id);
        itemsByOrder.get(d.order_id)!.push({
          id:            d.id,
          product_id:    d.product_id,
          product_title: prod?.title ?? 'منتج محذوف',
          product_image: prod?.image ?? null,
          qty:           d.qty ?? 1,
          unit_price:    Number(d.unit_price) || 0,
        });
      }

      // 5. Merge into final list
      const result: MerchantOrder[] = (ordersData ?? []).map(o => ({
        id:          o.id,
        status:      o.status,
        total_price: Number(o.total_price) || 0,
        created_at:  o.created_at,
        ready_time:  o.ready_time ?? null,
        items:       itemsByOrder.get(o.id) ?? [],
      }));

      setOrders(result);
    } catch (err: any) {
      setError('تعذّر تحميل الطلبات');
      console.error(err);
    }
    setLoading(false);
  };

  // Mark an order's packages as ready for pickup
  const markReady = async (orderId: number) => {
    setMarking(orderId);
    const { error } = await supabase
      .from('orders')
      .update({ ready_time: new Date().toISOString() })
      .eq('id', orderId);

    if (error) {
      setError('فشل تحديث حالة الطلب');
    } else {
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId ? { ...o, ready_time: new Date().toISOString() } : o
        )
      );
    }
    setMarking(null);
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

      {orders.length === 0 ? (
        <div className="mo-empty">
          <div className="mo-empty-icon">📭</div>
          <p>لا توجد طلبات حتى الآن</p>
        </div>
      ) : (
        <div className="mo-list">
          {orders.map(order => {
            const statusCfg = STATUS_LABEL[order.status] ?? { label: order.status, color: '#6b7280' };
            const isOpen    = expanded.has(order.id);
            const canMark   = order.status === 'pending_collection' && !order.ready_time;
            const isMarked  = !!order.ready_time;

            return (
              <div key={order.id} className="mo-card">
                {/* ── Card header ── */}
                <div className="mo-card-header" onClick={() => toggleExpand(order.id)}>
                  <div className="mo-card-left">
                    <span className="mo-order-id">{fmt(order.id)}</span>
                    <span
                      className="mo-status-badge"
                      style={{ background: statusCfg.color + '22', color: statusCfg.color, borderColor: statusCfg.color + '55' }}
                    >
                      {statusCfg.label}
                    </span>
                    {isMarked && (
                      <span className="mo-ready-badge">✔ جاهز للاستلام</span>
                    )}
                  </div>

                  <div className="mo-card-right">
                    <span className="mo-price">{order.total_price.toLocaleString('ar-EG')} جنيه</span>
                    <span className="mo-date">
                      {new Date(order.created_at).toLocaleDateString('ar-EG', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                    <span className="mo-chevron">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* ── Expanded details ── */}
                {isOpen && (
                  <div className="mo-card-body">
                    {/* Items table */}
                    <div className="mo-items">
                      {order.items.map(item => (
                        <div key={item.id} className="mo-item-row">
                          {item.product_image ? (
                            <img src={item.product_image} alt={item.product_title} className="mo-item-img" />
                          ) : (
                            <div className="mo-item-img mo-item-img--placeholder">📦</div>
                          )}
                          <div className="mo-item-info">
                            <span className="mo-item-title">{item.product_title}</span>
                            <span className="mo-item-meta">
                              الكمية: {item.qty} × {item.unit_price.toLocaleString('ar-EG')} جنيه
                            </span>
                          </div>
                          <span className="mo-item-subtotal">
                            {(item.qty * item.unit_price).toLocaleString('ar-EG')} جنيه
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Ready time info */}
                    {order.ready_time && (
                      <div className="mo-ready-info">
                        ✅ تم التجهيز في:{' '}
                        {new Date(order.ready_time).toLocaleString('ar-EG', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    )}

                    {/* Mark as ready button */}
                    {canMark && (
                      <button
                        className="mo-mark-btn"
                        disabled={marking === order.id}
                        onClick={() => markReady(order.id)}
                      >
                        {marking === order.id ? '...' : '✔ تم تجهيز الطرد — جاهز للاستلام'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
