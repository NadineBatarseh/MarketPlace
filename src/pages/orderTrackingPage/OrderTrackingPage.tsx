import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import './OrderTrackingPage.css';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrackingEvent {
  id: number;
  step: string;
  triggered_by: string | null;
  note: string | null;
  location: string | null;
  created_at: string;
}

interface Product {
  id: string;
  title: string;
  image_urls: string[] | null;
  price: number | null;
}

interface OrderDetail {
  id: number;
  product_id: string | null;
  qty: number | null;
  unit_price: number | null;
  package_status: string | null;
  product: Product | null;
}

interface Order {
  id: number;
  total_price: number | null;
  status: string | null;
  created_at: string;
  order_details: OrderDetail[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TRACK_STEPS = [
  {
    key: 'placed',
    label: 'تم الطلب',
    icon: (
      <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    ),
  },
  {
    key: 'confirmed',
    label: 'تم التأكيد',
    icon: (
      <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <path d="m9 11 3 3L22 4"/>
      </svg>
    ),
  },
  {
    key: 'packed',
    label: 'تم التجهيز',
    icon: (
      <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
        <path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>
      </svg>
    ),
  },
  {
    key: 'shipping',
    label: 'في الطريق',
    icon: (
      <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 5v3h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
  },
  {
    key: 'delivered',
    label: 'تم التوصيل',
    icon: (
      <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path d="M9 22V12h6v10"/>
      </svg>
    ),
  },
];

// DB status → current step index (0-based; -1 = cancelled)
const STATUS_STEP: Record<string, number> = {
  pending:            0,   // just paid — order placed, not yet collected
  pending_collection: 1,
  at_hub:             2,
  delivering:         3,
  completed:          4,
  cancelled:          -1,
};

// Status → display label
const STATUS_LABEL: Record<string, string> = {
  pending_collection: 'في المخزن',
  at_hub:             'بانتظار التجميع',
  delivering:         'في الطريق إليك',
  completed:          'تم التوصيل',
  cancelled:          'ملغي',
};

// Status → badge class
const STATUS_CLASS: Record<string, string> = {
  pending_collection: 'ot-badge--processing',
  at_hub:             'ot-badge--hub',
  delivering:         'ot-badge--shipping',
  completed:          'ot-badge--delivered',
  cancelled:          'ot-badge--cancelled',
};

// Status → hero message
const STATUS_MESSAGE: Record<string, string> = {
  pending_collection: 'طلبك في المخزن 📦',
  at_hub:             'طلبك في مركز التجميع 🏭',
  delivering:         'طلبك في الطريق إليك 🚚',
  completed:          'تم توصيل طلبك بنجاح 🎉',
  cancelled:          'تم إلغاء الطلب',
};

// Status → ETA text (illustrative — replace with real data when available)
const STATUS_ETA: Record<string, string | null> = {
  pending_collection: 'متوقع خلال 1–2 يوم عمل',
  at_hub:             'متوقع غداً بين 10:00 – 14:00',
  delivering:         'اليوم بين 17:00 – 20:00',
  completed:          null,
  cancelled:          null,
};

function formatOrderId(id: number) {
  return `#SQ-${String(id).padStart(5, '0')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-EG', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate     = useNavigate();
  const { customer, isLoading: authLoading } = useCustomerAuth();

  const [order, setOrder]     = useState<Order | null>(null);
  const [events, setEvents]   = useState<TrackingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !customer) navigate('/login');
  }, [authLoading, customer, navigate]);

  useEffect(() => {
    if (!customer || !orderId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: orderData, error: ordErr } = await supabase
          .from('orders')
          .select('id, total_price, status, created_at')
          .eq('id', orderId)
          .eq('user_id', customer!.id)
          .single();

        if (ordErr || !orderData) throw ordErr ?? new Error('الطلب غير موجود');

        const { data: detailsData, error: detErr } = await supabase
          .from('order_details')
          .select('id, order_id, product_id, qty, unit_price, package_status')
          .eq('order_id', orderData.id);

        if (detErr) throw detErr;

        const productIds = [
          ...new Set(
            (detailsData ?? []).map((d: any) => d.product_id as string | null).filter(Boolean)
          ),
        ] as string[];

        const productMap = new Map<string, Product>();
        if (productIds.length > 0) {
          const { data: prods } = await supabase
            .from('products')
            .select('id, title, image_urls, price')
            .in('id', productIds);
          prods?.forEach((p: Product) => productMap.set(p.id, p));
        }

        const merged: Order = {
          id:          orderData.id,
          total_price: orderData.total_price,
          status:      orderData.status,
          created_at:  orderData.created_at,
          order_details: (detailsData ?? []).map((d: any) => ({
            id:             d.id,
            product_id:     d.product_id,
            qty:            d.qty,
            unit_price:     d.unit_price,
            package_status: d.package_status,
            product:        d.product_id ? (productMap.get(d.product_id) ?? null) : null,
          })),
        };

        // fetch real tracking events
        const { data: eventsData } = await supabase
          .from('order_tracking_events')
          .select('id, step, triggered_by, note, location, created_at')
          .eq('order_id', orderData.id)
          .order('created_at', { ascending: true });

        if (!cancelled) {
          setOrder(merged);
          setEvents((eventsData ?? []) as TrackingEvent[]);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'حدث خطأ أثناء تحميل الطلب');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [customer, orderId]);

  // ── Loading ──
  if (authLoading || loading) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="ot-page" dir="rtl">
          <div className="ot-loading">
            <div className="ot-spinner" />
            <span>جارٍ تحميل بيانات الطلب…</span>
          </div>
        </div>
      </>
    );
  }

  // ── Error ──
  if (error || !order) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="ot-page" dir="rtl">
          <div className="ot-empty-state">
            <div className="ot-empty-icon">
              <svg width="52" height="52" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <h3>لم يتم العثور على الطلب</h3>
            <p>{error ?? 'هذا الطلب غير موجود أو لا ينتمي إلى حسابك.'}</p>
            <button type="button" className="ot-btn ot-btn--primary" onClick={() => navigate('/orders')}>
              العودة إلى طلباتي
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar />
      <StoreNav />
      <div className="ot-page" dir="rtl">

        {/* ── Breadcrumb ── */}
        <div className="ot-breadcrumb">
          <button type="button" className="ot-back-btn" onClick={() => navigate('/orders')}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            طلباتي
          </button>
          <span className="ot-breadcrumb-sep">/</span>
          <span className="ot-breadcrumb-current">{formatOrderId(order.id)}</span>
        </div>

        {/* ── 1. Summary Card ── */}
        <SummaryCard order={order} navigate={navigate} />

        {/* ── 2. Progress Dashboard ── */}
        {order.status !== 'cancelled'
          ? <ProgressSection order={order} />
          : <CancelledBanner />
        }

        {/* ── 3. Vertical Timeline ── */}
        {order.status !== 'cancelled' && <VerticalTimeline order={order} events={events} />}

        {/* ── 4. Items ── */}
        <ItemsSection order={order} navigate={navigate} />

        {/* ── 5. Support ── */}
        <SupportArea order={order} />

      </div>
    </>
  );
}

// ── 1. Summary Card ────────────────────────────────────────────────────────────

function SummaryCard({ order, navigate }: { order: Order; navigate: ReturnType<typeof useNavigate> }) {
  const status    = order.status ?? '';
  const badgeCls  = STATUS_CLASS[status] ?? 'ot-badge--processing';
  const statusLbl = STATUS_LABEL[status] ?? status;
  const isCancellable = status === 'pending_collection';
  const isDelivered   = status === 'completed';

  return (
    <div className="ot-summary-card ot-card">
      {/* Left: order meta */}
      <div className="ot-summary-left">
        <div className="ot-summary-top">
          <span className="ot-order-id">{formatOrderId(order.id)}</span>
          <span className={`ot-badge ${badgeCls}`}>{statusLbl}</span>
        </div>
        <div className="ot-summary-meta">
          <span className="ot-meta-item">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            {formatDate(order.created_at)}
          </span>
          <span className="ot-meta-dot">·</span>
          <span className="ot-meta-item">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>
            </svg>
            {order.order_details.length} {order.order_details.length === 1 ? 'منتج' : 'منتجات'}
          </span>
          <span className="ot-meta-dot">·</span>
          <span className="ot-meta-item ot-meta-paid">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
            </svg>
            مدفوع
          </span>
        </div>
        <div className="ot-summary-total">
          <span className="ot-total-label">المجموع الكلي</span>
          <span className="ot-total-val">₪{(order.total_price ?? 0).toFixed(2)}</span>
        </div>
      </div>

      {/* Right: action buttons */}
      <div className="ot-summary-actions">
        <button type="button" className="ot-action-btn ot-action-btn--primary" onClick={() => window.print()}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          تحميل الفاتورة
        </button>

        {!isDelivered && status !== 'cancelled' && (
          <button type="button" className="ot-action-btn">
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            التواصل مع المتجر
          </button>
        )}

        {isCancellable && (
          <button type="button" className="ot-action-btn ot-action-btn--danger">
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>
            </svg>
            إلغاء الطلب
          </button>
        )}

        <button type="button" className="ot-action-btn ot-action-btn--ghost" onClick={() => navigate('/orders')}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
          </svg>
          جميع طلباتي
        </button>
      </div>
    </div>
  );
}

// ── 2. Progress Section ────────────────────────────────────────────────────────

function ProgressSection({ order }: { order: Order }) {
  const status     = order.status ?? '';
  const activeStep = STATUS_STEP[status] ?? 0;
  const pct        = Math.round(((activeStep + 1) / TRACK_STEPS.length) * 100);
  const message    = STATUS_MESSAGE[status] ?? '';
  const eta        = STATUS_ETA[status];

  // SVG ring maths
  const R = 40;
  const circ = 2 * Math.PI * R; // ≈ 251.3
  const offset = circ * (1 - pct / 100);

  return (
    <div className="ot-progress-card ot-card">

      {/* Hero row: ring + status + ETA */}
      <div className="ot-progress-hero">

        {/* Circular ring */}
        <div className="ot-ring-wrap">
          <svg width="120" height="120" viewBox="0 0 100 100">
            {/* track */}
            <circle cx="50" cy="50" r={R} fill="none" stroke="#e8f5ee" strokeWidth="8" />
            {/* progress */}
            <circle
              cx="50" cy="50" r={R}
              fill="none"
              stroke="var(--p)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px', transition: 'stroke-dashoffset .6s ease' }}
            />
            {/* centre text */}
            <text x="50" y="45" textAnchor="middle" fill="#0a3d24" fontSize="20" fontWeight="700" fontFamily="Syne, sans-serif">{pct}%</text>
            <text x="50" y="62" textAnchor="middle" fill="#8aad99" fontSize="9.5" fontFamily="Tajawal, sans-serif">مكتمل</text>
          </svg>
        </div>

        {/* Status message + ETA */}
        <div className="ot-progress-info">
          <div className="ot-progress-msg">{message}</div>
          {eta && (
            <div className="ot-eta-box">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              <div>
                <div className="ot-eta-label">الوقت المتوقع للتوصيل</div>
                <div className="ot-eta-val">{eta}</div>
              </div>
            </div>
          )}
          {status === 'completed' && (
            <div className="ot-delivered-note">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m5 12 5 5L20 7"/>
              </svg>
              تم التوصيل بتاريخ {formatDate(order.created_at)}
            </div>
          )}
        </div>
      </div>

      {/* Horizontal step bar */}
      <div className="ot-hbar">
        {TRACK_STEPS.map((step, idx) => {
          const done    = idx < activeStep;
          const current = idx === activeStep;
          const last    = idx === TRACK_STEPS.length - 1;
          return (
            <React.Fragment key={step.key}>
              <div className={`ot-hstep${done ? ' ot-hstep--done' : current ? ' ot-hstep--current' : ''}`}>
                <div className="ot-hstep-circle">
                  {done
                    ? <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>
                    : step.icon
                  }
                </div>
                <span className="ot-hstep-label">{step.label}</span>
              </div>
              {!last && (
                <div className={`ot-hconnect${done ? ' ot-hconnect--done' : current ? ' ot-hconnect--current' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

    </div>
  );
}

// ── 3. Timeline Table ─────────────────────────────────────────────────────────

// Detailed timeline rows — each maps to an activeStep threshold
const TIMELINE_ROWS = [
  {
    key:      'placed',
    label:    'تم تقديم الطلب',
    atStep:   0,
    location: 'النظام الإلكتروني',
    by:       'العميل',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 12 2 2 4-4"/>
      </svg>
    ),
  },
  {
    key:      'collecting',
    label:    'جارٍ تجميع الطلب من المتاجر',
    atStep:   1,
    location: 'المتاجر المحلية',
    by:       'فريق المتجر',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>
      </svg>
    ),
  },
  {
    key:      'hub',
    label:    'وصل الطلب إلى المستودع',
    atStep:   2,
    location: 'مستودع رام الله',
    by:       'موظف المستودع',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path d="M9 22V12h6v10"/>
      </svg>
    ),
  },
  {
    key:      'packing',
    label:    'جارٍ الفرز والتعبئة والتغليف',
    atStep:   2,
    location: 'مستودع رام الله',
    by:       'فريق التعبئة',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
        <path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>
      </svg>
    ),
  },
  {
    key:      'driver',
    label:    'تم تسليم الطلب للسائق',
    atStep:   3,
    location: 'مستودع رام الله',
    by:       'موظف المستودع',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
  {
    key:      'ontheway',
    label:    'الطلب في الطريق إليك',
    atStep:   3,
    location: 'في الطريق',
    by:       'السائق',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 5v3h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
  },
  {
    key:      'delivered',
    label:    'تم التوصيل بنجاح',
    atStep:   4,
    location: 'عنوان التوصيل',
    by:       'السائق',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>
      </svg>
    ),
  },
];

