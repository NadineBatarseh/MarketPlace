import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import type { ShipmentStatus } from '../../../shared/status';
import { CUSTOMER_NOTIFICATION_EVENT_TYPES, type TrackingEventType } from '../../../shared/trackingEvents';
import { confirmShipmentReceived, reportShipmentDelay } from '../../lib/trackingEvents';
import { markOrderNotificationsSeen } from '../../lib/orderNotifications';
import i18n from '../../i18n/config';
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

interface Shipment {
  id: string;
  order_detail_id: number;
  status: ShipmentStatus;
  created_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  deadline: string | null;
  confirmedAt: string | null;
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
  confirmedByCustomer: boolean;
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
  total_price: number | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
  shipping_address: ShippingAddress | null;
  order_details: OrderDetail[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function dateLocale() {
  return i18n.language === 'ar' ? 'ar-EG' : 'en-US';
}

function formatOrderId(id: number) { return `#SQ-${String(id).padStart(5, '0')}`; }

function fmtDate(d: Date) {
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtShort(d: Date) {
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' });
}

function addH(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

function isToday(d: Date): boolean {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

// ── Order Progress ─────────────────────────────────────────────────────────────

interface OrderProgress { step: number; isCompleted: boolean; isConfirmed: boolean; }

function getOrderProgress(order: Order): OrderProgress {
  const shipments = order.order_details.map(d => d.shipment).filter((s): s is Shipment => !!s);
  const shipmentStatuses = shipments.map(s => s.status);
  const isConfirmed = shipments.length > 0 && shipments.every(s => !!s.confirmedAt);

  if (shipmentStatuses.length > 0 && shipmentStatuses.every(s => s === 'delivered')) return { step: 3, isCompleted: true, isConfirmed };
  if (shipmentStatuses.some(s => s === 'picked_up' || s === 'delivered')) return { step: 3, isCompleted: false, isConfirmed };
  if (shipmentStatuses.some(s => s === 'available')) return { step: 2, isCompleted: false, isConfirmed };
  if (order.payment_status === 'paid') return { step: 1, isCompleted: false, isConfirmed };
  return { step: 0, isCompleted: false, isConfirmed };
}

function earliestShipmentDate(order: Order, statuses: ShipmentStatus[]): Date | null {
  const times = order.order_details.map(d => d.shipment).filter((s): s is Shipment => !!s && statuses.includes(s.status)).map(s => new Date(s.created_at).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function latestConfirmedAt(order: Order): Date | null {
  const times = order.order_details.map(d => d.shipment?.confirmedAt).filter((t): t is string => !!t).map(t => new Date(t).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function earliestPickedUpAt(order: Order): Date | null {
  const times = order.order_details.map(d => d.shipment?.picked_up_at).filter((t): t is string => !!t).map(t => new Date(t).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function latestDeliveredAt(order: Order): Date | null {
  const times = order.order_details.map(d => d.shipment?.delivered_at).filter((t): t is string => !!t).map(t => new Date(t).getTime());
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

function shipmentToStepWithConfirmation(s: Shipment | null): number {
  if (!s) return 0;
  if (s.status === 'delivered') return s.confirmedAt ? 5 : 4;
  return shipmentToStep(s.status);
}

function getOrderCompletionPercent(order: Order): number {
  const details = order.order_details;
  if (details.length === 0) return 0;
  const sumSteps = details.reduce((sum, d) => sum + shipmentToStepWithConfirmation(d.shipment), 0);
  return Math.round((sumSteps / (5 * details.length)) * 100);
}

interface DeadlineEstimate { earliest: Date; isMultiShipment: boolean; }

function getDeadlineEstimate(order: Order): DeadlineEstimate | null {
  const shipments = order.order_details.map(d => d.shipment).filter((s): s is Shipment => !!s);
  const deadlines = shipments.map(s => s.deadline).filter((d): d is string => !!d).map(d => new Date(d));
  if (deadlines.length === 0) return null;
  const earliest = new Date(Math.min(...deadlines.map(d => d.getTime())));
  const isMultiShipment = new Set(shipments.map(s => s.id)).size > 1;
  return { earliest, isMultiShipment };
}

function getDeliveryWindow(order: Order, t: TFunc): { prefix: string; time: string } {
  const base = new Date(order.created_at);
  let start: Date;
  if (order.status === 'delivering') start = addH(new Date(), 2);
  else if (order.status === 'pending') start = addH(base, 26);
  else start = addH(base, 50);
  const end = addH(start, 2);
  const between = t('tracking.time.between');
  const prefix = isToday(start)
    ? `${t('tracking.time.today')} ${between}`
    : `${fmtShort(start)} ${between}`;
  return { prefix, time: `${fmtTime(start)} - ${fmtTime(end)}` };
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const { t } = useTranslation('orders');
  const { direction } = useLanguage();
  const { orderId } = useParams<{ orderId: string }>();
  const navigate     = useNavigate();
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
          .select('id, total_price, status, payment_status, created_at')
          .eq('id', orderId).eq('user_id', customer!.id).single();
        if (oe || !od) throw oe ?? new Error(t('tracking.orderNotFound'));

        const { data: dd, error: de } = await supabase
          .from('order_details').select('id, order_id, product_id, shop_id, qty, unit_price')
          .eq('order_id', od.id);
        if (de) throw de;

        const details   = (dd ?? []) as any[];
        const detailIds = details.map(d => d.id as number);
        const prodIds   = [...new Set(details.map(d => d.product_id as string | null).filter(Boolean))] as string[];
        const shopIds   = [...new Set(details.map(d => d.shop_id    as string | null).filter(Boolean))] as string[];

        const [pr, sr, shr, tr] = await Promise.all([
          prodIds.length ? supabase.from('products').select('id,title,image_urls,price').in('id', prodIds) : Promise.resolve({ data: [] as any[] }),
          shopIds.length ? supabase.from('shops').select('shop_id,name').in('shop_id', shopIds)             : Promise.resolve({ data: [] as any[] }),
          detailIds.length ? supabase.from('shipments').select('id,order_detail_id,status,created_at,picked_up_at,delivered_at,deadline').in('order_detail_id', detailIds) : Promise.resolve({ data: [] as any[] }),
          supabase.from('order_tracking_events').select('shipment_id,event_type,requires_review,note,customer_seen_at,created_at').eq('order_id', od.id),
        ]);

        const pm = new Map<string, Product>(); (pr.data ?? []).forEach((p: Product) => pm.set(p.id, p));
        const sm = new Map<string, Shop>();    (sr.data ?? []).forEach((s: any)     => sm.set(s.shop_id, s));

        const confirmedShipments    = new Set<string>();
        const openDelayShipments    = new Set<string>();
        const confirmedAtByShipment = new Map<string, string>();
        (tr.data ?? []).forEach((e: any) => {
          if (!e.shipment_id) return;
          if (e.event_type === 'customer_confirmed') {
            confirmedShipments.add(e.shipment_id);
            confirmedAtByShipment.set(e.shipment_id, e.created_at);
          }
          if (e.event_type === 'delay_reported' && e.requires_review) openDelayShipments.add(e.shipment_id);
        });

        const hm = new Map<number, Shipment>();
        (shr.data ?? []).forEach((s: any) => hm.set(s.order_detail_id as number, {
          ...s,
          confirmedAt: confirmedAtByShipment.get(s.id) ?? null,
        }));

        const merged: Order = {
          id: od.id, total_price: od.total_price, status: od.status,
          payment_status: od.payment_status, created_at: od.created_at,
          shipping_address: null,
          order_details: details.map(d => {
            const shipment = hm.get(d.id) ?? null;
            return {
              id: d.id, product_id: d.product_id, shop_id: d.shop_id,
              qty: d.qty, unit_price: d.unit_price,
              product:  d.product_id ? (pm.get(d.product_id) ?? null) : null,
              shop:     d.shop_id    ? (sm.get(d.shop_id)    ?? null) : null,
              shipment,
              confirmedByCustomer: shipment ? confirmedShipments.has(shipment.id) : false,
              delayReportOpen:     shipment ? openDelayShipments.has(shipment.id) : false,
            };
          }),
        };

        const unseen = (tr.data ?? []).filter((e: any) =>
          CUSTOMER_NOTIFICATION_EVENT_TYPES.includes(e.event_type) && !e.customer_seen_at
        );

        if (!cancelled) {
          setOrder(merged);
          setNewUpdates(unseen.map((e: any) => ({ event_type: e.event_type, note: e.note ?? null })));
        }
        if (unseen.length > 0) void markOrderNotificationsSeen(od.id);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('tracking.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [customer, orderId]);

  if (authLoading || loading) return (
    <><Topbar /><StoreNav />
      <div className="ot-page" dir={direction}>
        <div className="ot-loading"><div className="ot-spinner" /><span>{t('tracking.loading')}</span></div>
      </div>
    </>
  );

  if (error || !order) return (
    <><Topbar /><StoreNav />
      <div className="ot-page" dir={direction}>
        <div className="ot-empty-state">
          <div className="ot-empty-icon">
            <svg width="52" height="52" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <h3>{t('tracking.notFound.title')}</h3>
          <p>{error ?? t('tracking.notFound.defaultMsg')}</p>
          <button type="button" className="ot-btn ot-btn--primary" onClick={() => navigate('/orders')}>
            {t('tracking.notFound.backToOrders')}
          </button>
        </div>
      </div>
    </>
  );

  const progress    = getOrderProgress(order);
  const hasStranded = order.order_details.some(d => d.shipment?.status === 'stranded');
  const delivery    = getDeliveryWindow(order, t);

  return (
    <><Topbar /><StoreNav />
      <div className="ot-page" dir={direction}>

        <div className="ot-back-wrap">
          <button type="button" className="ot-back-btn" onClick={() => navigate('/orders')}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            {t('tracking.back')}
          </button>
        </div>

        {newUpdates.length > 0 && <NewUpdatesBanner updates={newUpdates} />}

        <div className="ot-header-card">
          <div className="ot-hc-right">
            <div className="ot-hc-order-num">{formatOrderId(order.id)}</div>
            <div>
              <div className="ot-hc-date-label">{t('tracking.header.created')}</div>
              <div className="ot-hc-date-val">{fmtDate(new Date(order.created_at))} - {fmtTime(new Date(order.created_at))}</div>
            </div>
            <StatusBadge status={order.status ?? 'pending'} />
          </div>
          <HeaderDeliveryBanner order={order} />
        </div>

        <MultiShipmentNotice order={order} />

        <div className="ot-tl-card">
          <div className="ot-tlc-title">{t('tracking.timeline.title')}</div>
          <OrderTimeline progress={progress} order={order} />
          <AlertPanel order={order} hasStranded={hasStranded} />
        </div>

        <div className="ot-main-grid">
          <aside className="ot-sidebar">
            <DeliveryInfoCard order={order} delivery={delivery} />
            <SummaryCard order={order} />
          </aside>
          <ProductsSection order={order} navigate={navigate} />
        </div>

      </div>
    </>
  );
}

// ── New Updates Banner ──────────────────────────────────────────────────────────

function NewUpdatesBanner({ updates }: { updates: { event_type: TrackingEventType; note: string | null }[] }) {
  const { t } = useTranslation('orders');

  const UPDATE_MESSAGES: Record<string, { title: string; msg: string }> = {
    driver_delivered:   { title: t('tracking.updates.driver_delivered.title'),   msg: t('tracking.updates.driver_delivered.msg')   },
    admin_resolved:     { title: t('tracking.updates.admin_resolved.title'),     msg: t('tracking.updates.admin_resolved.msg')     },
    customer_confirmed: { title: t('tracking.updates.customer_confirmed.title'), msg: t('tracking.updates.customer_confirmed.msg') },
  };

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

function MultiShipmentNotice({ order }: { order: Order }) {
  const { t } = useTranslation('orders');
  const shopIds     = new Set(order.order_details.map(d => d.shop_id).filter(Boolean));
  const shipmentIds = new Set(order.order_details.map(d => d.shipment?.id).filter(Boolean));
  if (shopIds.size <= 1 && shipmentIds.size <= 1) return null;

  return (
    <div className="ot-multi-shipment-card">
      <div className="ot-msc-icon">📦</div>
      <div className="ot-msc-text">
        <div className="ot-msc-title">{t('tracking.multiShipment.title')}</div>
        <div className="ot-msc-desc">{t('tracking.multiShipment.desc')}</div>
        <div className="ot-msc-note">{t('tracking.multiShipment.note')}</div>
      </div>
    </div>
  );
}

// ── Status Badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('orders');
  const BADGE_CFG: Record<string, { label: string; variant: string }> = {
    pending:    { label: t('tracking.status.pending'),    variant: 'blue'  },
    delivering: { label: t('tracking.status.delivering'), variant: 'blue'  },
    completed:  { label: t('tracking.status.completed'),  variant: 'green' },
    cancelled:  { label: t('tracking.status.cancelled'),  variant: 'red'   },
  };
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
  const { t } = useTranslation('orders');
  const isCompleted = order.status === 'completed';
  const deliveredAt = order.order_details.find(d => d.shipment?.delivered_at)?.shipment?.delivered_at ?? null;

  if (isCompleted) return (
    <div className="ot-hc-left ot-hc-left--success">
      <svg className="ot-hcl-clock" width="52" height="52" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="#15803D" strokeWidth="1.5"/>
        <path d="m5 12 5 5L20 7" stroke="#15803D" strokeWidth="2.5"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">{t('tracking.header.orderStatus')}</div>
        <div className="ot-hcd-time ot-hcd-time--success">{t('tracking.header.deliveredSuccess')}</div>
        {deliveredAt && (
          <div className="ot-hcd-note">{t('tracking.header.deliveredAt')} {fmtDate(new Date(deliveredAt))}</div>
        )}
      </div>
    </div>
  );

  const estimate = getDeadlineEstimate(order);

  if (!estimate) return (
    <div className="ot-hc-left ot-hc-left--success">
      <svg className="ot-hcl-clock" width="22" height="22" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">{t('tracking.header.deliveryTime')}</div>
        <div className="ot-hcd-time ot-hcd-time--success">{t('tracking.header.timeSoon')}</div>
        <div className="ot-hcd-note">{t('tracking.header.notifyWhenSet')}</div>
      </div>
    </div>
  );

  const prefix = isToday(estimate.earliest) ? t('tracking.header.today') : fmtShort(estimate.earliest);
  return (
    <div className="ot-hc-left">
      <svg className="ot-hcl-clock" width="22" height="22" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div className="ot-hc-delivery">
        <div className="ot-hcd-label">{t('tracking.header.expectedArrival')}</div>
        <div className="ot-hcd-time">{prefix} {t('tracking.header.by')} {fmtTime(estimate.earliest)}</div>
        <div className="ot-hcd-note">
          {estimate.isMultiShipment ? t('tracking.header.multiShipmentNote') : t('tracking.header.autoUpdate')}
        </div>
      </div>
      <CompletionRing percent={getOrderCompletionPercent(order)} />
    </div>
  );
}

// ── Order Timeline ─────────────────────────────────────────────────────────────

function getOrderTimestamps(order: Order): (Date | null)[] {
  const base = new Date(order.created_at);
  return [
    base,
    order.payment_status === 'paid' ? base : null,
    earliestShipmentDate(order, ['available', 'picked_up', 'delivered']),
    earliestPickedUpAt(order) ?? latestDeliveredAt(order),
    latestConfirmedAt(order),
  ];
}

function OrderTimeline({ progress, order }: { progress: OrderProgress; order: Order }) {
  const { t } = useTranslation('orders');
  const ORDER_STEPS = t('steps.order', { returnObjects: true }) as string[];
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
                  <span className="ot-tl-sub">{t('tracking.timeline.delivering')}</span>
                ) : isCurrent && isFinalStep ? (
                  <span className="ot-tl-sub">{t('tracking.timeline.awaitingConfirm')}</span>
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
  const { t } = useTranslation('orders');

  if (hasStranded) return (
    <div className="ot-alert ot-alert--red">
      <svg width="18" height="18" fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div>
        <div className="ot-alert-title">{t('tracking.alerts.stranded.title')}</div>
        <div className="ot-alert-sub">{t('tracking.alerts.stranded.sub')}</div>
      </div>
    </div>
  );

  if (order.status === 'completed') return (
    <div className="ot-alert ot-alert--green">
      <svg width="18" height="18" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7"/>
      </svg>
      <div>
        <div className="ot-alert-title">{t('tracking.alerts.completed.title')}</div>
        <div className="ot-alert-sub">{t('tracking.alerts.completed.sub')}</div>
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
        <div className="ot-alert-title">{t('tracking.alerts.delivering.title')}</div>
        <div className="ot-alert-sub">{t('tracking.alerts.delivering.sub')}</div>
      </div>
    </div>
  );

  return (
    <div className="ot-alert ot-alert--green">
      <svg width="18" height="18" fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <div>
        <div className="ot-alert-title">{t('tracking.alerts.preparing.title')}</div>
        <div className="ot-alert-sub">{t('tracking.alerts.preparing.sub')}</div>
      </div>
    </div>
  );
}

// ── Delivery Info Card ─────────────────────────────────────────────────────────

function DeliveryInfoCard({ order, delivery }: { order: Order; delivery: { prefix: string; time: string } }) {
  const { t } = useTranslation('orders');
  const isDelivering = order.status === 'delivering';

  return (
    <div className="ot-sb-card">
      <div className="ot-sb-title">
        <svg width="16" height="16" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        {t('tracking.delivery.title')}
      </div>
      <div className="ot-sb-rows">
        {[
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
            label: t('tracking.delivery.driverName'),
            val: isDelivering ? 'أحمد خالد' : '—',
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 15a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 4.21h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 11.9a16 16 0 0 0 6 6l1.27-.93a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 19.18z"/></svg>,
            label: t('tracking.delivery.driverPhone'),
            val: isDelivering ? '05*******38' : '—',
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
            label: t('tracking.delivery.arrivalTime'),
            val: `${delivery.prefix}، ${delivery.time.split(' - ')[0]}`,
          },
          {
            icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
            label: t('tracking.delivery.address'),
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
          {t('tracking.delivery.trackDriver')}
        </button>
      )}
    </div>
  );
}

// ── Order Summary Card ─────────────────────────────────────────────────────────

function SummaryCard({ order }: { order: Order }) {
  const { t } = useTranslation('orders');
  const total       = order.total_price ?? 0;
  const deliveryFee = 18;
  const count       = order.order_details.length;

  return (
    <div className="ot-sb-card">
      <div className="ot-sb-title">
        <svg width="16" height="16" fill="none" stroke="#15803D" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
        </svg>
        {t('tracking.summary.title')}
      </div>
      <div className="ot-sb-summary">
        <div className="ot-sbs-row"><span>{t('tracking.summary.itemCount')}</span><span>{count}</span></div>
        <div className="ot-sbs-row"><span>{t('tracking.summary.deliveryFee')}</span><span>₪{deliveryFee.toFixed(2)}</span></div>
        <div className="ot-sbs-row ot-sbs-row--total">
          <span className="ot-sbs-total-lbl">{t('tracking.summary.grandTotal')}</span>
          <span className="ot-sbs-total-val">₪{total.toFixed(2)}</span>
        </div>
        <div className="ot-sbs-row">
          <span>{t('tracking.summary.paymentStatus')}</span>
          <span className="ot-sbs-paid">
            <svg width="11" height="11" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="m5 12 5 5L20 7"/>
            </svg>
            {t('tracking.summary.paid')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Products Section ───────────────────────────────────────────────────────────

function ProductsSection({ order, navigate }: { order: Order; navigate: ReturnType<typeof useNavigate> }) {
  const { t } = useTranslation('orders');
  const [showAll, setShowAll] = useState(false);
  const MAX = 2;
  const all     = order.order_details;
  const visible = showAll ? all : all.slice(0, MAX);
  const hasMore = all.length > MAX;

  return (
    <div className="ot-products">
      <div className="ot-products-hd">
        <h2 className="ot-products-title">{t('tracking.products.title')}</h2>
        <span className="ot-products-count">({all.length})</span>
      </div>
      <div className="ot-product-list">
        {visible.map(detail => (
          <ProductCard key={detail.id} detail={detail} orderCreatedAt={order.created_at} navigate={navigate} />
        ))}
      </div>
      {hasMore && (
        <button type="button" className={`ot-show-all-btn${showAll ? ' ot-show-all-btn--open' : ''}`} onClick={() => setShowAll(v => !v)}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="ot-show-chevron">
            <path d="m6 9 6 6 6-6"/>
          </svg>
          {showAll ? t('tracking.products.showLess') : t('tracking.products.showAll')}
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
    base,
    s ? new Date(s.created_at) : null,
    null,
    s?.picked_up_at ? new Date(s.picked_up_at) : null,
    s?.delivered_at ? new Date(s.delivered_at) : null,
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
  const { t } = useTranslation('orders');
  const PRODUCT_STEPS = t('steps.product', { returnObjects: true }) as string[];

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
              {product?.title ?? t('tracking.products.unknown')}
            </div>
            {shop && (
              <div className="ot-pc-shop">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <path d="M9 22V12h6v10"/>
                </svg>
                {t('tracking.products.store')} {shop.name}
              </div>
            )}
            <span className="ot-pc-qty-badge">{qty} {t('tracking.products.unit')}</span>
            <div className="ot-pc-price">₪{(price * qty).toFixed(2)}</div>
          </div>
        </div>

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
      <DeliveryFeedbackActions detail={detail} />
    </div>
  );
}

// ── Delivery Feedback Actions ──────────────────────────────────────────────────

function DeliveryFeedbackActions({ detail }: { detail: OrderDetail }) {
  const { t } = useTranslation('orders');
  const shipment = detail.shipment;
  const [confirmed, setConfirmed]         = useState(detail.confirmedByCustomer);
  const [delayOpen, setDelayOpen]         = useState(detail.delayReportOpen);
  const [showDelayForm, setShowDelayForm] = useState(false);
  const [delayNote, setDelayNote]         = useState('');
  const [busy, setBusy]                   = useState(false);
  const [actionError, setActionError]     = useState<string | null>(null);

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
    if (!res.ok) { setActionError(res.error ?? t('tracking.feedback.error')); return; }
    setConfirmed(true);
  }

  async function handleReportDelay() {
    if (!delayNote.trim()) { setActionError(t('tracking.feedback.writeDesc')); return; }
    setBusy(true); setActionError(null);
    const res = await reportShipmentDelay(shipment!.id, delayNote.trim());
    setBusy(false);
    if (!res.ok) { setActionError(res.error ?? t('tracking.feedback.error')); return; }
    setDelayOpen(true);
    setShowDelayForm(false);
  }

  return (
    <div className="ot-pc-feedback">
      {confirmed && <div className="ot-pc-feedback-msg ot-pc-feedback-msg--success">{t('tracking.feedback.confirmed')}</div>}
      {delayOpen && <div className="ot-pc-feedback-msg ot-pc-feedback-msg--pending">{t('tracking.feedback.delayReported')}</div>}
      {actionError && <div className="ot-pc-feedback-error">{actionError}</div>}

      {(canConfirm || (canReportDelay && !showDelayForm)) && (
        <div className="ot-pc-feedback-actions">
          {canConfirm && (
            <button type="button" className="ot-pc-feedback-btn ot-pc-feedback-btn--confirm" disabled={busy} onClick={handleConfirm}>
              {t('tracking.feedback.confirm')}
            </button>
          )}
          {canReportDelay && (
            <button type="button" className="ot-pc-feedback-btn ot-pc-feedback-btn--delay" disabled={busy} onClick={() => setShowDelayForm(true)}>
              {t('tracking.feedback.reportDelay')}
            </button>
          )}
        </div>
      )}

      {canReportDelay && showDelayForm && (
        <div className="ot-pc-delay-form">
          <textarea
            value={delayNote}
            onChange={e => setDelayNote(e.target.value)}
            placeholder={t('tracking.feedback.delayPlaceholder')}
            rows={2}
          />
          <div className="ot-pc-delay-form-actions">
            <button type="button" disabled={busy} onClick={handleReportDelay}>{t('tracking.feedback.submit')}</button>
            <button type="button" disabled={busy} onClick={() => { setShowDelayForm(false); setActionError(null); }}>{t('tracking.feedback.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product Status Panel ───────────────────────────────────────────────────────

function ProductStatusPanel({ shipment }: { shipment: Shipment | null }) {
  const { t } = useTranslation('orders');
  if (!shipment) return null;
  const s = shipment.status;

  if (s === 'delivered') return (
    <div className="ot-pc-status ot-pc-status--green">
      <svg width="15" height="15" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7"/>
      </svg>
      <span className="ot-pc-status-msg">{t('tracking.shipmentStatus.delivered')}</span>
    </div>
  );

  if (s === 'picked_up') return (
    <div className="ot-pc-status ot-pc-status--blue">
      <svg width="15" height="15" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 5v3h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
      <span className="ot-pc-status-msg">{t('tracking.shipmentStatus.picked_up')}</span>
    </div>
  );

  if (s === 'stranded') return (
    <div className="ot-pc-status ot-pc-status--red">
      <svg width="15" height="15" fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div>
        <div className="ot-pc-status-msg">{t('tracking.shipmentStatus.stranded_main')}</div>
        <div className="ot-pc-status-sub">{t('tracking.shipmentStatus.stranded_sub')}</div>
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
        <div className="ot-pc-status-msg">{t('tracking.shipmentStatus.delayed_main')}</div>
        <div className="ot-pc-status-sub">{t('tracking.shipmentStatus.delayed_sub')}</div>
      </div>
    </div>
  );

  if (s === 'reserved') return (
    <div className="ot-pc-status ot-pc-status--blue">
      <svg width="15" height="15" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
      <span className="ot-pc-status-msg">{t('tracking.shipmentStatus.reserved')}</span>
    </div>
  );

  if (s === 'batched') return (
    <div className="ot-pc-status ot-pc-status--green">
      <svg width="15" height="15" fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <span className="ot-pc-status-msg">{t('tracking.shipmentStatus.batched')}</span>
    </div>
  );

  if (s === 'available') return (
    <div className="ot-pc-status ot-pc-status--green">
      <svg width="15" height="15" fill="none" stroke="#15803D" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m5 12 5 5L20 7"/>
      </svg>
      <span className="ot-pc-status-msg">{t('tracking.shipmentStatus.available')}</span>
    </div>
  );

  if (s === 'pending') return (
    <div className="ot-pc-status ot-pc-status--blue">
      <svg width="15" height="15" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <span className="ot-pc-status-msg">{t('tracking.shipmentStatus.pending')}</span>
    </div>
  );

  return null;
}
