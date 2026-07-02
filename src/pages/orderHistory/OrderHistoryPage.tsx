import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import StoreNav from '../../components/StoreNav';
import ExpandedDrawer, { DrawerItemData } from '../../components/ExpandedDrawer';
import Topbar from '../../components/Topbar';
import type { ShipmentStatus } from '../../../shared/status';
import { fetchUnreadOrderNotifications } from '../../lib/orderNotifications';
import i18n from '../../i18n/config';
import './OrderHistoryPage.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  title: string;
  image_urls: string[] | null;
  price: number | null;
}

interface Shipment {
  id: string;
  order_detail_id: number;
  status: ShipmentStatus;
  created_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  confirmedAt: string | null;
}

interface OrderDetail {
  id: number;
  product_id: string | null;
  qty: number | null;
  unit_price: number | null;
  package_status: string | null;
  product: Product | null;
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

// ── Static badge meta (display-language-independent) ─────────────────────────

const STEP_BADGE_META = [
  { badgeClass: 'badge-pending',    statusKey: 'pending'    },
  { badgeClass: 'badge-processing', statusKey: 'processing' },
  { badgeClass: 'badge-ready',      statusKey: 'ready'      },
  { badgeClass: 'badge-shipped',    statusKey: 'shipping'   },
];

const DATE_FILTER_KEYS = ['all', 'today', 'week', 'month', '3months'] as const;

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

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function dateLocale() {
  return i18n.language === 'ar' ? 'ar-EG' : 'en-US';
}

function formatOrderId(id: number) { return `#${id}`; }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(dateLocale(), {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatDateShort(date: Date) {
  return date.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  const time = formatTime(d);
  return `${date} - ${time}`;
}

function formatDateFull(date: Date) {
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

function addHours(date: Date, h: number): Date {
  return new Date(date.getTime() + h * 3_600_000);
}

function addDays(date: Date, d: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + d);
  return r;
}

// ── Order progress ────────────────────────────────────────────────────────────

interface OrderProgress {
  step: number;
  isCompleted: boolean;
  isCancelled: boolean;
  isConfirmed: boolean;
}

function getOrderProgress(order: Order): OrderProgress {
  if (order.status === 'cancelled') return { step: 0, isCompleted: false, isCancelled: true, isConfirmed: false };

  const shipments = order.order_details.map(d => d.shipment).filter((s): s is Shipment => !!s);
  const shipmentStatuses = shipments.map(s => s.status);
  const isConfirmed = shipments.length > 0 && shipments.every(s => !!s.confirmedAt);

  if (shipmentStatuses.length > 0 && shipmentStatuses.every(s => s === 'delivered')) {
    return { step: 3, isCompleted: true, isCancelled: false, isConfirmed };
  }
  if (shipmentStatuses.some(s => s === 'picked_up' || s === 'delivered')) {
    return { step: 3, isCompleted: false, isCancelled: false, isConfirmed };
  }
  if (shipmentStatuses.some(s => s === 'available')) {
    return { step: 2, isCompleted: false, isCancelled: false, isConfirmed };
  }
  if (order.payment_status === 'paid') {
    return { step: 1, isCompleted: false, isCancelled: false, isConfirmed };
  }
  return { step: 0, isCompleted: false, isCancelled: false, isConfirmed };
}

function getFilterKey(progress: OrderProgress): string {
  if (progress.isCancelled) return 'cancelled';
  if (progress.isCompleted) return 'delivered';
  return STEP_BADGE_META[progress.step].statusKey;
}

function earliestShipmentDate(order: Order, statuses: ShipmentStatus[]): Date | null {
  const times = order.order_details
    .map(d => d.shipment)
    .filter((s): s is Shipment => !!s && statuses.includes(s.status))
    .map(s => new Date(s.created_at).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function earliestPickedUpAt(order: Order): Date | null {
  const times = order.order_details
    .map(d => d.shipment?.picked_up_at)
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function latestConfirmedAt(order: Order): Date | null {
  const times = order.order_details
    .map(d => d.shipment?.confirmedAt)
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function latestDeliveredAt(order: Order): Date | null {
  const times = order.order_details
    .map(d => d.shipment?.delivered_at)
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function getEstimatedDelivery(order: Order, progress: OrderProgress): Date {
  const base = new Date(order.created_at);
  if (progress.isCancelled) return base;
  if (progress.isCompleted) return latestDeliveredAt(order) ?? base;
  if (progress.step === 3) return addHours(new Date(), 1);
  if (progress.step === 2) return addDays(base, 2);
  return addDays(base, 3);
}

function getDeliveryEstimateText(progress: OrderProgress, estDelivery: Date, t: TFunc): string {
  if (progress.isCancelled) return '';
  if (progress.isCompleted) return t('orders:history.estimate.delivered');
  if (progress.step === 3) {
    return isToday(estDelivery)
      ? t('orders:history.estimate.today', { time: formatTime(estDelivery) })
      : t('orders:history.estimate.hours');
  }
  const days = Math.round((estDelivery.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return t('orders:history.estimate.soon');
  if (days === 1) return t('orders:history.estimate.oneDay');
  if (days === 2) return t('orders:history.estimate.twoDays');
  return t('orders:history.estimate.days', { count: days });
}

function getStepTimestamps(order: Order): (Date | null)[] {
  const base = new Date(order.created_at);
  return [
    base,
    order.payment_status === 'paid' ? base : null,
    earliestShipmentDate(order, ['available', 'picked_up', 'delivered']),
    earliestPickedUpAt(order) ?? latestDeliveredAt(order),
    latestConfirmedAt(order),
  ];
}

function getTimeRemaining(target: Date, t: TFunc): string {
  const mins = Math.round((target.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return t('orders:history.time.soon');
  if (mins < 60) return t('orders:history.time.minutes', { count: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0
    ? t('orders:history.time.hourAndMinutes', { h, m })
    : t('orders:history.time.hour', { count: h });
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getDate() === now.getDate()
    && date.getMonth() === now.getMonth()
    && date.getFullYear() === now.getFullYear();
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrderHistoryPage() {
  const { t } = useTranslation('orders');
  const { direction } = useLanguage();
  const { customer, isLoading: authLoading } = useCustomerAuth();
  const navigate = useNavigate();

  const STEPS = t('orders:steps.order', { returnObjects: true }) as string[];

  const DATE_FILTER_OPTIONS = [
    { key: 'all',     label: t('orders:history.filter.period') },
    { key: 'today',   label: t('orders:history.filter.today')  },
    { key: 'week',    label: t('orders:history.filter.week')   },
    { key: 'month',   label: t('orders:history.filter.month')  },
    { key: '3months', label: t('orders:history.filter.months3')},
  ];

  const FILTER_LABELS: Record<string, string> = {
    all:        t('orders:history.filter.all'),
    pending:    t('orders:badges.pending'),
    processing: t('orders:badges.processing'),
    ready:      t('orders:badges.ready'),
    shipping:   t('orders:badges.shipping'),
    delivered:  t('orders:badges.delivered'),
  };

  const [orders, setOrders]       = useState<Order[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [unreadByOrder, setUnreadByOrder] = useState<Record<number, number>>({});
  const [activeFilter, setFilter]   = useState('all');
  const [search, setSearch]         = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [dateOpen, setDateOpen]     = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const dateRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!customer) { setUnreadByOrder({}); return; }
    let cancelled = false;
    fetchUnreadOrderNotifications(customer.id).then(res => {
      if (!cancelled) setUnreadByOrder(res.byOrder);
    });
    return () => { cancelled = true; };
  }, [customer]);

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: ordersData, error: ordErr } = await supabase
          .from('orders')
          .select('id, total_price, status, payment_status, created_at, shipping_address')
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
        const detailIds = (detailsData ?? []).map((d: any) => d.id as number);

        const [{ data: prods }, { data: shipments }, { data: confirmedEvents }] = await Promise.all([
          productIds.length
            ? supabase.from('products').select('id, title, image_urls, price').in('id', productIds)
            : Promise.resolve({ data: [] as Product[] }),
          detailIds.length
            ? supabase.from('shipments').select('id, order_detail_id, status, created_at, picked_up_at, delivered_at').in('order_detail_id', detailIds)
            : Promise.resolve({ data: [] as any[] }),
          orderIds.length
            ? supabase.from('order_tracking_events').select('shipment_id, created_at').eq('event_type', 'customer_confirmed').in('order_id', orderIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const productMap = new Map<string, Product>();
        prods?.forEach(p => productMap.set(p.id, p));

        const confirmedAtByShipment = new Map<string, string>();
        (confirmedEvents ?? []).forEach((e: any) => {
          if (e.shipment_id) confirmedAtByShipment.set(e.shipment_id, e.created_at);
        });

        const shipmentMap = new Map<number, Shipment>();
        shipments?.forEach((s: any) => shipmentMap.set(s.order_detail_id as number, {
          ...s,
          confirmedAt: confirmedAtByShipment.get(s.id) ?? null,
        }));

        const detailsByOrder = new Map<number, any[]>();
        (detailsData ?? []).forEach((d: any) => {
          if (!detailsByOrder.has(d.order_id)) detailsByOrder.set(d.order_id, []);
          detailsByOrder.get(d.order_id)!.push(d);
        });

        const merged: Order[] = ordersData.map(o => ({
          id:             o.id,
          total_price:    o.total_price,
          status:         o.status,
          payment_status: (o as any).payment_status ?? null,
          created_at:     o.created_at,
          shipping_address: (o as any).shipping_address ?? null,
          order_details: (detailsByOrder.get(o.id) ?? []).map((d: any) => ({
            id:             d.id,
            product_id:     d.product_id,
            qty:            d.qty,
            unit_price:     d.unit_price,
            package_status: d.package_status,
            product:        d.product_id ? (productMap.get(d.product_id) ?? null) : null,
            shipment:       shipmentMap.get(d.id) ?? null,
          })),
        }));

        if (!cancelled) setOrders(merged);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('orders:history.error.load'));
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
      const filterKey = getFilterKey(getOrderProgress(o));
      const matchFilter = activeFilter === 'all' || filterKey === activeFilter;
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
        <div className="oh-page" dir={direction}>
          <div className="oh-empty">
            <div className="oh-empty-icon">🔒</div>
            <h3>{t('orders:history.loginRequired.title')}</h3>
            <p>{t('orders:history.loginRequired.subtitle')}</p>
            <div className="oh-guest-actions">
              <button type="button" className="oh-btn oh-btn-primary" onClick={() => navigate('/login')}>
                {t('orders:history.loginRequired.login')}
              </button>
              <button type="button" className="oh-btn" onClick={() => navigate('/signup')}>
                {t('orders:history.loginRequired.signup')}
              </button>
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
        <div className="oh-page" dir={direction}>
          <div className="oh-loading">{t('orders:history.loading')}</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="oh-page" dir={direction}>
          <div className="oh-empty">
            <div className="oh-empty-icon">⚠️</div>
            <h3>{t('orders:history.error.title')}</h3>
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
      <div className="oh-page" dir={direction}>

        <div className="oh-header">
          <h1>{t('orders:history.title')}</h1>
          <p>{t('orders:history.subtitle')}</p>
        </div>

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
              <div className="oh-stat-lbl">{t('orders:history.stats.total')}</div>
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
              <div className="oh-stat-lbl">{t('orders:history.stats.spent')}</div>
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
              <div className="oh-stat-lbl">{t('orders:history.stats.inProgress')}</div>
            </div>
          </div>
        </div>

        <div className="oh-filter-bar">
          <div className="oh-fbar-search-wrap">
            <span className="oh-fbar-search-icon">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </span>
            <input
              className="oh-fbar-search"
              type="text"
              placeholder={t('orders:history.filter.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="oh-fbar-search-clear"
                aria-label={t('orders:history.filter.clearSearch')}
                onClick={() => setSearch('')}
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          <div className="oh-fbar-status-wrap" ref={statusRef}>
            <button
              type="button"
              className={`oh-fbar-status-btn${statusOpen ? ' open' : ''}${activeFilter !== 'all' ? ' has-value' : ''}`}
              onClick={() => setStatusOpen(o => !o)}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              <span>{activeFilter === 'all' ? t('orders:history.filter.status') : FILTER_LABELS[activeFilter]}</span>
              <svg className="oh-fbar-chevron" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {statusOpen && (
              <div className="oh-fbar-status-menu">
                {(['all', 'pending', 'processing', 'ready', 'shipping', 'delivered'] as const).map(f => (
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

          <div className="oh-fbar-status-wrap" ref={dateRef}>
            <button
              type="button"
              className={`oh-fbar-date-btn${dateOpen ? ' open' : ''}${dateFilter !== 'all' ? ' has-value' : ''}`}
              onClick={() => setDateOpen(o => !o)}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
              </svg>
              <span>{DATE_FILTER_OPTIONS.find(o => o.key === dateFilter)?.label ?? t('orders:history.filter.period')}</span>
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

        <div className="oh-list">
          {filtered.length === 0 ? (
            <div className="oh-empty">
              <div className="oh-empty-icon">📦</div>
              <h3>{t('orders:history.empty.title')}</h3>
              <p>{t('orders:history.empty.subtitle')}</p>
            </div>
          ) : (
            filtered.map((order, idx) => (
              <OrderCard key={order.id} order={order} idx={idx} unreadCount={unreadByOrder[order.id] ?? 0} t={t} steps={STEPS} />
            ))
          )}
        </div>

      </div>
    </>
  );
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

function OrderCard({
  order, idx, unreadCount, t, steps,
}: {
  order: Order;
  idx: number;
  unreadCount: number;
  t: TFunc;
  steps: string[];
}) {
  const progress = getOrderProgress(order);
  const badge = progress.isCancelled
    ? { label: t('orders:badges.cancelled'), badgeClass: 'badge-cancelled', statusKey: 'cancelled' }
    : progress.isCompleted
    ? { label: t('orders:badges.delivered'), badgeClass: 'badge-delivered', statusKey: 'delivered' }
    : {
        label: t(`orders:badges.${STEP_BADGE_META[progress.step].statusKey}`),
        ...STEP_BADGE_META[progress.step],
      };

  const items     = order.order_details;
  const navigate  = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fallbackProduct = t('orders:history.card.product');
  const firstName = items[0]?.product?.title ?? fallbackProduct;
  const extraCount = items.length - 1;
  const summary = items.length > 1
    ? `${firstName} ${extraCount === 1
        ? t('orders:history.card.andOneOther', { count: 1 })
        : t('orders:history.card.andManyOther', { count: extraCount })}`
    : firstName;
  const totalQty  = items.reduce((s, d) => s + (d.qty ?? 1), 0);

  const isDelivering = !progress.isCancelled && !progress.isCompleted && progress.step === 3;
  const isCompleted  = progress.isCompleted;
  const showDelivery = !progress.isCancelled;
  const showTrack    = !progress.isCancelled;

  const estDelivery    = getEstimatedDelivery(order, progress);
  const stepTimestamps = getStepTimestamps(order);
  const firstImage     = items[0]?.product?.image_urls?.[0] ?? null;

  const drawerItems: DrawerItemData[] = items.map(d => ({
    imageUrl:  d.product?.image_urls?.[0] ?? null,
    name:      d.product?.title ?? fallbackProduct,
    price:     `₪${(d.unit_price || d.product?.price || 0).toFixed(2)}`,
    qty:       d.qty,
    productId: d.product_id ?? null,
  }));

  return (
    <div
      className={`oh-card${unreadCount > 0 ? ' oh-card--unread' : ''}`}
      data-status={badge.statusKey}
      style={{ '--oh-delay': `${idx * 40}ms` } as React.CSSProperties}
    >
      {unreadCount > 0 && (
        <div className="oh-update-banner">
          <span className="oh-update-banner-badge">{unreadCount}</span>
          {t('orders:history.card.unreadUpdate')}
        </div>
      )}

      <div className="oh-card-head-grid">
        <div className="oh-col-order">
          <div className="oh-grid-order-id-row">
            <span className="oh-grid-order-label">{t('orders:history.card.orderNumber')}</span>
            <span className="oh-grid-order-id">{formatOrderId(order.id)}</span>
          </div>
          <div className="oh-grid-order-date">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            {formatDateTime(order.created_at)}
          </div>
          <span className={`oh-badge oh-grid-badge ${badge.badgeClass}`}>{badge.label}</span>
        </div>

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
            <span className="oh-grid-qty-badge">
              {totalQty} {totalQty === 1 ? t('orders:history.card.unit') : t('orders:history.card.units')}
            </span>
          </div>
        </div>

        <div className="oh-col-total">
          <div className="oh-grid-total-label">{t('orders:history.card.total')}</div>
          <div className="oh-grid-total-amount">₪{(order.total_price ?? 0).toFixed(2)}</div>
          <div className="oh-grid-total-items">
            {totalQty} {totalQty === 1 ? t('orders:history.card.product') : t('orders:history.card.products')}
          </div>
        </div>

        <div className="oh-col-delivery">
          {showDelivery ? (
            <>
              <div className="oh-grid-del-icon">
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
              </div>
              <div className="oh-grid-del-label">
                {isCompleted ? t('orders:history.card.deliveryDate') : t('orders:history.card.expectedDelivery')}
              </div>
              <div className="oh-grid-del-date">{formatDateFull(estDelivery)}</div>
              <div className="oh-grid-del-est">{getDeliveryEstimateText(progress, estDelivery, t)}</div>
            </>
          ) : (
            <div className="oh-grid-del-cancelled">{t('orders:history.card.cancelled')}</div>
          )}
        </div>
      </div>

      <ExpandedDrawer items={drawerItems} isOpen={drawerOpen} />

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
            <div className="oh-dp-title">{t('orders:history.card.delivering.title')}</div>
            <div className="oh-dp-rows">
              <div className="oh-dp-row">
                <span className="oh-dp-label">{t('orders:history.card.delivering.arrivalLabel')}</span>
                <span className="oh-dp-val">
                  {isToday(estDelivery)
                    ? t('orders:history.estimate.today', { time: formatTime(estDelivery) })
                    : formatDateShort(estDelivery)}
                </span>
              </div>
              <div className="oh-dp-row">
                <span className="oh-dp-label">{t('orders:history.card.delivering.remainingLabel')}</span>
                <span className="oh-dp-val oh-dp-timer">{getTimeRemaining(estDelivery, t)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTrack && (
        <div className="oh-tracker">
          <div className="oh-track-inner">
            <div className="oh-track-line" />
            <div className="oh-track-progress" data-step={progress.isConfirmed ? 4 : progress.step} />
            <div className="oh-track-steps">
              {steps.map((s, i) => {
                const isFinalStep = i === 4;
                const state = isFinalStep
                  ? (progress.isConfirmed ? 'done' : progress.isCompleted ? 'current' : 'future')
                  : progress.isCompleted ? 'done'
                  : i < progress.step ? 'done'
                  : i === progress.step ? 'current'
                  : 'future';
                const ts = stepTimestamps[i];
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
                      {state === 'current' && !isDeliverStep && <span className="oh-dot-pulse" />}
                      {state === 'future' && (
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="m5 12 5 5L20 7"/>
                        </svg>
                      )}
                    </div>
                    <span className="oh-step-lbl">{s}</span>
                    {state === 'current' && isDeliverStep ? (
                      <span className="oh-step-sub">{t('orders:history.card.timeline.delivering')}</span>
                    ) : state === 'current' && isFinalStep ? (
                      <span className="oh-step-sub">{t('orders:history.card.timeline.awaitingConfirm')}</span>
                    ) : (state === 'done' || state === 'current') && ts ? (
                      <span className="oh-step-time">{formatDateShort(ts)} - {formatTime(ts)}</span>
                    ) : (
                      <span className="oh-step-dash">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="oh-success-block">
          <div className="oh-success-icon-wrap">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div className="oh-success-body">
            <div className="oh-success-title">{t('orders:history.card.success.title')}</div>
            <div className="oh-success-rows">
              <div className="oh-success-row">
                <span className="oh-success-label">{t('orders:history.card.success.deliveryDate')}</span>
                <span className="oh-success-val">{formatDateShort(estDelivery)}</span>
              </div>
              <div className="oh-success-row">
                <span className="oh-success-label">{t('orders:history.card.success.deliveryTime')}</span>
                <span className="oh-success-val">{formatTime(estDelivery)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="oh-card-foot">
        <div className="oh-foot-summary">
          <div className="oh-foot-row">
            <span className="oh-foot-label">{t('orders:history.card.foot.itemCount')}</span>
            <span className="oh-foot-val">{totalQty}</span>
          </div>
          <div className="oh-foot-row">
            <span className="oh-foot-label">{t('orders:history.card.foot.total')}</span>
            <span className="oh-foot-val oh-foot-price">₪{(order.total_price ?? 0).toFixed(2)}</span>
          </div>
          <div className="oh-foot-row oh-foot-row--muted">
            <span className="oh-foot-label">{t('orders:history.card.foot.orderDate')}</span>
            <span className="oh-foot-val">{formatDateShort(new Date(order.created_at))}</span>
          </div>
          {showDelivery && (
            <div className="oh-foot-row oh-foot-row--muted">
              <span className="oh-foot-label">{t('orders:history.card.foot.expectedDelivery')}</span>
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
              {t('orders:history.card.actions.reorder')}
            </button>
          )}
          <button type="button" className="oh-btn oh-btn-primary" onClick={() => navigate(`/orders/${order.id}`)}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {t('orders:history.card.actions.track')}
          </button>
        </div>
      </div>
    </div>
  );
}
