import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

interface Stats {
  unpaidTotal: number;
  accountBalance: number;
  newOrders: number;
}

interface RecentOrder {
  id: number;
  status: string;
  total: number;
  createdAt: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:    { label: 'تحضير',     color: '#f59e0b' },
  delivering: { label: 'الشحن',     color: '#0ea5e9' },
  completed:  { label: 'تم التسليم', color: '#16a34a' },
};

const fmt = (id: number) => `ORD-${String(id).padStart(3, '0')}`;

export default function MerchantHome({ onNavigate }: { onNavigate?: (page: string, highlight?: boolean) => void }) {
  const { merchant } = useMerchantAuth();
  const [stats, setStats] = useState<Stats>({ unpaidTotal: 0, accountBalance: 0, newOrders: 0 });
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

      setStats({ unpaidTotal, accountBalance, newOrders });
    } catch (err) {
      setError('تعذّر تحميل البيانات — تحقق من الاتصال');
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
    return <div className="mh-root"><div className="md-page-loading">جاري تحميل البيانات...</div></div>;
  }

  const isPending = !merchant?.shop?.status || merchant.shop.status === 'pending';

  return (
    <div className="mh-root">
      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      {/* ── Activation banner ── */}
      {isPending && merchant?.shop && (
        <div className="mh-activation-banner">
          <div className="mh-activation-icon">🚀</div>
          <div className="mh-activation-text">
            <strong>متجرك غير منشور بعد</strong>
            <span>أكمل إعداد ملفك واضغط "انشر المتجر" لتظهر للعملاء</span>
          </div>
          <button
            type="button"
            className="mh-activation-btn"
            onClick={() => onNavigate?.('shopSettings', true)}
          >
            إكمال الإعداد
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className="mh-stats">
        <div className="mh-stat-card mh-card-blue">
          <div className="mh-card-top">
            <span className="mh-card-label">طلبات جديدة</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 17H5a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2h-4" />
                <rect x="9" y="3" width="6" height="14" rx="1" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.newOrders.toLocaleString('en-US')}</div>
          <div className="mh-card-sub">اليوم</div>
        </div>

        <div className="mh-stat-card mh-card-amber">
          <div className="mh-card-top">
            <span className="mh-card-label">رصيد الحساب</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.accountBalance.toLocaleString('en-US')}</div>
          <div className="mh-card-sub">₪</div>
        </div>

        <div className="mh-stat-card mh-card-pink">
          <div className="mh-card-top">
            <span className="mh-card-label">الفواتير غير المدفوعة</span>
            <div className="mh-card-icon">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" />
              </svg>
            </div>
          </div>
          <div className="mh-card-value">{stats.unpaidTotal.toLocaleString('en-US')}</div>
          <div className="mh-card-sub">إجمالي المبلغ</div>
        </div>
      </div>

      {/* ── Active Orders ── */}
      <div className="mh-orders-section">
        <div className="mh-orders-header">
          <select
            className="mh-status-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            title="تصفية حسب الحالة"
          >
            <option value="all">كل الحالات</option>
            <option value="pending">تحضير</option>
            <option value="delivering">الشحن</option>
            <option value="completed">تم التسليم</option>
            <option value="cancelled">ملغي</option>
          </select>
          <h2 className="mh-orders-title">الطلبات النشطة</h2>
        </div>

        <div className="mh-search-wrap">
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="بحث برقم الطلب..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mh-search-input"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="mh-orders-empty">لا توجد طلبات</div>
        ) : (
          <div className="mh-table-wrap">
            <table className="mh-table">
              <thead>
                <tr>
                  <th>رقم الطلب</th>
                  <th>الحالة</th>
                  <th>الإجمالي</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(order => {
                  const s = STATUS_LABEL[order.status] ?? { label: order.status, color: '#6b7280' };
                  const date = new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric' });
                  return (
                    <tr key={order.id}>
                      <td className="mh-td-id">{fmt(order.id)}</td>
                      <td>
                        <span className="mh-badge" style={{ background: `${s.color}18`, color: s.color, borderColor: `${s.color}30` }}>
                          {s.label}
                        </span>
                      </td>
                      <td className="mh-td-total">₪{order.total.toLocaleString('en-US')}</td>
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
