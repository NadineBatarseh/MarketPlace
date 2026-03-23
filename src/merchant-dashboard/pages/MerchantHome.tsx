import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

interface Stats {
  unpaidTotal: number;
  accountBalance: number;
  visitors: number;
}

export default function MerchantHome() {
  const { merchant } = useMerchantAuth();
  const [stats, setStats] = useState<Stats>({ unpaidTotal: 0, accountBalance: 0, visitors: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const shopId = merchant?.shop?.shop_id;
    if (!shopId) { setLoading(false); return; }
    loadStats(shopId);
  }, [merchant?.shop?.shop_id]);

  const loadStats = async (shopId: string) => {
    setLoading(true);
    setError('');
    try {
      // 1. Total visitor count
      const { count: visitorCount, error: visErr } = await supabase
        .from('Store_visitors')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', shopId);
      if (visErr) throw visErr;

      // 2. Get all order IDs linked to this shop via orders_details
      const { data: detailRows, error: detErr } = await supabase
        .from('order_details')
        .select('order_id')
        .eq('shop_id', shopId);
      if (detErr) throw detErr;

      const orderIds = [...new Set((detailRows ?? []).map(r => r.order_id as number))];

      let unpaidTotal = 0;
      let accountBalance = 0;

      if (orderIds.length > 0) {
        const PENDING_STATUSES = ['pending', 'at_hub', 'pending_collection'];

        // 3. Sum total_price for unpaid orders
        const { data: unpaidOrders, error: upErr } = await supabase
          .from('orders')
          .select('total_price')
          .in('id', orderIds)
          .in('status', PENDING_STATUSES);
        if (upErr) throw upErr;
        unpaidTotal = (unpaidOrders ?? []).reduce((s, o) => s + (Number(o.total_price) || 0), 0);

        // 4. Sum total_price for paid orders (account balance)
        const { data: paidOrders, error: pdErr } = await supabase
          .from('orders')
          .select('total_price')
          .in('id', orderIds)
          .not('status', 'in', `(${PENDING_STATUSES.join(',')})`);
        if (pdErr) throw pdErr;
        accountBalance = (paidOrders ?? []).reduce((s, o) => s + (Number(o.total_price) || 0), 0);
      }

      setStats({ unpaidTotal, accountBalance, visitors: visitorCount ?? 0 });
    } catch (err: unknown) {
      setError('تعذّر تحميل الإحصائيات — تحقق من الاتصال');
      console.error(err);
    }
    setLoading(false);
  };

  const storeName = merchant?.shop?.name ?? merchant?.displayName ?? 'متجرك';

  if (loading) {
    return (
      <div className="mh-root">
        <h1 className="mh-title">نظرة عامة — {storeName}</h1>
        <div className="md-page-loading">جاري تحميل البيانات...</div>
      </div>
    );
  }

  if (!merchant?.shop) {
    return (
      <div className="mh-root">
        <h1 className="mh-title">نظرة عامة</h1>
        <div className="md-page-empty">لم تقم بإنشاء متجرك بعد — انقر على زر "أنشئ صفحتك" في الأعلى.</div>
      </div>
    );
  }

  return (
    <div className="mh-root">
      <h1 className="mh-title">نظرة عامة — {storeName}</h1>

      {error && <div className="md-page-error">{error}</div>}

      <div className="mh-stats">
        <div className="mh-stat-card">
          <div className="mh-stat-icon red">🧾</div>
          <div className="mh-stat-label">إجمالي الفواتير غير المدفوعة</div>
          <div className="mh-stat-value">{stats.unpaidTotal.toLocaleString('ar-EG')}</div>
          <div className="mh-stat-unit">جنيه مصري</div>
        </div>

        <div className="mh-stat-card">
          <div className="mh-stat-icon green">💰</div>
          <div className="mh-stat-label">رصيد الحساب</div>
          <div className="mh-stat-value">{stats.accountBalance.toLocaleString('ar-EG')}</div>
          <div className="mh-stat-unit">جنيه مصري</div>
        </div>

        <div className="mh-stat-card">
          <div className="mh-stat-icon blue">👥</div>
          <div className="mh-stat-label">زوار المتجر على المنصة</div>
          <div className="mh-stat-value">{stats.visitors.toLocaleString('ar-EG')}</div>
          <div className="mh-stat-unit">زيارة حتى الآن</div>
        </div>
      </div>
    </div>
  );
}