function VerticalTimeline({ order, events }: { order: Order; events: TrackingEvent[] }) {
  const activeStep = STATUS_STEP[order.status ?? ''] ?? 0;

  // Build a map of step key → real event (if it exists in DB)
  const eventByStep = new Map<string, TrackingEvent>();
  for (const ev of events) eventByStep.set(ev.step, ev);

  return (
    <div className="ot-timeline-card ot-card">
      <div className="ot-section-title">
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
        </svg>
        سجل الطلب
      </div>

      <div className="ot-tbl-wrap">
        <table className="ot-tbl">
          <thead>
            <tr>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th>ملاحظات</th>
              <th>الموقع</th>
              <th>بواسطة</th>
            </tr>
          </thead>
          <tbody>
            {TIMELINE_ROWS.map((row) => {
              const done    = activeStep > row.atStep;
              const current = activeStep === row.atStep;
              const rowCls  = done ? 'ot-tr--done' : current ? 'ot-tr--current' : 'ot-tr--future';

              // Use real event data if available, fall back to row defaults
              const ev       = eventByStep.get(row.key);
              const ts       = ev?.created_at ?? null;
              const location = ev?.location ?? (done || current ? row.location : null);
              const by       = ev?.triggered_by ?? (done || current ? row.by : null);
              const note     = ev?.note ?? null;

              return (
                <tr key={row.key} className={rowCls}>
                  {/* Status */}
                  <td className="ot-td-status">
                    <div className="ot-status-cell">
                      <div className="ot-status-dot">
                        {done && (
                          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path d="m5 12 5 5L20 7"/>
                          </svg>
                        )}
                        {current && <span className="ot-status-pulse" />}
                      </div>
                      <span className="ot-status-label">{row.label}</span>
                      {current && <span className="ot-now-chip">الآن</span>}
                    </div>
                    {note && <div className="ot-row-note">{note}</div>}
                  </td>

                  {/* Date */}
                  <td className="ot-td-date">
                    {ts ? (
                      <div className="ot-date-cell">
                        <div className="ot-date-day">{new Date(ts).toLocaleDateString('ar-EG', { weekday: 'short' })}</div>
                        <div className="ot-date-main">
                          {new Date(ts).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        <div className="ot-date-time">{formatTime(ts)}</div>
                      </div>
                    ) : (
                      <span className="ot-pending-text">—</span>
                    )}
                  </td>

                  {/* Remarks / icon */}
                  <td className="ot-td-icon">
                    <div className={`ot-icon-chip${done ? ' ot-icon-chip--done' : current ? ' ot-icon-chip--current' : ''}`}>
                      {row.icon}
                    </div>
                  </td>

                  {/* Location */}
                  <td className="ot-td-location">
                    {location ? (
                      <div className="ot-location-cell">
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                          <circle cx="12" cy="9" r="2.5"/>
                        </svg>
                        {location}
                      </div>
                    ) : (
                      <span className="ot-pending-text">—</span>
                    )}
                  </td>

                  {/* Updated by */}
                  <td className="ot-td-by">
                    {by ? (
                      <div className="ot-by-cell">
                        <div className="ot-by-avatar">{by.charAt(0)}</div>
                        {by}
                      </div>
                    ) : (
                      <span className="ot-pending-text">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Cancelled Banner ───────────────────────────────────────────────────────────

function CancelledBanner() {
  return (
    <div className="ot-cancelled-banner ot-card">
      <div className="ot-cancelled-icon">
        <svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>
        </svg>
      </div>
      <div>
        <div className="ot-cancelled-title">تم إلغاء الطلب</div>
        <div className="ot-cancelled-sub">لن يتم توصيل هذا الطلب. للاستفسار تواصل مع الدعم.</div>
      </div>
    </div>
  );
}

// ── 4. Items Section ───────────────────────────────────────────────────────────

function ItemsSection({ order, navigate }: { order: Order; navigate: ReturnType<typeof useNavigate> }) {
  const count = order.order_details.length;
  return (
    <div className="ot-items-card ot-card">
      <div className="ot-section-title">
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>
        </svg>
        محتويات الطلب
        <span className="ot-count-chip">{count} {count === 1 ? 'منتج' : 'منتجات'}</span>
      </div>

      <div className="ot-items-list">
        {order.order_details.map((detail) => {
          const product = detail.product;
          const price   = detail.unit_price ?? product?.price ?? 0;
          const qty     = detail.qty ?? 1;
          const imgUrl  = product?.image_urls?.[0];

          return (
            <div
              key={detail.id}
              className={`ot-item${detail.product_id ? ' ot-item--clickable' : ''}`}
              onClick={detail.product_id ? () => navigate(`/product/${detail.product_id}`) : undefined}
            >
              <div className="ot-item-img">
                {imgUrl
                  ? <img src={imgUrl} alt={product?.title} />
                  : <div className="ot-item-img-ph">
                      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>
                      </svg>
                    </div>
                }
              </div>

              <div className="ot-item-info">
                <div className="ot-item-name">{product?.title ?? 'منتج'}</div>
                <div className="ot-item-meta">
                  <span>الكمية: {qty}</span>
                  {detail.package_status && (
                    <span className="ot-pkg-chip">{detail.package_status}</span>
                  )}
                </div>
              </div>

              <div className="ot-item-price">
                <div className="ot-item-unit">₪{price.toFixed(2)}</div>
                {qty > 1 && <div className="ot-item-sub">× {qty} = ₪{(price * qty).toFixed(2)}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ot-items-foot">
        <span className="ot-foot-label">المجموع الكلي</span>
        <span className="ot-foot-val">₪{(order.total_price ?? 0).toFixed(2)}</span>
      </div>
    </div>
  );
}

// ── 5. Support Area ────────────────────────────────────────────────────────────

function SupportArea({ order }: { order: Order }) {
  const isDelivered = order.status === 'completed';
  return (
    <div className="ot-support-card ot-card">
      <div className="ot-section-title">
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>
        </svg>
        هل تحتاج إلى مساعدة؟
      </div>
      <div className="ot-support-btns">
        <button type="button" className="ot-sup-btn">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          تواصل مع الدعم
        </button>
        <button type="button" className="ot-sup-btn">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
            <line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
          الإبلاغ عن مشكلة
        </button>
        {isDelivered && (
          <button type="button" className="ot-sup-btn ot-sup-btn--return">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
            </svg>
            طلب إرجاع المنتج
          </button>
        )}
      </div>
    </div>
  );
}
