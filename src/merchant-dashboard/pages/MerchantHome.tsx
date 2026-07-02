import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';

interface Stats {
  unpaidTotal: number;
  accountBalance: number;
  visitors: number;
  newOrders: number;
}

interface RecentOrder {
  id: number;
  status: string;
  total: number;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  delivering: '#0ea5e9',
  completed: '#16a34a',
};

const fmt = (id: number) => `ORD-${String(id).padStart(3, '0')}`;

export default function MerchantHome({ onNavigate }: { onNavigate?: (page: string, highlight?: boolean) => void }) {
  const { t } = useTranslation('merchant');
  const { lang, direction } = useLanguage();
  const { merchant } = useMerchantAuth();
  const [stats, setStats] = useState<Stats>({ unpaidTotal: 0, accountBalance: 0, visitors: 0, newOrders: 0 });
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const shopId = merchant?.shop?.shop_id;
    if (!shopId) { setLoading(false); return; }
    loadData(shopId);
  }, [merchant?.shop?.shop_id]);

  const loadData = async (shopId: string) => {
    setLoading(true);
    setError('');
    try {
      const { count: visitorCount } = await supabase
        .from('Store_visitors')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', shopId);

      const { data: detailRows } = await supabase
        .from('order_details')
        .select('order_id')
        .eq('shop_id', shopId);

      const orderIds = [...new Set((detailRows ?? []).map(r => r.order_id as number))];

      let unpaidTotal = 0;
      let accountBalance = 0;
      let newOrders = 0;

      if (orderIds.length > 0) {
        // unpaidTotal/accountBalance are about money the customer has/hasn't
        // paid — that's payment_status, not the delivery-lifecycle status.
        const { data: unpaidData } = await supabase
          .from('orders').select('total_price').in('id', orderIds).neq('payment_status', 'paid');
        unpaidTotal = (unpaidData ?? []).reduce((s, o) => s + (Number(o.total_price) || 0), 0);

        const { data: paidData } = await supabase
          .from('orders').select('total_price').in('id', orderIds).eq('payment_status', 'paid');
        accountBalance = (paidData ?? []).reduce((s, o) => s + (Number(o.total_price) || 0), 0);

        const { count: newCount } = await supabase
          .from('orders').select('*', { count: 'exact', head: true })
          .in('id', orderIds).eq('status', 'pending');
        newOrders = newCount ?? 0;

        const { data: ordersData } = await supabase
          .from('orders').select('id, status, total_price, created_at')
          .in('id', orderIds).order('created_at', { ascending: false }).limit(10);

        setOrders((ordersData ?? []).map(o => ({
          id: o.id,
          status: o.status ?? 'pending',
          total: Number(o.total_price) || 0,
          createdAt: o.created_at,
        })));
      }

      setStats({ unpaidTotal, accountBalance, visitors: visitorCount ?? 0, newOrders });
    } catch (err) {
      setError(t('home.loadError'));
      console.error(err);
    }
    setLoading(false);
  };

  const filtered = orders.filter(o => {
    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchSearch = !search || String(o.id).includes(search);
    return matchStatus && matchSearch;
  });

  if (loading) {
    return <div className="mh-root" dir={direction}><div className="md-page-loading">{t('home.loadingData')}</div></div>;
  }

  const isPending = !merchant?.shop?.status || merchant.shop.status === 'pending';
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';

  return (
    <div className="mh-root" dir={direction}>
      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      {/* ── Activation banner ── */}
      {isPending && merchant?.shop && (
        <div className="mh-activation-banner">
          <div className="mh-activation-icon">🚀</div>
          <div className="mh-activation-text">
            <strong>{t('home.activationBannerTitle')}</strong>
            <span>{t('home.activationBannerText')}</span>
          </div>
          <button
            type="button"
            className="mh-activation-btn"
            onClick={() => onNavigate?.('shopSettings', true)}
          >
            {t('home.completeSetup')}
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className="mh-stats">
        <div className="mh-stat-card mh-card-green">
          <div className="mh-card-top">
            <span className="mh-card-label">{t('home.statVisitors')}</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.visitors.toLocaleString(numLocale)}</div>
          <div className="mh-card-sub">{t('home.today')}</div>
        </div>

        <div className="mh-stat-card mh-card-blue">
          <div className="mh-card-top">
            <span className="mh-card-label">{t('home.statNewOrders')}</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 17H5a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2h-4" />
                <rect x="9" y="3" width="6" height="14" rx="1" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.newOrders.toLocaleString(numLocale)}</div>
          <div className="mh-card-sub">{t('home.today')}</div>
        </div>

        <div className="mh-stat-card mh-card-amber">
          <div className="mh-card-top">
            <span className="mh-card-label">{t('home.statAccountBalance')}</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.accountBalance.toLocaleString(numLocale)}</div>
          <div className="mh-card-sub">₪</div>
        </div>

        <div className="mh-stat-card mh-card-pink">
          <div className="mh-card-top">
            <span className="mh-card-label">{t('home.statUnpaidInvoices')}</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.unpaidTotal.toLocaleString(numLocale)}</div>
          <div className="mh-card-sub">{t('home.totalAmount')}</div>
        </div>
      </div>

      {/* ── Active Orders ── */}
      <div className="mh-orders-section">
        <div className="mh-orders-header">
          <select
            className="mh-status-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            title={t('home.filterByStatus')}
          >
            <option value="all">{t('home.allStatuses')}</option>
            <option value="pending">{t('orderStatus.pending')}</option>
            <option value="delivering">{t('orderStatus.delivering')}</option>
            <option value="completed">{t('orderStatus.completed')}</option>
            <option value="cancelled">{t('orderStatus.cancelled')}</option>
          </select>
          <h2 className="mh-orders-title">{t('home.activeOrdersTitle')}</h2>
        </div>

        <div className="mh-search-wrap">
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder={t('home.searchByOrderNumber')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mh-search-input"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="mh-orders-empty">{t('home.noOrders')}</div>
        ) : (
          <div className="mh-table-wrap">
            <table className="mh-table">
              <thead>
                <tr>
                  <th>{t('home.colOrderNumber')}</th>
                  <th>{t('home.colStatus')}</th>
                  <th>{t('home.colTotal')}</th>
                  <th>{t('home.colDate')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(order => {
                  const color = STATUS_COLOR[order.status] ?? '#6b7280';
                  const label = STATUS_COLOR[order.status] ? t(`orderStatus.${order.status}`) : order.status;
                  const date = new Date(order.createdAt).toLocaleDateString(numLocale, { month: 'short', day: 'numeric' });
                  return (
                    <tr key={order.id}>
                      <td className="mh-td-id">{fmt(order.id)}</td>
                      <td>
                        <span className="mh-badge" style={{ background: `${color}18`, color: color, borderColor: `${color}30` }}>
                          {label}
                        </span>
                      </td>
                      <td className="mh-td-total">₪{order.total.toLocaleString()}</td>
                      <td className="mh-td-date">{date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
