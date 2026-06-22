import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import StoreNav from '../../components/StoreNav';
import ExpandedDrawer, { DrawerItemData } from '../../components/ExpandedDrawer';
import Topbar from '../../components/Topbar';
import './OrderHistoryPage.css';

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = ['تم الطلب', 'قيد المعالجة', 'جاهز للاستلام', 'قيد التوصيل', 'تم التسليم'];

type StatusCfg = { label: string; badgeClass: string; step: number; filterKey: string; statusKey: string };

const STATUS_CONFIG: Record<string, StatusCfg> = {
  pending:            { label: 'تم الطلب',      badgeClass: 'badge-pending',    step: 0, filterKey: 'pending',            statusKey: 'pending'    },
  pending_collection: { label: 'جاهز للاستلام', badgeClass: 'badge-processing', step: 2, filterKey: 'pending_collection', statusKey: 'processing' },
  delivering:         { label: 'قيد التوصيل',   badgeClass: 'badge-shipped',    step: 3, filterKey: 'shipped',            statusKey: 'shipping'   },
  completed:          { label: 'تم التسليم',     badgeClass: 'badge-delivered',  step: 4, filterKey: 'delivered',          statusKey: 'delivered'  },
  cancelled:          { label: 'ملغي',           badgeClass: 'badge-cancelled',  step: 0, filterKey: 'cancelled',          statusKey: 'cancelled'  },
};

const FALLBACK_CFG: StatusCfg = {
  label: 'تم الطلب', badgeClass: 'badge-pending', step: 0, filterKey: 'pending', statusKey: 'pending',
};

const FILTER_LABELS: Record<string, string> = {
  all:                'الكل',
  pending:            'تم الطلب',
  pending_collection: 'جاهز للاستلام',
  shipped:            'قيد التوصيل',
  delivered:          'تم التسليم',
  cancelled:          'ملغي',
};

const DATE_FILTER_OPTIONS = [
  { key: 'all',     label: 'جميع الفترات' },
  { key: 'today',   label: 'اليوم' },
  { key: 'week',    label: 'هذا الأسبوع' },
  { key: 'month',   label: 'هذا الشهر' },
  { key: '3months', label: 'آخر 3 أشهر' },
] as const;

