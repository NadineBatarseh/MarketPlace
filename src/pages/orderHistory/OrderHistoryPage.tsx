import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import AppNav from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import ExpandedDrawer, { DrawerItemData } from '../../components/ExpandedDrawer';
import './OrderHistoryPage.css';
import Topbar from '../../components/Topbar';

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

const STEPS = ['تم الطلب', 'في المخزن', 'بانتظار التجميع', 'في الطريق إليك', 'تم التوصيل'];

type StatusCfg = { label: string; badgeClass: string; step: number; filterKey: string };

const STATUS_CONFIG: Record<string, StatusCfg> = {
  pending_collection: { label: 'في المخزن',          badgeClass: 'badge-processing', step: 1, filterKey: 'processing' },
  at_hub:            { label: 'بانتظار التجميع',     badgeClass: 'badge-shipped',    step: 2, filterKey: 'shipped'    },
  delivering:        { label: 'في الطريق إليك',      badgeClass: 'badge-shipped',    step: 3, filterKey: 'shipped'    },
  completed:         { label: 'تم التوصيل',        badgeClass: 'badge-delivered',  step: 4, filterKey: 'delivered'  },
  cancelled:         { label: 'ملغي',              badgeClass: 'badge-cancelled',  step: 0, filterKey: 'cancelled'  },
};

const FALLBACK_CFG: StatusCfg = {
  label: 'في المخزن', badgeClass: 'badge-processing', step: 0, filterKey: 'processing',
};

const FILTER_LABELS: Record<string, string> = {
  all:        'الكل',
  delivered:  'تم التوصيل',
  processing: 'قيد المعالجة',
  shipped:    'في الطريق',
  cancelled:  'ملغي',
};

