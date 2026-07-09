import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import type { ShipmentStatus } from '../../../shared/status';
import { CUSTOMER_NOTIFICATION_EVENT_TYPES, type TrackingEventType } from '../../../shared/trackingEvents';
import { confirmShipmentReceived, reportShipmentDelay } from '../../lib/trackingEvents';
import { fetchBatchNumbers } from '../../lib/batchNumbers';
import { markOrderNotificationsSeen } from '../../lib/orderNotifications';
import './OrderTrackingPage.css';

// ── Types ──────────────────────────────────────────────────────────────────────

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

type EtaSource = 'sla_fallback' | 'route_estimate' | 'actual' | 'unknown';

interface Shipment {
  id: string;
  order_detail_id: number;
  status: ShipmentStatus;
  created_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  deadline: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  /** Human-readable display code, e.g. "S-100234" — see shipments.shipment_number. */
  shipment_number: string;
  /** Display code of the logistics batch this shipment is grouped into, if any. */
  batchNumber: string | null;
  /** created_at of this shipment's 'customer_confirmed' tracking event, if any. */
  confirmedAt: string | null;
}

interface OrderDetail {
  id: number;
  product_id: string | null;
  shop_id: string | null;
  qty: number | null;
  unit_price: number | null;
  ready_time: string | null;
  product: Product | null;
  shop: Shop | null;
  shipment: Shipment | null;
  /** Customer already submitted a 'customer_confirmed' event for this shipment. */
  confirmedByCustomer: boolean;
  /** Customer has an unresolved 'delay_reported' event for this shipment. */
  delayReportOpen: boolean;
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
  /** Human-readable display code, e.g. "O-100066" — see orders.order_number. */
  order_number: string;
  total_price: number | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
  shipping_address: ShippingAddress | null;
  order_details: OrderDetail[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtShort(d: Date) {
  return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' });
}

function isToday(d: Date): boolean {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

// Mirrors OrderHistoryPage.tsx's getOrderProgress() exactly, so the order-level
// timeline reads identically on both pages.
// Steps: 0=تم الطلب  1=قيد المعالجة  2=تم الاستلام  3=قيد التوصيل
// isConfirmed (step 4, "اكتمل الطلب") is tracked separately from isCompleted:
// isCompleted means every shipment is 'delivered'; isConfirmed means every
// shipment additionally has a 'customer_confirmed' tracking event — the order
// is only ever fully done once the customer has confirmed every product.
interface OrderProgress { step: number; isCompleted: boolean; isConfirmed: boolean; }

function getOrderProgress(order: Order): OrderProgress {
  const shipments = order.order_details.map(d => d.shipment).filter((s): s is Shipment => !!s);
  const shipmentStatuses = shipments.map(s => s.status);
  const isConfirmed = shipments.length > 0 && shipments.every(s => !!s.confirmedAt);

  if (shipmentStatuses.length > 0 && shipmentStatuses.every(s => s === 'delivered')) {
    return { step: 3, isCompleted: true, isConfirmed };
  }
  if (shipmentStatuses.some(s => s === 'picked_up' || s === 'delivered')) {
    return { step: 3, isCompleted: false, isConfirmed };
  }
  if (shipmentStatuses.some(s => s === 'available')) {
    return { step: 2, isCompleted: false, isConfirmed };
  }
  if (order.payment_status === 'paid') {
    return { step: 1, isCompleted: false, isConfirmed };
  }
  return { step: 0, isCompleted: false, isConfirmed };
}

function earliestShipmentDate(order: Order, statuses: ShipmentStatus[]): Date | null {
  const times = order.order_details
    .map(d => d.shipment)
    .filter((s): s is Shipment => !!s && statuses.includes(s.status))
    .map(s => new Date(s.created_at).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function latestConfirmedAt(order: Order): Date | null {
  const times = order.order_details
    .map(d => d.shipment?.confirmedAt)
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function earliestPickedUpAt(order: Order): Date | null {
  const times = order.order_details
    .map(d => d.shipment?.picked_up_at)
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function latestDeliveredAt(order: Order): Date | null {
  const times = order.order_details
    .map(d => d.shipment?.delivered_at)
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function shipmentToStep(s: ShipmentStatus | null): number {
  if (!s || s === 'pending') return 0;
  if (s === 'available' || s === 'delayed') return 1;
  if (s === 'batched' || s === 'reserved' || s === 'stranded') return 2;
  if (s === 'picked_up') return 3;
  if (s === 'delivered') return 4;
  return 0;
}

// 0–5 scale for the order completion ring: same as shipmentToStep, but a
// delivered shipment only reaches the final step (5) once the customer has
// confirmed it — matching the order-level "اكتمل الطلب" milestone.
function shipmentToStepWithConfirmation(s: Shipment | null): number {
  if (!s) return 0;
  if (s.status === 'delivered') return s.confirmedAt ? 5 : 4;
  return shipmentToStep(s.status);
}

// Every product/shipment in the order counts equally, regardless of price or
// quantity: percent = sum(product steps) / (5 * number of products) * 100.
function getOrderCompletionPercent(order: Order): number {
  const details = order.order_details;
  if (details.length === 0) return 0;
  const sumSteps = details.reduce((sum, d) => sum + shipmentToStepWithConfirmation(d.shipment), 0);
  return Math.round((sumSteps / (5 * details.length)) * 100);
}

// Single shared ETA pipeline — the banner, sidebar, and product cards all read
// through these so they can never show contradictory times for the same order.
// estimated_delivery_at / eta_source come from the server's per-shipment ETA
// (server/logistics/eta.ts): 'route_estimate' is a real road-distance-based
// prediction, 'sla_fallback' is the flat deadline ceiling used until real route
// data exists, 'actual' is the real delivered_at, 'unknown' means no reliable
// estimate exists (e.g. a stranded shipment) — never fabricate one for those.

interface EtaRollup { earliest: Date; latest: Date; source: EtaSource; isMultiShipment: boolean; }

// Order-level rollup: earliest–latest estimated_delivery_at across this
// order's non-delivered shipments. Skips shipments with no reliable estimate
// (eta_source 'unknown'). If any contributing shipment is still on the flat
// SLA fallback, the whole rollup is labeled 'sla_fallback' too — never
// overstate confidence.
function orderEtaRollup(order: Order): EtaRollup | null {
  const shipments = order.order_details
    .map(d => d.shipment)
    .filter((s): s is Shipment => !!s && s.status !== 'delivered');

  const withEta = shipments
    .filter(s => !!s.estimated_delivery_at)
    .map(s => ({ time: new Date(s.estimated_delivery_at as string), source: s.eta_source }));
  if (withEta.length === 0) return null;

  const times = withEta.map(e => e.time.getTime());
  const earliest = new Date(Math.min(...times));
  const latest = new Date(Math.max(...times));
  const source: EtaSource = withEta.some(e => e.source !== 'route_estimate' && e.source !== 'actual')
    ? 'sla_fallback' : 'route_estimate';
  const isMultiShipment = new Set(shipments.map(s => s.id)).size > 1;
  return { earliest, latest, source, isMultiShipment };
}

// Turns a rollup into the one Arabic label used everywhere (banner, sidebar).
function formatEtaLabel(rollup: EtaRollup | null): { label: string; time: string; note: string } {
  if (!rollup) {
    return {
      label: 'موعد التوصيل',
      time: 'سيتم تحديد موعد التوصيل قريباً',
      note: 'سيتم إشعارك عند تحديد الموعد',
    };
  }

  const isRange = rollup.latest.getTime() !== rollup.earliest.getTime();
  const note = rollup.isMultiShipment ? 'قد يصل طلبك على أكثر من دفعة' : 'سيتم تحديث الوقت تلقائياً';

  if (rollup.source === 'sla_fallback') {
    const prefix = isToday(rollup.latest) ? 'اليوم' : fmtShort(rollup.latest);
    return {
      label: 'موعد التوصيل المتوقع',
      time: `بحلول ${prefix} الساعة ${fmtTime(rollup.latest)}`,
      note,
    };
  }

  const prefix = isToday(rollup.earliest) ? 'اليوم' : fmtShort(rollup.earliest);
  return {
    label: 'الوصول المتوقع',
    time: isRange
      ? `${prefix} من ${fmtTime(rollup.earliest)} إلى ${fmtTime(rollup.latest)}`
      : `${prefix} الساعة ${fmtTime(rollup.earliest)}`,
    note,
  };
}

// Per-shipment ETA line (product cards). Never fabricates a time for a
// stranded shipment, and stays silent once delivered (the timeline already
// shows the real delivered_at there).
function shipmentEtaLabel(shipment: Shipment): string | null {
  if (shipment.status === 'stranded' || shipment.status === 'delivered') return null;
  if (!shipment.estimated_delivery_at) return null;
  const d = new Date(shipment.estimated_delivery_at);
  const prefix = isToday(d) ? 'اليوم' : fmtShort(d);
  return shipment.eta_source === 'route_estimate'
    ? `التوصيل المتوقع ${prefix} الساعة ${fmtTime(d)}`
    : `التوصيل المتوقع بحلول ${prefix} الساعة ${fmtTime(d)}`;
}

// Human-readable "منذ" elapsed time, used by AlertPanel's real "آخر تحديث" signal.
function elapsedLabel(from: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - from.getTime()) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  return `قبل ${hours} ساعة`;
}

// Same labels/order as OrderHistoryPage.tsx's STEPS — the two timelines must match.
const ORDER_STEPS = ['تم الطلب', 'قيد المعالجة', 'تم الاستلام', 'قيد التوصيل', 'اكتمل الطلب'];
const PRODUCT_STEPS = ['تم الطلب', 'جاهز للاستلام', 'في انتظار الاستلام', 'قيد التوصيل', 'تم التسليم'];

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate    = useNavigate();
  const { customer, isLoading: authLoading } = useCustomerAuth();

  const [order, setOrder]     = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [newUpdates, setNewUpdates] = useState<{ event_type: TrackingEventType; note: string | null }[]>([]);

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
          .select('id, order_number, total_price, status, payment_status, created_at, shipping_address')
          .eq('id', orderId).eq('user_id', customer!.id).single();
        if (oe || !od) throw oe ?? new Error('الطلب غير موجود');

        const { data: dd, error: de } = await supabase
          .from('order_details').select('id, order_id, product_id, shop_id, qty, unit_price, ready_time')
          .eq('order_id', od.id);
        if (de) throw de;

        const details   = (dd ?? []) as any[];
        const detailIds = details.map(d => d.id as number);
        const prodIds   = [...new Set(details.map(d => d.product_id as string | null).filter(Boolean))] as string[];
        const shopIds   = [...new Set(details.map(d => d.shop_id    as string | null).filter(Boolean))] as string[];

        const [pr, sr, shr, tr] = await Promise.all([
          prodIds.length ? supabase.from('products').select('id,title,image_urls,price').in('id', prodIds) : Promise.resolve({ data: [] as any[] }),
          shopIds.length ? supabase.from('shops').select('shop_id,name').in('shop_id', shopIds)             : Promise.resolve({ data: [] as any[] }),
          detailIds.length ? supabase.from('shipments').select('id,order_detail_id,status,created_at,picked_up_at,delivered_at,deadline,estimated_delivery_at,eta_source,shipment_number,batch_id').in('order_detail_id', detailIds) : Promise.resolve({ data: [] as any[] }),
          supabase.from('order_tracking_events').select('shipment_id,event_type,requires_review,note,customer_seen_at,created_at').eq('order_id', od.id),
        ]);

        const pm = new Map<string, Product>(); (pr.data ?? []).forEach((p: Product) => pm.set(p.id, p));
        const sm = new Map<string, Shop>();    (sr.data ?? []).forEach((s: any)     => sm.set(s.shop_id, s));

        // shipment_id → flags/timestamps, derived from this order's tracking-event log.
        const confirmedShipments  = new Set<string>();
        const openDelayShipments  = new Set<string>();
        const confirmedAtByShipment = new Map<string, string>();
        (tr.data ?? []).forEach((e: any) => {
          if (!e.shipment_id) return;
          if (e.event_type === 'customer_confirmed') {
            confirmedShipments.add(e.shipment_id);
            confirmedAtByShipment.set(e.shipment_id, e.created_at);
          }
          if (e.event_type === 'delay_reported' && e.requires_review) openDelayShipments.add(e.shipment_id);
        });

        // Batch display codes for shipments already grouped into a logistics
        // batch — see fetchBatchNumbers() for why this goes through the server.
        const shipmentIdsWithBatch = (shr.data ?? [])
          .filter((s: any) => s.batch_id)
          .map((s: any) => s.id as string);
        const batchNumberByShipment = await fetchBatchNumbers(shipmentIdsWithBatch);

        const hm = new Map<number, Shipment>();
        (shr.data ?? []).forEach((s: any) => hm.set(s.order_detail_id as number, {
          ...s,
          batchNumber: batchNumberByShipment[s.id] ?? null,
          confirmedAt: confirmedAtByShipment.get(s.id) ?? null,
        }));

        const merged: Order = {
          id: od.id, order_number: od.order_number, total_price: od.total_price, status: od.status,
          payment_status: od.payment_status, created_at: od.created_at,
          shipping_address: (od as any).shipping_address ?? null,
          order_details: details.map(d => {
            const shipment = hm.get(d.id) ?? null;
            return {
              id: d.id, product_id: d.product_id, shop_id: d.shop_id,
              qty: d.qty, unit_price: d.unit_price, ready_time: d.ready_time ?? null,
              product:  d.product_id ? (pm.get(d.product_id) ?? null) : null,
              shop:     d.shop_id    ? (sm.get(d.shop_id)    ?? null) : null,
              shipment,
              confirmedByCustomer: shipment ? confirmedShipments.has(shipment.id) : false,
              delayReportOpen:     shipment ? openDelayShipments.has(shipment.id) : false,
            };
          }),
        };

        // Unread customer-facing notifications (driver delivered / admin
        // resolved a delay report / etc.) — captured before marking them
        // seen, so this page render still shows the banner once.
        const unseen = (tr.data ?? []).filter((e: any) =>
          CUSTOMER_NOTIFICATION_EVENT_TYPES.includes(e.event_type) && !e.customer_seen_at
        );

        if (!cancelled) {
          setOrder(merged);
          setNewUpdates(unseen.map((e: any) => ({ event_type: e.event_type, note: e.note ?? null })));
        }
        if (unseen.length > 0) void markOrderNotificationsSeen(od.id);
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

  const progress    = getOrderProgress(order);
  const hasStranded = order.order_details.some(d => d.shipment?.status === 'stranded');

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

        {/* New tracking updates since last visit */}
        {newUpdates.length > 0 && <NewUpdatesBanner updates={newUpdates} />}

        {/* S2: Header card */}
        <div className="ot-header-card">
          <div className="ot-hc-right">
            <div className="ot-hc-order-num">{order.order_number}</div>
            <div>
              <div className="ot-hc-date-label">تم إنشاء الطلب</div>
              <div className="ot-hc-date-val">{fmtDate(new Date(order.created_at))} - {fmtTime(new Date(order.created_at))}</div>
            </div>
            <StatusBadge status={order.status ?? 'pending'} />
          </div>
          <HeaderDeliveryBanner order={order} />
        </div>

        {/* Multi-shipment notice — only when products span >1 merchant/shipment */}
        <MultiShipmentNotice order={order} />

        {/* S3: Timeline card */}
        <div className="ot-tl-card">
          <div className="ot-tlc-title">حالة الطلب العامة</div>
          <OrderTimeline progress={progress} order={order} />
          <AlertPanel order={order} hasStranded={hasStranded} />
        </div>

        {/* S4+S5: Two-column grid */}
        <div className="ot-main-grid">
          {/* Sidebar (right) */}
          <aside className="ot-sidebar">
            <DeliveryInfoCard order={order} />
            <SummaryCard order={order} />
          </aside>

          {/* Products (left) */}
          <ProductsSection order={order} navigate={navigate} />
        </div>

      </div>
    </>
  );
}

// ── New Updates Banner ──────────────────────────────────────────────────────────

const UPDATE_MESSAGES: Record<string, { title: string; msg: string }> = {
  driver_delivered: { title: 'تم تسليم طلبك', msg: 'تم تسليم منتجاتك بنجاح.' },
  admin_resolved:   { title: 'تم حل بلاغ التأخير', msg: 'قامت الإدارة بمراجعة البلاغ ومعالجة المشكلة.' },
  customer_confirmed: { title: 'تم تأكيد الاستلام', msg: 'تم تسجيل تأكيدك لاستلام المنتج.' },
};

function NewUpdatesBanner({ updates }: { updates: { event_type: TrackingEventType; note: string | null }[] }) {
  const seen = new Set<string>();
  const unique = updates.filter(u => {
    if (seen.has(u.event_type)) return false;
    seen.add(u.event_type);
    return true;
  });

  return (
    <div className="ot-updates-banner">
      {unique.map(u => {
        const cfg = UPDATE_MESSAGES[u.event_type];
        if (!cfg) return null;
        return (
          <div key={u.event_type} className="ot-updates-banner-item">
            <div className="ot-updates-banner-title">{cfg.title}</div>
            <div className="ot-updates-banner-msg">{cfg.msg}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Multi-Shipment Notice ────────────────────────────────────────────────────────
// Purely informational — never tied to status. Shown whenever the order's
// products span more than one merchant or more than one shipment, so the
// customer isn't confused when items arrive separately.

function MultiShipmentNotice({ order }: { order: Order }) {
  const shopIds     = new Set(order.order_details.map(d => d.shop_id).filter(Boolean));
  const shipmentIds = new Set(order.order_details.map(d => d.shipment?.id).filter(Boolean));
  const isMultiShipment = shopIds.size > 1 || shipmentIds.size > 1;
  if (!isMultiShipment) return null;

  return (
    <div className="ot-multi-shipment-card">
      <div className="ot-msc-icon">📦</div>
      <div className="ot-msc-text">
        <div className="ot-msc-title">سيصل طلبك على عدة دفعات</div>
        <div className="ot-msc-desc">
          قد يتم توصيل منتجات هذا الطلب بشكل منفصل وفقاً لتوفر المنتجات وخطة التوصيل. سيتم تحديث حالة كل منتج بشكل مستقل حتى اكتمال الطلب بالكامل.
        </div>
        <div className="ot-msc-note">يمكنك متابعة حالة كل منتج من خلال الجدول الزمني أدناه.</div>
      </div>
    </div>
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

// ── Completion Ring ────────────────────────────────────────────────────────────
// Order-wide completion %, averaged equally across every product/shipment —
// see getOrderCompletionPercent() above.

function CompletionRing({ percent }: { percent: number }) {
  const size   = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <svg className="ot-ring-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#DCFCE7" strokeWidth={stroke} />
      <circle
        className="ot-ring-progress"
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="#15803D" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="800" fill="#15803D">
        {percent}%
      </text>
    </svg>
  );
}

// ── Header Delivery Banner ─────────────────────────────────────────────────────

function HeaderDeliveryBanner({ order }: { order: Order }) {
  const isCompleted = order.status === 'completed';
  const deliveredAt = order.order_details.find(d => d.shipment?.delivered_at)?.shipment?.delivered_at ?? null;

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

  const rollup = orderEtaRollup(order);
  const eta = formatEtaLabel(rollup);

  if (!rollup) return (
    <div className="ot-hc-left ot-hc-left--success">
      <svg className="ot-hcl-clock" width="22" height="22" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">{eta.label}</div>
        <div className="ot-hcd-time ot-hcd-time--success">{eta.time}</div>
        <div className="ot-hcd-note">{eta.note}</div>
      </div>
    </div>
  );

  return (
    <div className="ot-hc-left">
      <svg className="ot-hcl-clock" width="22" height="22" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">{eta.label}</div>
        <div className="ot-hcd-time">{eta.time}</div>
        <div className="ot-hcd-note">{eta.note}</div>
      </div>
      <CompletionRing percent={getOrderCompletionPercent(order)} />
    </div>
  );
}

// ── Order Timeline ─────────────────────────────────────────────────────────────

// Mirrors OrderHistoryPage.tsx's getStepTimestamps() exactly.
function getOrderTimestamps(order: Order): (Date | null)[] {
  const base = new Date(order.created_at);
  return [
    base,                                                                  // تم الطلب
    order.payment_status === 'paid' ? base : null,                        // قيد المعالجة
    earliestShipmentDate(order, ['available', 'picked_up', 'delivered']),  // تم الاستلام
    earliestPickedUpAt(order) ?? latestDeliveredAt(order),                 // قيد التوصيل
    latestConfirmedAt(order),                                              // اكتمل الطلب
  ];
}

function OrderTimeline({ progress, order }: { progress: OrderProgress; order: Order }) {
  const ts = getOrderTimestamps(order);
  return (
    <div className="ot-tl-wrap">
      <div className="ot-tl-track-row">
        <div className="ot-tl-track-bg" />
        <div className="ot-tl-track-fill" data-step={progress.isConfirmed ? 4 : progress.step} />
      </div>
      <div className="ot-tl-steps">
        {ORDER_STEPS.map((label, idx) => {
          const isDeliverStep = idx === 3;
          const isFinalStep   = idx === 4;
          const isDone    = isFinalStep ? progress.isConfirmed : (progress.isCompleted || idx < progress.step);
          const isCurrent = isFinalStep ? (progress.isCompleted && !progress.isConfirmed) : (!progress.isCompleted && idx === progress.step);
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
                {isCurrent && isDeliverStep && (
                  <svg width="16" height="16" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="1" y="3" width="15" height="13" rx="1"/>
                    <path d="M16 8h4l3 5v3h-7V8z"/>
                    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                  </svg>
                )}
                {isCurrent && !isDeliverStep && <span className="ot-tl-pulse" />}
              </div>
              <div className="ot-tl-info">
                <span className="ot-tl-label">{label}</span>
                {isCurrent && isDeliverStep ? (
                  <span className="ot-tl-sub">جاري التوصيل</span>
                ) : isCurrent && isFinalStep ? (
                  <span className="ot-tl-sub">في انتظار تأكيدك</span>
                ) : (isDone || isCurrent) && stamp ? (
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
  if (order.status === 'delivering') {
    const pickedUpAt = earliestPickedUpAt(order);
    return (
      <div className="ot-alert ot-alert--blue">
        <svg width="18" height="18" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        <div>
          <div className="ot-alert-title">السائق في الطريق إلى موقعك</div>
          {pickedUpAt && <div className="ot-alert-sub">آخر تحديث: {elapsedLabel(pickedUpAt)}</div>}
        </div>
      </div>
    );
  }
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

// Driver name/phone are deliberately not shown here — there's no data path
// today for exposing courier contact details to a customer. Faking them was
// the bug; surfacing real courier contact is a separate future feature.
function DeliveryInfoCard({ order }: { order: Order }) {
  const addr = order.shipping_address;
  const addressLines = addr
    ? [
        [addr.address, addr.apartment].filter(Boolean).join('، '),
        addr.city ?? '',
      ].filter(Boolean)
    : [];

  const eta = formatEtaLabel(orderEtaRollup(order));

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
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
            label: eta.label,
            val: eta.time,
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
            label: 'عنوان التسليم',
            val: addressLines.length ? addressLines.join('\n') : '—',
            multiline: true,
          },
        ].map(row => (
          <div key={row.label} className="ot-sb-row">
            <span className="ot-sb-icon">{row.icon}</span>
            <div>
              <div className="ot-sb-row-label">{row.label}</div>
              {row.multiline
                ? <div className="ot-sb-row-val">{row.val.split('\n').map((l, i) => <span key={i}>{l}{i === 0 && row.val.split('\n').length > 1 && <br />}</span>)}</div>
                : <div className="ot-sb-row-val">{row.val}</div>
              }
            </div>
          </div>
        ))}
      </div>
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
    detail.ready_time ? new Date(detail.ready_time) : null,          // 1: جاهز للاستلام
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
            {shipment && (
              <div className="ot-pc-shipment-num">
                رقم الشحنة: {shipment.shipment_number}
                {shipment.batchNumber && <> · رقم التجميعة: {shipment.batchNumber}</>}
              </div>
            )}
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
      <ProductEtaLine shipment={shipment} />
      <DeliveryFeedbackActions detail={detail} />
    </div>
  );
}

// ── Delivery Feedback Actions (confirm received / report delay) ────────────────

function DeliveryFeedbackActions({ detail }: { detail: OrderDetail }) {
  const shipment = detail.shipment;
  const [confirmed, setConfirmed]     = useState(detail.confirmedByCustomer);
  const [delayOpen, setDelayOpen]     = useState(detail.delayReportOpen);
  const [showDelayForm, setShowDelayForm] = useState(false);
  const [delayNote, setDelayNote]     = useState('');
  const [busy, setBusy]               = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!shipment) return null;

  const isDelivered    = shipment.status === 'delivered';
  const deadlinePassed = !!shipment.deadline && new Date() > new Date(shipment.deadline);
  const canConfirm      = isDelivered && !confirmed;
  const canReportDelay  = !isDelivered && deadlinePassed && !delayOpen;

  if (!canConfirm && !canReportDelay && !confirmed && !delayOpen) return null;

  async function handleConfirm() {
    setBusy(true); setActionError(null);
    const res = await confirmShipmentReceived(shipment!.id);
    setBusy(false);
    if (!res.ok) { setActionError(res.error ?? 'حدث خطأ، حاول مرة أخرى'); return; }
    setConfirmed(true);
  }

  async function handleReportDelay() {
    if (!delayNote.trim()) { setActionError('الرجاء كتابة وصف للمشكلة'); return; }
    setBusy(true); setActionError(null);
    const res = await reportShipmentDelay(shipment!.id, delayNote.trim());
    setBusy(false);
    if (!res.ok) { setActionError(res.error ?? 'حدث خطأ، حاول مرة أخرى'); return; }
    setDelayOpen(true);
    setShowDelayForm(false);
  }

  return (
    <div className="ot-pc-feedback">
      {confirmed && <div className="ot-pc-feedback-msg ot-pc-feedback-msg--success">✓ أكّدت استلام هذا المنتج</div>}
      {delayOpen && <div className="ot-pc-feedback-msg ot-pc-feedback-msg--pending">تم إرسال بلاغك، سيتواصل معك فريق الدعم قريباً</div>}
      {actionError && <div className="ot-pc-feedback-error">{actionError}</div>}

      {(canConfirm || (canReportDelay && !showDelayForm)) && (
        <div className="ot-pc-feedback-actions">
          {canConfirm && (
            <button type="button" className="ot-pc-feedback-btn ot-pc-feedback-btn--confirm" disabled={busy} onClick={handleConfirm}>
              تأكيد الاستلام
            </button>
          )}
          {canReportDelay && (
            <button type="button" className="ot-pc-feedback-btn ot-pc-feedback-btn--delay" disabled={busy} onClick={() => setShowDelayForm(true)}>
              الإبلاغ عن تأخير الطلب
            </button>
          )}
        </div>
      )}

      {canReportDelay && showDelayForm && (
        <div className="ot-pc-delay-form">
          <textarea
            value={delayNote}
            onChange={e => setDelayNote(e.target.value)}
            placeholder="صف المشكلة..."
            rows={2}
          />
          <div className="ot-pc-delay-form-actions">
            <button type="button" disabled={busy} onClick={handleReportDelay}>إرسال البلاغ</button>
            <button type="button" disabled={busy} onClick={() => { setShowDelayForm(false); setActionError(null); }}>إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product ETA Line ───────────────────────────────────────────────────────────

function ProductEtaLine({ shipment }: { shipment: Shipment | null }) {
  if (!shipment) return null;
  const label = shipmentEtaLabel(shipment);
  if (!label) return null;
  return <div className="ot-pc-eta">{label}</div>;
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