function getDateFilterStart(key: string): Date | null {
  const now = new Date();
  switch (key) {
    case 'today':   { const d = new Date(now); d.setHours(0,0,0,0); return d; }
    case 'week':    return new Date(now.getTime() - 7  * 86_400_000);
    case 'month':   return new Date(now.getTime() - 30 * 86_400_000);
    case '3months': return new Date(now.getTime() - 90 * 86_400_000);
    default: return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatOrderId(id: number) {
  return `#${id}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-EG', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatDateShort(date: Date) {
  return date.toLocaleDateString('ar-EG', { month: 'long', day: 'numeric' });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = formatTime(d);
  return `${date} - ${time}`;
}

function formatDateFull(date: Date) {
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDeliveryEstimateText(order: Order, estDelivery: Date): string {
  if (order.status === 'cancelled') return '';
  if (order.status === 'completed') return 'تم التسليم بنجاح';
  if (order.status === 'delivering') {
    return isToday(estDelivery) ? `اليوم، ${formatTime(estDelivery)}` : 'خلال ساعات';
  }
  const days = Math.round((estDelivery.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'بعد قليل';
  if (days === 1) return 'خلال يوم واحد';
  if (days === 2) return 'خلال يومين';
  return `خلال ${days} أيام`;
}

function addHours(date: Date, h: number): Date {
  return new Date(date.getTime() + h * 3_600_000);
}

function addDays(date: Date, d: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + d);
  return r;
}

function getEstimatedDelivery(order: Order): Date {
  const base = new Date(order.created_at);
  switch (order.status) {
    case 'completed':          return addHours(base, 20);
    case 'delivering':         return addHours(new Date(), 1);
    case 'pending_collection': return addDays(base, 2);
    case 'cancelled':          return base;
    default:                   return addDays(base, 3);
  }
}

function getStepTimestamps(order: Order): Date[] {
  const base = new Date(order.created_at);
  const estDelivery = getEstimatedDelivery(order);
  return [
    base,                // تم الطلب
    addHours(base, 0.5), // قيد المعالجة
    addHours(base, 2),   // جاهز للاستلام
    addHours(base, 4),   // قيد التوصيل
    estDelivery,         // تم التسليم
  ];
}

function getTimeRemaining(target: Date): string {
  const mins = Math.round((target.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return 'بعد قليل';
  if (mins < 60) return `${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} ساعة و${m} دقيقة` : `${h} ساعة`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getDate() === now.getDate()
    && date.getMonth() === now.getMonth()
    && date.getFullYear() === now.getFullYear();
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrderHistoryPage() {
  const { customer, isLoading: authLoading } = useCustomerAuth();
  const navigate = useNavigate();

  const [orders, setOrders]       = useState<Order[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [activeFilter, setFilter]   = useState('all');
  const [search, setSearch]         = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [dateOpen, setDateOpen]     = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const dateRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
        setDateOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: ordersData, error: ordErr } = await supabase
          .from('orders')
          .select('id, total_price, status, created_at')
          .eq('user_id', customer!.id)
          .order('created_at', { ascending: false });
        if (ordErr) throw ordErr;
        if (!ordersData?.length) { if (!cancelled) { setOrders([]); setLoading(false); } return; }

        const orderIds = ordersData.map(o => o.id);
        const { data: detailsData, error: detErr } = await supabase
          .from('order_details')
          .select('id, order_id, product_id, qty, unit_price, package_status')
          .in('order_id', orderIds);
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
          prods?.forEach(p => productMap.set(p.id, p));
        }

        const detailsByOrder = new Map<number, any[]>();
        (detailsData ?? []).forEach((d: any) => {
          if (!detailsByOrder.has(d.order_id)) detailsByOrder.set(d.order_id, []);
          detailsByOrder.get(d.order_id)!.push(d);
        });

        const merged: Order[] = ordersData.map(o => ({
          id:          o.id,
          total_price: o.total_price,
          status:      o.status,
          created_at:  o.created_at,
          order_details: (detailsByOrder.get(o.id) ?? []).map((d: any) => ({
            id:             d.id,
            product_id:     d.product_id,
            qty:            d.qty,
            unit_price:     d.unit_price,
            package_status: d.package_status,
            product:        d.product_id ? (productMap.get(d.product_id) ?? null) : null,
          })),
        }));

        if (!cancelled) setOrders(merged);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'حدث خطأ أثناء تحميل الطلبات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [customer]);

  const stats = useMemo(() => ({
    total:      orders.length,
    spent:      orders.reduce((s, o) => s + (o.total_price ?? 0), 0),
    inProgress: orders.filter(o => !['completed', 'cancelled'].includes(o.status ?? '')).length,
  }), [orders]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const dateStart = getDateFilterStart(dateFilter);
    return orders.filter(o => {
      const cfg = STATUS_CONFIG[o.status ?? ''] ?? FALLBACK_CFG;
      const matchFilter = activeFilter === 'all' || cfg.filterKey === activeFilter;
      const firstName   = o.order_details[0]?.product?.title ?? '';
      const matchSearch = !q
        || formatOrderId(o.id).toLowerCase().includes(q)
        || firstName.toLowerCase().includes(q);
      const matchDate = !dateStart || new Date(o.created_at) >= dateStart;
      return matchFilter && matchSearch && matchDate;
    });
  }, [orders, activeFilter, search, dateFilter]);

  if (!authLoading && !customer) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="oh-page" dir="rtl">
          <div className="oh-empty">
            <div className="oh-empty-icon">🔒</div>
            <h3>يجب تسجيل الدخول لعرض طلباتك</h3>
            <p>قم بتسجيل الدخول أو إنشاء حساب للوصول إلى سجل طلباتك</p>
            <div className="oh-guest-actions">
              <button type="button" className="oh-btn oh-btn-primary" onClick={() => navigate('/login')}>تسجيل الدخول</button>
              <button type="button" className="oh-btn" onClick={() => navigate('/signup')}>إنشاء حساب</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (authLoading || loading) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="oh-page" dir="rtl">
          <div className="oh-loading">جارٍ تحميل طلباتك…</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="oh-page" dir="rtl">
          <div className="oh-empty">
            <div className="oh-empty-icon">⚠️</div>
            <h3>حدث خطأ ما</h3>
            <p>{error}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar />
      <StoreNav />
      <div className="oh-page" dir="rtl">

        {/* Header */}
        <div className="oh-header">
          <h1>طلباتي</h1>
          <p>تتبّع جميع طلباتك وحالة التوصيل</p>
        </div>

        {/* Stats */}
        <div className="oh-stats">
          <div className="oh-stat" data-type="orders">
            <div className="oh-stat-icon">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </div>
            <div className="oh-stat-body">
              <div className="oh-stat-val">{stats.total}</div>
              <div className="oh-stat-lbl">إجمالي الطلبات</div>

            </div>
          </div>
          <div className="oh-stat" data-type="spending">
            <div className="oh-stat-icon">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <div className="oh-stat-body">
              <div className="oh-stat-val">₪{stats.spent.toFixed(2)}</div>
              <div className="oh-stat-lbl">إجمالي الإنفاق</div>

            </div>
          </div>
          <div className="oh-stat" data-type="active">
            <div className="oh-stat-icon">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect x="1" y="3" width="15" height="13" rx="1"/>
                <path d="M16 8h4l3 5v3h-7V8z"/>
                <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
            </div>
            <div className="oh-stat-body">
              <div className="oh-stat-val">{stats.inProgress}</div>
              <div className="oh-stat-lbl">قيد التوصيل</div>

            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="oh-filter-bar">

          {/* Right (RTL): Search box */}
          <div className="oh-fbar-search-wrap">
            <span className="oh-fbar-search-icon">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </span>
            <input
              className="oh-fbar-search"
              type="text"
              placeholder="ابحث في الطلبات..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="oh-fbar-search-clear" aria-label="مسح البحث" onClick={() => setSearch('')}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Center: Status dropdown */}
          <div className="oh-fbar-status-wrap" ref={statusRef}>
            <button
              type="button"
              className={`oh-fbar-status-btn${statusOpen ? ' open' : ''}${activeFilter !== 'all' ? ' has-value' : ''}`}
              onClick={() => setStatusOpen(o => !o)}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              <span>{activeFilter === 'all' ? 'حالة الطلب' : FILTER_LABELS[activeFilter]}</span>
              <svg className="oh-fbar-chevron" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {statusOpen && (
              <div className="oh-fbar-status-menu">
                {(['all', 'pending', 'pending_collection', 'shipped', 'delivered', 'cancelled'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    className={`oh-fbar-status-opt${activeFilter === f ? ' selected' : ''}`}
                    onClick={() => { setFilter(f); setStatusOpen(false); }}
                  >
                    <span>{FILTER_LABELS[f]}</span>
                    {activeFilter === f && (
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="m5 12 5 5L20 7"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Left: Date filter */}
          <div className="oh-fbar-status-wrap" ref={dateRef}>
            <button
              type="button"
              className={`oh-fbar-date-btn${dateOpen ? ' open' : ''}${dateFilter !== 'all' ? ' has-value' : ''}`}
              onClick={() => setDateOpen(o => !o)}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
              </svg>
              <span>{DATE_FILTER_OPTIONS.find(o => o.key === dateFilter)?.label ?? 'جميع الفترات'}</span>
              <svg className="oh-fbar-chevron" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {dateOpen && (
              <div className="oh-fbar-status-menu">
                {DATE_FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`oh-fbar-status-opt${dateFilter === opt.key ? ' selected' : ''}`}
                    onClick={() => { setDateFilter(opt.key); setDateOpen(false); }}
                  >
                    <span>{opt.label}</span>
                    {dateFilter === opt.key && (
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="m5 12 5 5L20 7"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* List */}
        <div className="oh-list">
          {filtered.length === 0 ? (
            <div className="oh-empty">
              <div className="oh-empty-icon">📦</div>
              <h3>لا توجد طلبات</h3>
              <p>جرّب فلتراً أو كلمة بحث مختلفة.</p>
            </div>
          ) : (
            filtered.map((order, idx) => (
              <OrderCard key={order.id} order={order} idx={idx} />
            ))
          )}
        </div>

      </div>
    </>
  );
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

function OrderCard({ order, idx }: { order: Order; idx: number }) {
  const cfg           = STATUS_CONFIG[order.status ?? ''] ?? FALLBACK_CFG;
  const items         = order.order_details;
  const navigate      = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const firstName  = items[0]?.product?.title ?? 'منتج';
  const summary    = items.length > 1
    ? `${firstName} و${items.length - 1} منتج${items.length - 1 > 1 ? 'ات' : ''} أخرى`
    : firstName;
  const totalQty   = items.reduce((s, d) => s + (d.qty ?? 1), 0);
  const storeName  = items[0]?.product ? null : null; // placeholder for real store data

  const isDelivering   = order.status === 'delivering';
  const isCompleted    = order.status === 'completed';
  const showDelivery   = order.status !== 'cancelled';
  const showTrack      = order.status !== 'cancelled';

  const estDelivery    = getEstimatedDelivery(order);
  const stepTimestamps = getStepTimestamps(order);
  const firstImage     = items[0]?.product?.image_urls?.[0] ?? null;

  const drawerItems: DrawerItemData[] = items.map(d => ({
    imageUrl:  d.product?.image_urls?.[0] ?? null,
    name:      d.product?.title ?? 'منتج',
    price:     `₪${(d.unit_price || d.product?.price || 0).toFixed(2)}`,
    qty:       d.qty,
    productId: d.product_id ?? null,
  }));

  return (
    <div
      className="oh-card"
      data-status={cfg.statusKey}
      style={{ '--oh-delay': `${idx * 40}ms` } as React.CSSProperties}
    >

      {/* 4-column premium header */}
      <div className="oh-card-head-grid">

        {/* Col 1 (far right): Order Info */}
        <div className="oh-col-order">
          <div className="oh-grid-order-id-row">
            <span className="oh-grid-order-label">رقم الطلب</span>
            <span className="oh-grid-order-id">{formatOrderId(order.id)}</span>
          </div>
          <div className="oh-grid-order-date">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            {formatDateTime(order.created_at)}
          </div>
          <span className={`oh-badge oh-grid-badge ${cfg.badgeClass}`}>{cfg.label}</span>
        </div>

        {/* Col 2: Product Info */}
        <div className="oh-col-product">
          <div
            className={`oh-grid-prod-img${items[0]?.product_id ? ' oh-grid-prod-img--link' : ''}`}
            onClick={items[0]?.product_id ? () => navigate(`/product/${items[0].product_id}`) : undefined}
          >
            {firstImage
              ? <img src={firstImage} alt={firstName} />
              : <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>
                </svg>
            }
            {items.length > 1 && (
              <button
                type="button"
                className="oh-grid-more-badge"
                onClick={e => { e.stopPropagation(); setDrawerOpen(o => !o); }}
              >
                {drawerOpen ? '▲' : `+${items.length - 1}`}
              </button>
            )}
          </div>
          <div className="oh-grid-prod-info">
            <div className="oh-grid-prod-name">{summary}</div>
            {storeName && <div className="oh-grid-prod-store">المتجر: {storeName}</div>}
            <span className="oh-grid-qty-badge">{totalQty} {totalQty === 1 ? 'قطعة' : 'قطع'}</span>
          </div>
        </div>

        {/* Col 3: Total */}
        <div className="oh-col-total">
          <div className="oh-grid-total-label">المجموع</div>
          <div className="oh-grid-total-amount">₪{(order.total_price ?? 0).toFixed(2)}</div>
          <div className="oh-grid-total-items">{totalQty} {totalQty === 1 ? 'منتج' : 'منتجات'}</div>
        </div>

        {/* Col 4 (far left): Delivery Info */}
        <div className="oh-col-delivery">
          {showDelivery ? (
            <>
              <div className="oh-grid-del-icon">
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
              </div>
              <div className="oh-grid-del-label">
                {isCompleted ? 'تاريخ التسليم' : 'التوصيل المتوقع'}
              </div>
              <div className="oh-grid-del-date">{formatDateFull(estDelivery)}</div>
              <div className="oh-grid-del-est">{getDeliveryEstimateText(order, estDelivery)}</div>
            </>
          ) : (
            <div className="oh-grid-del-cancelled">تم إلغاء الطلب</div>
          )}
        </div>

      </div>

      {/* Expanded drawer */}
      <ExpandedDrawer items={drawerItems} isOpen={drawerOpen} />

      {/* Active delivery panel */}
      {isDelivering && (
        <div className="oh-delivery-panel">
          <div className="oh-dp-icon-wrap">
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="1" y="3" width="15" height="13" rx="1"/>
              <path d="M16 8h4l3 5v3h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          </div>
          <div className="oh-dp-body">
            <div className="oh-dp-title">طلبك في الطريق</div>
            <div className="oh-dp-rows">
              <div className="oh-dp-row">
                <span className="oh-dp-label">الوصول المتوقع:</span>
                <span className="oh-dp-val">
                  {isToday(estDelivery) ? `اليوم، ${formatTime(estDelivery)}` : formatDateShort(estDelivery)}
                </span>
              </div>
              <div className="oh-dp-row">
                <span className="oh-dp-label">الوقت المتبقي:</span>
                <span className="oh-dp-val oh-dp-timer">{getTimeRemaining(estDelivery)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progress tracker */}
      {showTrack && (
        <div className="oh-tracker">
          <div className="oh-track-inner">
            <div className="oh-track-line" />
            <div className="oh-track-progress" data-step={cfg.step} />
            <div className="oh-track-steps">
              {STEPS.map((s, i) => {
                const state = i < cfg.step ? 'done' : i === cfg.step ? 'current' : 'future';
                const ts    = stepTimestamps[i];
                const isDeliverStep = i === 3;
                return (
                  <div key={s} className="oh-track-step" data-state={state}>
                    <div className={`oh-dot oh-dot--${state}`}>
                      {state === 'done' && (
                        <svg width="15" height="15" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24">
                          <path d="m5 12 5 5L20 7"/>
                        </svg>
                      )}
                      {state === 'current' && isDeliverStep && (
                        <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <rect x="1" y="3" width="15" height="13" rx="1"/>
                          <path d="M16 8h4l3 5v3h-7V8z"/>
                          <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                        </svg>
                      )}
                      {state === 'current' && !isDeliverStep && (
                        <span className="oh-dot-pulse" />
                      )}
                      {state === 'future' && (
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="m5 12 5 5L20 7"/>
                        </svg>
                      )}
                    </div>
                    <span className="oh-step-lbl">{s}</span>
                    {state === 'done' && (
                      <span className="oh-step-time">{formatDateShort(ts)} - {formatTime(ts)}</span>
                    )}
                    {state === 'current' && isDeliverStep && (
                      <span className="oh-step-sub">جاري التوصيل</span>
                    )}
                    {state === 'current' && !isDeliverStep && (
                      <span className="oh-step-time">{formatDateShort(ts)} - {formatTime(ts)}</span>
                    )}
                    {state === 'future' && (
                      <span className="oh-step-dash">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Completed success block */}
      {isCompleted && (
        <div className="oh-success-block">
          <div className="oh-success-icon-wrap">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div className="oh-success-body">
            <div className="oh-success-title">تم تسليم الطلب بنجاح</div>
            <div className="oh-success-rows">
              <div className="oh-success-row">
                <span className="oh-success-label">تاريخ التسليم:</span>
                <span className="oh-success-val">{formatDateShort(estDelivery)}</span>
              </div>
              <div className="oh-success-row">
                <span className="oh-success-label">وقت التسليم:</span>
                <span className="oh-success-val">{formatTime(estDelivery)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="oh-card-foot">
        <div className="oh-foot-summary">
          <div className="oh-foot-row">
            <span className="oh-foot-label">عدد المنتجات:</span>
            <span className="oh-foot-val">{totalQty}</span>
          </div>
          <div className="oh-foot-row">
            <span className="oh-foot-label">المجموع:</span>
            <span className="oh-foot-val oh-foot-price">₪{(order.total_price ?? 0).toFixed(2)}</span>
          </div>
          <div className="oh-foot-row oh-foot-row--muted">
            <span className="oh-foot-label">تاريخ الطلب:</span>
            <span className="oh-foot-val">{formatDateShort(new Date(order.created_at))}</span>
          </div>
          {showDelivery && (
            <div className="oh-foot-row oh-foot-row--muted">
              <span className="oh-foot-label">موعد التسليم المتوقع:</span>
              <span className="oh-foot-val">{formatDateShort(estDelivery)}</span>
            </div>
          )}
        </div>
        <div className="oh-actions">
          {isCompleted && (
            <button type="button" className="oh-btn oh-btn-primary">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
              </svg>
              إعادة الطلب
            </button>
          )}
          <button type="button" className="oh-btn oh-btn-primary" onClick={() => navigate(`/orders/${order.id}`)}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            تتبّع الطلب
          </button>
        </div>
      </div>

    </div>
  );
}