function formatOrderId(id: number) {
  return `#SQ-${String(id).padStart(5, '0')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-EG', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrderHistoryPage() {
  const { customer, isLoading: authLoading } = useCustomerAuth();
  const navigate = useNavigate();

  const [orders, setOrders]       = useState<Order[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [activeFilter, setFilter] = useState('all');
  const [search, setSearch]       = useState('');

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

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Step 1: fetch orders for this user
        const { data: ordersData, error: ordErr } = await supabase
          .from('orders')
          .select('id, total_price, status, created_at')
          .eq('user_id', customer!.id)
          .order('created_at', { ascending: false });
        if (ordErr) throw ordErr;
        if (!ordersData?.length) { if (!cancelled) { setOrders([]); setLoading(false); } return; }

        // Step 2: fetch order_details for those order ids (avoids needing a FK join)
        const orderIds = ordersData.map(o => o.id);
        const { data: detailsData, error: detErr } = await supabase
          .from('order_details')
          .select('id, order_id, product_id, qty, unit_price, package_status')
          .in('order_id', orderIds);
        if (detErr) throw detErr;

        // Step 3: fetch products
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

        // Step 4: merge
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
    return orders.filter(o => {
      const cfg = STATUS_CONFIG[o.status ?? ''] ?? FALLBACK_CFG;
      const matchFilter = activeFilter === 'all' || cfg.filterKey === activeFilter;
      const firstName   = o.order_details[0]?.product?.title ?? '';
      const matchSearch = !q
        || formatOrderId(o.id).toLowerCase().includes(q)
        || firstName.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [orders, activeFilter, search]);

  if (authLoading || loading) {
    return (
      <>
        <Topbar />
        <StoreNav />
        <div className="oh-page">
          <div className="oh-loading">جارٍ تحميل طلباتك…</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <AppNav />
        <StoreNav />
        <div className="oh-page">
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
      <AppNav />
      <StoreNav />
      <div className="oh-page" dir="rtl">

        {/* Header */}
        <div className="oh-header">
          <h1>طلباتي</h1>
          <p>تتبّع طلباتك ومراجعتها وإعادة طلبها · {customer?.displayName}</p>
        </div>

        {/* Stats */}
        <div className="oh-stats">
          <div className="oh-stat">
            <div className="oh-stat-val">{stats.total}</div>
            <div className="oh-stat-lbl">إجمالي الطلبات</div>
          </div>
          <div className="oh-stat">
            <div className="oh-stat-val">₪{stats.spent.toFixed(2)}</div>
            <div className="oh-stat-lbl">إجمالي الإنفاق</div>
          </div>
          <div className="oh-stat">
            <div className="oh-stat-val">{stats.inProgress}</div>
            <div className="oh-stat-lbl">قيد التنفيذ</div>
          </div>
        </div>

        {/* Filters */}
        <div className="oh-filters">
          <div className="oh-search-wrap">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              className="oh-search"
              type="text"
              placeholder="ابحث في الطلبات…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="oh-tabs">
            {(['all', 'delivered', 'processing', 'shipped', 'cancelled'] as const).map(f => (
              <button
                key={f}
                className={`oh-tab${activeFilter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
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
  const cfg      = STATUS_CONFIG[order.status ?? ''] ?? FALLBACK_CFG;
  const items    = order.order_details;
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const firstName = items[0]?.product?.title ?? 'منتج';
  const summary   = items.length > 1
    ? `${firstName} و${items.length - 1} منتج${items.length - 1 > 1 ? 'ات' : ''} أخرى`
    : firstName;
  const totalQty  = items.reduce((s, d) => s + (d.qty ?? 1), 0);
  const subText   = `${totalQty} قطعة`;

  const showTrack = cfg.step > 0 && order.status !== 'cancelled';
  const pct       = Math.round((cfg.step / (STEPS.length - 1)) * 100);

  const drawerItems: DrawerItemData[] = items.map(d => ({
    imageUrl:  d.product?.image_urls?.[0] ?? null,
    name:      d.product?.title ?? 'منتج',
    price:     `₪${(d.unit_price || d.product?.price || 0).toFixed(2)}`,
    qty:       d.qty,
    productId: d.product_id ?? null,
  }));

  return (
    <div className="oh-card" style={{ animationDelay: `${idx * 40}ms` }}>

      {/* Head */}
      <div className="oh-card-head">
        <div className="oh-order-meta">
          <span className="oh-order-id">{formatOrderId(order.id)}</span>
          <span className="oh-order-date">{formatDate(order.created_at)}</span>
        </div>
        <span className={`oh-badge ${cfg.badgeClass}`}>{cfg.label}</span>
      </div>

      {/* Body */}
      <div className="oh-card-body">
        <div className="oh-thumbs">
          {items.slice(0, 2).map(d => (
            <div
              key={d.id}
              className="oh-thumb"
              style={d.product_id ? { cursor: 'pointer' } : undefined}
              onClick={d.product_id ? () => navigate(`/product/${d.product_id}`) : undefined}
              title={d.product?.title}
            >
              {d.product?.image_urls?.[0]
                ? <img src={d.product.image_urls[0]} alt={d.product.title} />
                : <span>📦</span>
              }
            </div>
          ))}
          {items.length > 2 && (
            <div
              className="oh-thumb-more"
              style={{ cursor: 'pointer' }}
              onClick={() => setDrawerOpen(o => !o)}
              title={drawerOpen ? 'إخفاء المنتجات' : 'عرض كل المنتجات'}
            >
              {drawerOpen ? '▲' : `+${items.length - 2}`}
            </div>
          )}
        </div>
        <div className="oh-order-info">
          <div className="oh-product-name">{summary}</div>
          <div className="oh-product-sub">{subText}</div>
        </div>
      </div>

      {/* Expanded drawer */}
      <ExpandedDrawer items={drawerItems} isOpen={drawerOpen} />

      {/* Progress tracker */}
      {showTrack && (
        <div className="oh-tracker">
          <div className="oh-track-bar">
            <div className="oh-track-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="oh-track-steps">
            {STEPS.map((s, i) => {
              const done = i < cfg.step;
              const cur  = i === cfg.step;
              return (
                <div key={s} className="oh-track-step">
                  <div className={`oh-dot${done ? ' done' : cur ? ' current' : ''}`} />
                  <span className={`oh-step-lbl${done ? ' done' : ''}`}>{s}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="oh-card-foot">
        <div className="oh-total">
          ₪{(order.total_price ?? 0).toFixed(2)}
          <span> · {items.length} {items.length === 1 ? 'منتج' : 'منتجات'}</span>
        </div>
        <div className="oh-actions">
          <button className="oh-btn" onClick={() => navigate(`/orders/${order.id}`)}>التفاصيل</button>
          {(order.status === 'completed' || order.status === 'cancelled') && (
            <button className="oh-btn oh-btn-primary">إعادة الطلب</button>
          )}
          {(order.status === 'pending_collection' || order.status === 'at_hub' || order.status === 'delivering') && (
            <button className="oh-btn oh-btn-primary" onClick={() => navigate(`/orders/${order.id}`)}>تتبّع الطلب</button>
          )}
        </div>
      </div>

    </div>
  );
}
