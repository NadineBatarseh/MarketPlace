import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import './OrderTrackingPage.css';

// ── Types ──────────────────────────────────────────────────────────────────────

type ShipmentStatus =
  | 'pending' | 'available' | 'delayed' | 'batched' | 'reserved'
  | 'picked_up' | 'delivered' | 'stranded';

interface Product {
  id: string;
  title: string;
  image_urls: string[] | null;
  price: number | null;
}

interface Shop {
  shop_id: string;
  name: string;
}

interface Shipment {
  id: string;
  order_detail_id: number;
  status: ShipmentStatus;
  created_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
}

interface OrderDetail {
  id: number;
  product_id: string | null;
  shop_id: string | null;
  qty: number | null;
  unit_price: number | null;
  product: Product | null;
  shop: Shop | null;
  shipment: Shipment | null;
}

interface ShippingAddress {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  apartment: string | null;
  city: string | null;
  postalCode: string | null;
}

interface Order {
  id: number;
  total_price: number | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
  shipping_address: ShippingAddress | null;
  order_details: OrderDetail[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatOrderId(id: number) {
  return `#SQ-${String(id).padStart(5, '0')}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtShort(d: Date) {
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
}

function addH(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

function isToday(d: Date): boolean {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function computeOrderStep(details: OrderDetail[]): number {
  const ss = details.map(d => d.shipment?.status ?? null);
  if (details.length > 0 && details.every(d => d.shipment?.status === 'delivered')) return 3;
  if (ss.some(s => s === 'picked_up' || s === 'delivered')) return 2;
  if (ss.some(s => s && ['available', 'batched', 'reserved', 'delayed'].includes(s))) return 1;
  return 0;
}

function shipmentToStep(s: ShipmentStatus | null): number {
  if (!s || s === 'pending') return 0;
  if (s === 'available' || s === 'delayed') return 1;
  if (s === 'batched' || s === 'reserved' || s === 'stranded') return 2;
  if (s === 'picked_up') return 3;
  if (s === 'delivered') return 4;
  return 0;
}

function getDeliveryWindow(order: Order): { prefix: string; time: string } {
  const base = new Date(order.created_at);
  let start: Date;
  if (order.status === 'delivering') start = addH(new Date(), 2);
  else if (order.status === 'pending') start = addH(base, 26);
  else start = addH(base, 50);
  const end = addH(start, 2);
  const prefix = isToday(start) ? 'اليوم بين' : `${fmtShort(start)} بين`;
  return { prefix, time: `${fmtTime(start)} - ${fmtTime(end)}` };
}

const ORDER_STEPS = ['تم الطلب', 'جاهز للاستلام', 'قيد التوصيل', 'تم التسليم'];
const PRODUCT_STEPS = ['تم الطلب', 'جاهز للاستلام', 'في انتظار الاستلام', 'قيد التوصيل', 'تم التسليم'];

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate    = useNavigate();
  const { customer, isLoading: authLoading } = useCustomerAuth();

  const [order, setOrder]     = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !customer) navigate('/login');
  }, [authLoading, customer, navigate]);

  useEffect(() => {
    if (!customer || !orderId) return;
    let cancelled = false;

    async function load() {
      setLoading(true); setError(null);
      try {
        const { data: od, error: oe } = await supabase
          .from('orders')
          .select('id, total_price, status, payment_status, created_at')
          .eq('id', orderId).eq('user_id', customer!.id).single();
        if (oe || !od) throw oe ?? new Error('الطلب غير موجود');

        const { data: dd, error: de } = await supabase
          .from('order_details').select('id, order_id, product_id, shop_id, qty, unit_price')
          .eq('order_id', od.id);
        if (de) throw de;

        const details   = (dd ?? []) as any[];
        const detailIds = details.map(d => d.id as number);
        const prodIds   = [...new Set(details.map(d => d.product_id as string | null).filter(Boolean))] as string[];
        const shopIds   = [...new Set(details.map(d => d.shop_id    as string | null).filter(Boolean))] as string[];

        const [pr, sr, shr] = await Promise.all([
          prodIds.length ? supabase.from('products').select('id,title,image_urls,price').in('id', prodIds) : Promise.resolve({ data: [] as any[] }),
          shopIds.length ? supabase.from('shops').select('shop_id,name').in('shop_id', shopIds)             : Promise.resolve({ data: [] as any[] }),
          detailIds.length ? supabase.from('shipments').select('id,order_detail_id,status,created_at,picked_up_at,delivered_at').in('order_detail_id', detailIds) : Promise.resolve({ data: [] as any[] }),
        ]);

        const pm = new Map<string, Product>(); (pr.data ?? []).forEach((p: Product) => pm.set(p.id, p));
        const sm = new Map<string, Shop>();    (sr.data ?? []).forEach((s: any)     => sm.set(s.shop_id, s));
        const hm = new Map<number, Shipment>(); (shr.data ?? []).forEach((s: any)  => hm.set(s.order_detail_id as number, s));

        const merged: Order = {
          id: od.id, total_price: od.total_price, status: od.status,
          payment_status: od.payment_status, created_at: od.created_at,
          order_details: details.map(d => ({
            id: d.id, product_id: d.product_id, shop_id: d.shop_id,
            qty: d.qty, unit_price: d.unit_price,
            product:  d.product_id ? (pm.get(d.product_id) ?? null) : null,
            shop:     d.shop_id    ? (sm.get(d.shop_id)    ?? null) : null,
            shipment: hm.get(d.id) ?? null,
          })),
        };
        if (!cancelled) setOrder(merged);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'حدث خطأ أثناء تحميل الطلب');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [customer, orderId]);

  if (authLoading || loading) return (
    <><Topbar /><StoreNav />
      <div className="ot-page" dir="rtl">
        <div className="ot-loading"><div className="ot-spinner" /><span>جارٍ تحميل بيانات الطلب…</span></div>
      </div>
    </>
  );

  if (error || !order) return (
    <><Topbar /><StoreNav />
      <div className="ot-page" dir="rtl">
        <div className="ot-empty-state">
          <div className="ot-empty-icon">
            <svg width="52" height="52" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <h3>لم يتم العثور على الطلب</h3>
          <p>{error ?? 'هذا الطلب غير موجود أو لا ينتمي إلى حسابك.'}</p>
          <button type="button" className="ot-btn ot-btn--primary" onClick={() => navigate('/orders')}>العودة إلى طلباتي</button>
        </div>
      </div>
    </>
  );

  const activeStep  = computeOrderStep(order.order_details);
  const hasStranded = order.order_details.some(d => d.shipment?.status === 'stranded');
  const delivery    = getDeliveryWindow(order);

  return (
    <><Topbar /><StoreNav />
      <div className="ot-page" dir="rtl">

        {/* S1: Back */}
        <div className="ot-back-wrap">
          <button type="button" className="ot-back-btn" onClick={() => navigate('/orders')}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            العودة إلى الطلبات
          </button>
        </div>

        {/* S2: Header card */}
        <div className="ot-header-card">
          <div className="ot-hc-right">
            <div className="ot-hc-order-num">{formatOrderId(order.id)}</div>
            <div>
              <div className="ot-hc-date-label">تم إنشاء الطلب</div>
              <div className="ot-hc-date-val">{fmtDate(new Date(order.created_at))} - {fmtTime(new Date(order.created_at))}</div>
            </div>
            <StatusBadge status={order.status ?? 'pending'} />
          </div>
          <HeaderDeliveryBanner order={order} delivery={delivery} />
        </div>

        {/* S3: Timeline card */}
        <div className="ot-tl-card">
          <div className="ot-tlc-title">حالة الطلب العامة</div>
          <OrderTimeline activeStep={activeStep} order={order} />
          <AlertPanel order={order} hasStranded={hasStranded} />
        </div>

        {/* S4+S5: Two-column grid */}
        <div className="ot-main-grid">
          {/* Sidebar (right) */}
          <aside className="ot-sidebar">
            <DeliveryInfoCard order={order} delivery={delivery} />
            <SummaryCard order={order} />
          </aside>

          {/* Products (left) */}
          <ProductsSection order={order} navigate={navigate} />
        </div>

        {/* S6: Footer */}
        <SupportFooter order={order} />
      </div>
    </>
  );
}

// ── Status Badge ───────────────────────────────────────────────────────────────

const BADGE_CFG: Record<string, { label: string; variant: string }> = {
  pending:    { label: 'قيد الانتظار',  variant: 'blue'  },
  delivering: { label: 'قيد التوصيل', variant: 'blue'  },
  completed:  { label: 'مكتمل',         variant: 'green' },
  cancelled:  { label: 'ملغي',          variant: 'red'   },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = BADGE_CFG[status] ?? BADGE_CFG['pending'];
  return (
    <div className={`ot-status-badge ot-status-badge--${cfg.variant}`}>
      {cfg.variant === 'blue' && (
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
      )}
      {cfg.variant === 'green' && (
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="m5 12 5 5L20 7"/>
        </svg>
      )}
      {cfg.variant === 'red' && (
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      )}
      <span>{cfg.label}</span>
    </div>
  );
}

// ── Truck Illustration ─────────────────────────────────────────────────────────

function TruckIllustration() {
  return (
    <svg className="ot-truck-svg" width="110" height="72" viewBox="0 0 110 72" fill="none">
      <rect x="3" y="12" width="58" height="38" rx="5" fill="#DCFCE7" stroke="#16a34a" strokeWidth="1.5"/>
      <rect x="8" y="17" width="48" height="20" rx="3" fill="#BBF7D0"/>
      <rect x="14" y="21" width="16" height="12" rx="2" fill="#86efac"/>
      <rect x="34" y="21" width="16" height="12" rx="2" fill="#86efac"/>
      <path d="M61 24h30l10 14v12H61V24z" fill="#DCFCE7" stroke="#16a34a" strokeWidth="1.5"/>
      <path d="M61 24h24l8 14H61V24z" fill="#BBF7D0"/>
      <rect x="65" y="28" width="16" height="8" rx="2" fill="#86efac"/>
      <circle cx="18" cy="56" r="9" fill="#15803D"/>
      <circle cx="18" cy="56" r="4" fill="#DCFCE7"/>
      <circle cx="72" cy="56" r="9" fill="#15803D"/>
      <circle cx="72" cy="56" r="4" fill="#DCFCE7"/>
      <circle cx="88" cy="56" r="9" fill="#15803D"/>
      <circle cx="88" cy="56" r="4" fill="#DCFCE7"/>
    </svg>
  );
}

// ── Header Delivery Banner ─────────────────────────────────────────────────────

function HeaderDeliveryBanner({ order, delivery }: { order: Order; delivery: { prefix: string; time: string } }) {
  const isCompleted  = order.status === 'completed';
  const isDelivering = order.status === 'delivering';
  const deliveredAt  = order.order_details.find(d => d.shipment?.delivered_at)?.shipment?.delivered_at ?? null;

  if (isCompleted) return (
    <div className="ot-hc-left ot-hc-left--success">
      <svg className="ot-hcl-clock" width="52" height="52" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="#15803D" strokeWidth="1.5"/>
        <path d="m5 12 5 5L20 7" stroke="#15803D" strokeWidth="2.5"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">حالة الطلب</div>
        <div className="ot-hcd-time ot-hcd-time--success">تم تسليم الطلب بنجاح</div>
        {deliveredAt && (
          <div className="ot-hcd-note">تم التسليم بتاريخ: {fmtDate(new Date(deliveredAt))}</div>
        )}
      </div>
    </div>
  );

  if (!isDelivering) return (
    <div className="ot-hc-left ot-hc-left--success">
      <svg className="ot-hcl-clock" width="22" height="22" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">موعد التوصيل</div>
        <div className="ot-hcd-time ot-hcd-time--success">سيتم تحديد موعد التوصيل قريباً</div>
        <div className="ot-hcd-note">سيتم إشعارك عند تحديد الموعد</div>
      </div>
    </div>
  );

  return (
    <div className="ot-hc-left">
      <svg className="ot-hcl-clock" width="22" height="22" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">الوصول المتوقع</div>
        <div className="ot-hcd-time">{delivery.prefix} {delivery.time}</div>
        <div className="ot-hcd-note">سيتم تحديث الوقت تلقائياً</div>
      </div>
      <TruckIllustration />
    </div>
  );
}

// ── Order Timeline ─────────────────────────────────────────────────────────────

function getOrderTimestamps(order: Order): (Date | null)[] {
  const base = new Date(order.created_at);
  const pickedUpAt  = order.order_details.find(d => d.shipment?.picked_up_at)?.shipment?.picked_up_at;
  const deliveredAt = order.order_details.every(d => d.shipment?.status === 'delivered')
    ? order.order_details.find(d => d.shipment?.delivered_at)?.shipment?.delivered_at ?? null
    : null;

  return [
    base,
    addH(base, 3),
    pickedUpAt ? new Date(pickedUpAt) : (order.status === 'delivering' || order.status === 'completed' ? addH(base, 24) : null),
    deliveredAt ? new Date(deliveredAt) : null,
  ];
}

function OrderTimeline({ activeStep, order }: { activeStep: number; order: Order }) {
  const ts = getOrderTimestamps(order);
  return (
    <div className="ot-tl-wrap">
      <div className="ot-tl-track-row">
        <div className="ot-tl-track-bg" />
        <div className="ot-tl-track-fill" data-step={activeStep} />
      </div>
      <div className="ot-tl-steps">
        {ORDER_STEPS.map((label, idx) => {
          const isDone    = idx < activeStep;
          const isCurrent = idx === activeStep;
          const state     = isDone ? 'done' : isCurrent ? 'current' : 'future';
          const stamp     = ts[idx];
          return (
            <div key={idx} className={`ot-tl-step ot-tl-step--${state}`}>
              <div className="ot-tl-dot">
                {isDone && (
                  <svg width="14" height="14" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24">
                    <path d="m5 12 5 5L20 7"/>
                  </svg>
                )}
                {isCurrent && idx === 2 && (
                  <svg width="16" height="16" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="1" y="3" width="15" height="13" rx="1"/>
                    <path d="M16 8h4l3 5v3h-7V8z"/>
                    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                  </svg>
                )}
                {isCurrent && idx !== 2 && <span className="ot-tl-pulse" />}
              </div>
              <div className="ot-tl-info">
                <span className="ot-tl-label">{label}</span>
                {(isDone || isCurrent) && stamp ? (
                  <span className="ot-tl-time">{fmtShort(stamp)} - {fmtTime(stamp)}</span>
                ) : (
                  <span className="ot-tl-time ot-tl-time--empty">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Alert Panel ────────────────────────────────────────────────────────────────

function AlertPanel({ order, hasStranded }: { order: Order; hasStranded: boolean }) {
  if (hasStranded) return (
    <div className="ot-alert ot-alert--red">
      <svg width="18" height="18" fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div>
        <div className="ot-alert-title">هناك مشكلة في أحد منتجاتك</div>
        <div className="ot-alert-sub">سيتواصل معك فريق الدعم قريباً لحل المشكلة</div>
      </div>
    </div>
  );
  if (order.status === 'completed') return (
    <div className="ot-alert ot-alert--green">
      <svg width="18" height="18" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7"/>
      </svg>
      <div>
        <div className="ot-alert-title">تم تسليم طلبك بنجاح</div>
        <div className="ot-alert-sub">شكراً لثقتك بسوق لينك</div>
      </div>
    </div>
  );
  if (order.status === 'delivering') return (
    <div className="ot-alert ot-alert--blue">
      <svg width="18" height="18" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 5v3h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
      <div>
        <div className="ot-alert-title">السائق في الطريق إلى موقعك</div>
        <div className="ot-alert-sub">آخر تحديث: قبل 15 دقيقة</div>
      </div>
    </div>
  );
  return (
    <div className="ot-alert ot-alert--green">
      <svg width="18" height="18" fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div>
        <div className="ot-alert-title">جارٍ تجهيز طلبك</div>
        <div className="ot-alert-sub">سيتم إشعارك عند استلام المندوب للطلب</div>
      </div>
    </div>
  );
}

// ── Delivery Info Card ─────────────────────────────────────────────────────────

function DeliveryInfoCard({ order, delivery }: { order: Order; delivery: { prefix: string; time: string } }) {
  const isDelivering = order.status === 'delivering';
  return (
    <div className="ot-sb-card">
      <div className="ot-sb-title">
        <svg width="16" height="16" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        معلومات التوصيل
      </div>
      <div className="ot-sb-rows">
        {[
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
            label: 'اسم السائق',
            val: isDelivering ? 'أحمد خالد' : '—',
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 15a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 4.21h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 11.9a16 16 0 0 0 6 6l1.27-.93a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 19.18z"/></svg>,
            label: 'رقم التواصل',
            val: isDelivering ? '05*******38' : '—',
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
            label: 'وقت الوصول المتوقع',
            val: `${delivery.prefix}، ${delivery.time.split(' - ')[0]}`,
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
            label: 'عنوان التسليم',
            val: 'القدس، شارع صلاح الدين\nالعمارة 12، الطابق 3',
            multiline: true,
          },
        ].map(row => (
          <div key={row.label} className="ot-sb-row">
            <span className="ot-sb-icon">{row.icon}</span>
            <div>
              <div className="ot-sb-row-label">{row.label}</div>
              {row.multiline
                ? <div className="ot-sb-row-val">{row.val.split('\n').map((l, i) => <span key={i}>{l}{i === 0 && <br />}</span>)}</div>
                : <div className="ot-sb-row-val">{row.val}</div>
              }
            </div>
          </div>
        ))}
      </div>
      {isDelivering && (
        <button type="button" className="ot-sb-map-btn">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
            <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
          </svg>
          تتبع السائق على الخريطة
        </button>
      )}
    </div>
  );
}

// ── Order Summary Card ─────────────────────────────────────────────────────────

function SummaryCard({ order }: { order: Order }) {
  const total       = order.total_price ?? 0;
  const deliveryFee = 18;
  const count       = order.order_details.length;
  return (
    <div className="ot-sb-card">
      <div className="ot-sb-title">
        <svg width="16" height="16" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
        </svg>
        ملخص الطلب
      </div>
      <div className="ot-sb-summary">
        <div className="ot-sbs-row"><span>عدد المنتجات</span><span>{count}</span></div>
        <div className="ot-sbs-row"><span>رسوم التوصيل</span><span>₪{deliveryFee.toFixed(2)}</span></div>
        <div className="ot-sbs-row ot-sbs-row--total">
          <span className="ot-sbs-total-lbl">المجموع الكلي</span>
          <span className="ot-sbs-total-val">₪{total.toFixed(2)}</span>
        </div>
        <div className="ot-sbs-row">
          <span>حالة الدفع</span>
          <span className="ot-sbs-paid">
            <svg width="11" height="11" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="m5 12 5 5L20 7"/>
            </svg>
            مدفوع
          </span>
        </div>
      </div>

    </div>
  );
}

// ── Products Section ───────────────────────────────────────────────────────────

function ProductsSection({ order, navigate }: { order: Order; navigate: ReturnType<typeof useNavigate> }) {
  const [showAll, setShowAll] = useState(false);
  const MAX = 2;
  const all     = order.order_details;
  const visible = showAll ? all : all.slice(0, MAX);
  const hasMore = all.length > MAX;

  return (
    <div className="ot-products">
      <div className="ot-products-hd">
        <h2 className="ot-products-title">المنتجات في هذا الطلب</h2>
        <span className="ot-products-count">({all.length})</span>
      </div>
      <div className="ot-product-list">
        {visible.map(detail => (
          <ProductCard
            key={detail.id}
            detail={detail}
            orderCreatedAt={order.created_at}
            navigate={navigate}
          />
        ))}
      </div>
      {hasMore && (
        <button type="button" className={`ot-show-all-btn${showAll ? ' ot-show-all-btn--open' : ''}`} onClick={() => setShowAll(v => !v)}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
            className="ot-show-chevron">
            <path d="m6 9 6 6 6-6"/>
          </svg>
          {showAll ? 'عرض أقل' : 'عرض جميع المنتجات'}
        </button>
      )}
    </div>
  );
}

// ── Product Card ───────────────────────────────────────────────────────────────

function getProductTimestamps(detail: OrderDetail, orderCreatedAt: string): (Date | null)[] {
  const base = new Date(orderCreatedAt);
  const s    = detail.shipment;
  return [
    base,                                                            // 0: تم الطلب
    s ? new Date(s.created_at) : null,                               // 1: جاهز للاستلام
    null,                                                            // 2: في انتظار الاستلام (no DB timestamp)
    s?.picked_up_at ? new Date(s.picked_up_at) : null,              // 3: قيد التوصيل
    s?.delivered_at ? new Date(s.delivered_at) : null,              // 4: تم التسليم
  ];
}

function ProductCard({
  detail,
  orderCreatedAt,
  navigate,
}: {
  detail: OrderDetail;
  orderCreatedAt: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const product     = detail.product;
  const shop        = detail.shop;
  const shipment    = detail.shipment;
  const pStep       = shipmentToStep(shipment?.status ?? null);
  const isStranded  = shipment?.status === 'stranded';
  const imgUrl      = product?.image_urls?.[0];
  const price       = detail.unit_price ?? product?.price ?? 0;
  const qty         = detail.qty ?? 1;
  const timestamps  = getProductTimestamps(detail, orderCreatedAt);

  return (
    <div className={`ot-pc${isStranded ? ' ot-pc--stranded' : ''}`}>
      <div className="ot-pc-body">

        {/* Info col */}
        <div className="ot-pc-info">
          <div
            className={`ot-pc-img${detail.product_id ? ' ot-pc-img--link' : ''}`}
            onClick={detail.product_id ? () => navigate(`/product/${detail.product_id}`) : undefined}
          >
            {imgUrl
              ? <img src={imgUrl} alt={product?.title} />
              : <div className="ot-pc-img-ph">
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>
                  </svg>
                </div>
            }
          </div>
          <div className="ot-pc-meta">
            <div
              className={`ot-pc-name${detail.product_id ? ' ot-pc-name--link' : ''}`}
              onClick={detail.product_id ? () => navigate(`/product/${detail.product_id}`) : undefined}
            >
              {product?.title ?? 'منتج'}
            </div>
            {shop && (
              <div className="ot-pc-shop">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <path d="M9 22V12h6v10"/>
                </svg>
                المتجر: {shop.name}
              </div>
            )}
            <span className="ot-pc-qty-badge">{qty} قطعة</span>
            <div className="ot-pc-price">₪{(price * qty).toFixed(2)}</div>
          </div>
        </div>

        {/* Vertical timeline */}
        <div className="ot-pc-tl">
          {PRODUCT_STEPS.map((label, idx) => {
            const isDone    = idx < pStep;
            const isCurrent = idx === pStep;
            const state     = isDone ? 'done' : isCurrent ? 'current' : 'future';
            const stamp     = timestamps[idx];
            const isLast    = idx === PRODUCT_STEPS.length - 1;
            return (
              <div key={idx} className={`ot-pcs ot-pcs--${state}`}>
                <div className="ot-pcs-spine">
                  <div className="ot-pcs-dot">
                    {isDone && (
                      <svg width="9" height="9" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24">
                        <path d="m5 12 5 5L20 7"/>
                      </svg>
                    )}
                    {isCurrent && idx === 3 && (
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <rect x="1" y="3" width="15" height="13" rx="1"/>
                        <path d="M16 8h4l3 5v3h-7V8z"/>
                        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                      </svg>
                    )}
                    {isCurrent && idx !== 3 && <span className="ot-pcs-pulse" />}
                  </div>
                  {!isLast && <div className={`ot-pcs-line${isDone ? ' done' : ''}`} />}
                </div>
                <div className="ot-pcs-text">
                  <span className="ot-pcs-label">{label}</span>
                  {(isDone || isCurrent) && stamp
                    ? <span className="ot-pcs-time">{fmtShort(stamp)} - {fmtTime(stamp)}</span>
                    : <span className="ot-pcs-dash">—</span>
                  }
                </div>
              </div>
            );
          })}
        </div>

      </div>

      <ProductStatusPanel shipment={shipment} />
    </div>
  );
}

// ── Product Status Panel ───────────────────────────────────────────────────────

function ProductStatusPanel({ shipment }: { shipment: Shipment | null }) {
  if (!shipment) return null;
  const s = shipment.status;

  if (s === 'delivered') return (
    <div className="ot-pc-status ot-pc-status--green">
      <svg width="15" height="15" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7"/>
      </svg>
      <span className="ot-pc-status-msg">تم تسليم المنتج بنجاح.</span>
    </div>
  );

  if (s === 'picked_up') return (
    <div className="ot-pc-status ot-pc-status--blue">
      <svg width="15" height="15" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 5v3h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
      <span className="ot-pc-status-msg">السائق في الطريق إلى موقعك.</span>
    </div>
  );

  if (s === 'stranded') return (
    <div className="ot-pc-status ot-pc-status--red">
      <svg width="15" height="15" fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div>
        <div className="ot-pc-status-msg">نواجه مشكلة مؤقتة في عملية التوصيل.</div>
        <div className="ot-pc-status-sub">يعمل فريقنا على حل المشكلة وسيتم تحديث الحالة قريباً.</div>
      </div>
    </div>
  );

  if (s === 'delayed') return (
    <div className="ot-pc-status ot-pc-status--orange">
      <svg width="15" height="15" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div>
        <div className="ot-pc-status-msg">يوجد تأخير بسيط في جدولة عملية التوصيل.</div>
        <div className="ot-pc-status-sub">سيتم تحديث الحالة تلقائياً قريباً.</div>
      </div>
    </div>
  );

  if (s === 'reserved') return (
    <div className="ot-pc-status ot-pc-status--blue">
      <svg width="15" height="15" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
      <span className="ot-pc-status-msg">تم تخصيص سائق لاستلام المنتج قريباً.</span>
    </div>
  );

  if (s === 'batched') return (
    <div className="ot-pc-status ot-pc-status--green">
      <svg width="15" height="15" fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <span className="ot-pc-status-msg">تم جدولة المنتج للتوصيل، بانتظار استلام السائق من المتجر.</span>
    </div>
  );

  if (s === 'available') return (
    <div className="ot-pc-status ot-pc-status--green">
      <svg width="15" height="15" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7"/>
      </svg>
      <span className="ot-pc-status-msg">المنتج جاهز للاستلام من المتجر.</span>
    </div>
  );

  if (s === 'pending') return (
    <div className="ot-pc-status ot-pc-status--blue">
      <svg width="15" height="15" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <span className="ot-pc-status-msg">يقوم المتجر حالياً بتجهيز المنتج.</span>
    </div>
  );

  return null;
}

// ── Support Footer ─────────────────────────────────────────────────────────────

function SupportFooter({ order }: { order: Order }) {
  const isCompleted = order.status === 'completed';
  return (
    <div className="ot-support-footer">
      <div className="ot-sf-left">
        <svg width="15" height="15" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>
        </svg>
        <span>هل تحتاج إلى مساعدة؟ فريق الدعم متاح على مدار الساعة</span>
      </div>
      <div className="ot-sf-actions">
        <button type="button" className="ot-sf-btn">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          تواصل معنا
        </button>
        {isCompleted && (
          <button type="button" className="ot-sf-btn">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
            </svg>
            طلب إرجاع
          </button>
        )}
      </div>
    </div>
  );
}
