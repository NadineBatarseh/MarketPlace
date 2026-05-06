import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import './DriverDashboard.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface PendingBatchNotification {
  notificationId: string;
  batchId: string;
  route: string[];
  shipmentCount: number;
  totalVolume: number;
}

interface DriverInfo {
  driver_id: number;
  shift_start: string | null;
  shift_end: string | null;
  zone: string | null;
  is_available: boolean;
}

interface OrderRow {
  id: number;
  status: string;
  total_price: number | null;
  created_at: string;
  delivery_address: string | null;
  customer_name: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'مساء الخير';
  return 'مساء النور';
}

function formatDate(): string {
  return new Date().toLocaleDateString('ar-SA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

function formatShiftTime(t: string | null): string {
  if (!t) return '--:--';
  // t comes as "HH:MM:SS" or "HH:MM"
  return t.slice(0, 5);
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
         d.getMonth()    === n.getMonth()    &&
         d.getDate()     === n.getDate();
}

function isYesterday(iso: string): boolean {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() &&
         d.getMonth()    === y.getMonth()    &&
         d.getDate()     === y.getDate();
}

const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f97316',
  '#14b8a6','#0ea5e9','#84cc16','#f59e0b',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'delivering':   return { label: 'قيد التوصيل', cls: 'in-transit' };
    case 'consolidated': return { label: 'قيد الانتظار', cls: 'pending' };
    case 'completed':    return { label: 'تم التسليم',   cls: 'delivered' };
    case 'failed':       return { label: 'فاشل',         cls: 'failed' };
    default:             return { label: status,         cls: 'pending' };
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { name, rawUser } = useSharedAuth();
  const navigate = useNavigate();

  const [driverInfo, setDriverInfo]   = useState<DriverInfo | null>(null);
  const [orders, setOrders]           = useState<OrderRow[]>([]);
  const [yesterdayCount, setYesterdayCount] = useState(0);
  const [avgDailyEarnings, setAvgDailyEarnings] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pendingNotifications, setPendingNotifications] = useState<PendingBatchNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const initials = getInitials(name ?? 'م');
  const greeting = getGreeting();
  const dateStr  = formatDate();

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rawUser) return;
    fetchAll();
    loadPendingNotifications();
  }, [rawUser?.id]);

  // ── Load existing pending notifications from DB ───────────────────────────
  async function loadPendingNotifications() {
    if (!rawUser?.id) return;

    const { data: notifs } = await supabase
      .from('driver_notifications')
      .select('id, batch_id')
      .eq('courier_id', rawUser.id)
      .eq('status', 'pending');

    if (!notifs?.length) return;

    const enriched = await Promise.all(
      notifs.map(async (n) => {
        const { data: batch } = await supabase
          .from('batches')
          .select('route, total_volume, ab_shipment_ids')
          .eq('id', n.batch_id)
          .single();
        return {
          notificationId: n.id as string,
          batchId:        n.batch_id as string,
          route:          (batch?.route as string[]) ?? [],
          shipmentCount:  (batch?.ab_shipment_ids as string[])?.length ?? 0,
          totalVolume:    batch?.total_volume ?? 0,
        };
      })
    );

    setPendingNotifications(enriched);
  }

  // ── Realtime: listen for incoming batch assignments ────────────────────────
  useEffect(() => {
    if (!rawUser?.id) return;

    const channel = supabase
      .channel('driver-batch-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'driver_notifications',
          filter: `courier_id=eq.${rawUser.id}`,
        },
        async (payload) => {
          const batchId        = payload.new.batch_id as string;
          const notificationId = payload.new.id as string;

          const { data: batch } = await supabase
            .from('batches')
            .select('route, total_volume, ab_shipment_ids')
            .eq('id', batchId)
            .single();

          if (!batch) return;

          setPendingNotifications((prev) => {
            if (prev.some((n) => n.notificationId === notificationId)) return prev;
            return [...prev, {
              notificationId,
              batchId,
              route:         (batch.route as string[]) ?? [],
              shipmentCount: (batch.ab_shipment_ids as string[])?.length ?? 0,
              totalVolume:   batch.total_volume ?? 0,
            }];
          });
          setShowNotifPanel(true);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [rawUser?.id]);

  async function handleAcceptBatch(notif: PendingBatchNotification) {
    if (!rawUser?.id) return;
    await supabase.from('batch_acceptances').insert({
      batch_id:   notif.batchId,
      courier_id: rawUser.id,
    });
    await supabase
      .from('driver_notifications')
      .update({ status: 'accepted' })
      .eq('id', notif.notificationId);
    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
  }

  async function handleDeclineBatch(notifId: string) {
    await supabase
      .from('driver_notifications')
      .update({ status: 'declined' })
      .eq('id', notifId);
    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notifId));
  }

  async function fetchAll() {
    setLoading(true);

    // 1. Get driver row by user_id (reliable — not by name)
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('driver_id, shift_start, shift_end, zone, is_available')
      .eq('user_id', rawUser!.id)
      .maybeSingle();

    if (driverRow) setDriverInfo(driverRow as DriverInfo);

    // Persist driver location so the assignment algorithm can find this driver
    if (rawUser?.id && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        supabase
          .from("drivers")
          .update({ current_lat: pos.coords.latitude, current_lng: pos.coords.longitude })
          .eq("user_id", rawUser.id)
          .then(({ error: locErr }) => {
            if (locErr) console.error("[DriverDashboard] failed to update driver location:", locErr.message);
          });
      });
    }

    const driverId = driverRow?.driver_id ?? null;
    console.log('[DD] step1 driverRow:', driverRow, '| rawUser.id:', rawUser!.id);

    // 2. Get batch IDs from batches table
    let orderIds: number[] = [];

    if (driverId) {
      const { data: batchRows, error: batchErr } = await supabase
        .from('batches')
        .select('id, assigned_driver_id, status')
        .eq('assigned_driver_id', driverId);

      console.log('[DD] step2 batches:', batchRows, '| err:', batchErr);

      const batchIds = (batchRows ?? []).map((b) => b.id as number);
      console.log('[DD] step2b batchIds:', batchIds, '| types:', batchIds.map(x => typeof x));

      if (batchIds.length) {
        // Check what's actually in order_details (first 10 rows, no filter)
        const { data: sampleOd } = await supabase
          .from('order_details')
          .select('id, order_id, batch_id')
          .limit(10);
        console.log('[DD] step3a order_details sample (no filter):', sampleOd);

        const { data: odRows, error: odErr } = await supabase
          .from('order_details')
          .select('order_id, batch_id')
          .in('batch_id', batchIds);

        console.log('[DD] step3b order_details filtered:', odRows, '| err:', odErr);
        orderIds = [...new Set((odRows ?? []).map((r) => r.order_id as number))];
      }
    }

    console.log('[DD] step4 orderIds:', orderIds);

    // 4. Fetch the actual orders
    let rawOrders: any[] = [];
    if (orderIds.length) {
      const { data, error: ordErr } = await supabase
        .from('orders')
        .select('id, status, total_price, created_at, delivery_address, user_id')
        .in('id', orderIds)
        .order('created_at', { ascending: false })
        .limit(50);
      console.log('[DD] step5 orders:', data, '| err:', ordErr);
      rawOrders = data ?? [];
    }

    // 4. Hydrate customer names
    await hydrateOrders(rawOrders);

    // 5. Yesterday's completed orders count (for comparison)
    const yOrders = rawOrders.filter((o) => isYesterday(o.created_at) && o.status === 'completed');
    setYesterdayCount(yOrders.length);

    // 6. Average daily earnings over last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const last30 = rawOrders.filter(
      (o) => o.status === 'completed' && new Date(o.created_at) >= thirtyDaysAgo
    );

    if (last30.length > 0) {
      const totalEarnings30 = last30.reduce((s: number, o: any) => s + (o.total_price ?? 0), 0);
      // Group by day to get daily average
      const daySet = new Set(last30.map((o: any) => o.created_at.slice(0, 10)));
      setAvgDailyEarnings(totalEarnings30 / Math.max(daySet.size, 1));
    }

    setLoading(false);
  }

  async function hydrateOrders(rawOrders: any[]) {
    if (!rawOrders.length) { setOrders([]); return; }

    const userIds = [...new Set(rawOrders.map((o) => o.user_id).filter(Boolean))];
    const { data: users } = userIds.length
      ? await supabase.from('Users').select('user_id, name').in('user_id', userIds)
      : { data: [] as any[] };

    const nameMap = new Map((users ?? []).map((u: any) => [u.user_id, u.name as string]));

    setOrders(rawOrders.map((o) => ({
      id:               o.id,
      status:           o.status,
      total_price:      o.total_price,
      created_at:       o.created_at,
      delivery_address: o.delivery_address ?? null,
      customer_name:    nameMap.get(o.user_id) ?? 'عميل',
    })));
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const todayOrders   = orders.filter((o) => isToday(o.created_at));
  const delivered     = todayOrders.filter((o) => o.status === 'completed').length;
  const inTransit     = orders.filter((o) => o.status === 'delivering').length;
  const todayEarnings = todayOrders
    .filter((o) => o.status === 'completed')
    .reduce((s, o) => s + (o.total_price ?? 0), 0);
  const deliveryRate  = todayOrders.length
    ? Math.round((delivered / todayOrders.length) * 100)
    : 0;

  const earningsDiff  = avgDailyEarnings > 0
    ? Math.round(((todayEarnings - avgDailyEarnings) / avgDailyEarnings) * 100)
    : null;

  const todayVsYesterday = todayOrders.length - yesterdayCount;

  // ── Filtered orders ────────────────────────────────────────────────────────
  const filteredOrders = statusFilter === 'all'
    ? orders
    : orders.filter((o) => o.status === statusFilter);

  // ── Logout ────────────────────────────────────────────────────────────────
  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const shiftLabel = driverInfo
    ? `${formatShiftTime(driverInfo.shift_start)} – ${formatShiftTime(driverInfo.shift_end)}`
    : '--:-- – --:--';

  const zoneLabel = driverInfo?.zone ?? '—';

  const dutyLabel = driverInfo
    ? (driverInfo.is_available ? 'في الخدمة' : 'خارج الخدمة')
    : '—';

  const dutyClass = driverInfo?.is_available ? 'dd-status-dot' : 'dd-status-dot off-duty';

  return (
    <div className="dd-root">

      {/* ── Sidebar ── */}
      <aside className="dd-sidebar">

        <div className="dd-sidebar-logo">
          <div className="dd-sidebar-logo-icon">س</div>
          <div className="dd-sidebar-logo-text">
            <span>سوق لينك</span>
            <span>توصيل</span>
          </div>
        </div>

        <div className="dd-sidebar-profile">
          <div className="dd-avatar" style={{ '--dd-avatar-bg': avatarColor(name ?? 'م') } as React.CSSProperties}>
            {initials}
          </div>
          <div className="dd-avatar-info">
            <span className="dd-avatar-name">{name ?? 'السائق'}</span>
            <span className={dutyClass}>{dutyLabel}</span>
          </div>
        </div>

        <nav className="dd-nav">
          <span className="dd-nav-section-label">الرئيسية</span>

          <span className="dd-nav-item active">
            <span className="dd-nav-icon">⊞</span>
            لوحة التحكم
          </span>

          <Link className="dd-nav-item" to="/deliverer">
            <span className="dd-nav-icon">≡</span>
            طلباتي
            {inTransit > 0 && <span className="dd-nav-badge">{inTransit}</span>}
          </Link>

          <Link className="dd-nav-item" to="/driver-route">
            <span className="dd-nav-icon">◎</span>
            خريطة المسار
          </Link>

          <span className="dd-nav-item">
            <span className="dd-nav-icon">▤</span>
            السجل
          </span>

          <span className="dd-nav-section-label">الأداء</span>

          <span className="dd-nav-item">
            <span className="dd-nav-icon">↑↓</span>
            الأرباح
          </span>

          <span className="dd-nav-item">
            <span className="dd-nav-icon">☆</span>
            التقييمات
          </span>
        </nav>

        <div className="dd-sidebar-footer">
          <span className="dd-nav-item">
            <span className="dd-nav-icon">👤</span>
            الملف الشخصي
          </span>
          <button type="button" className="dd-nav-item" onClick={() => setShowChangePassword(true)}>
            <span className="dd-nav-icon">🔑</span>
            تغيير كلمة المرور
          </button>
          <button type="button" className="dd-nav-item" onClick={handleLogout}>
            <span className="dd-nav-icon">⏻</span>
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="dd-main">

        <header className="dd-header">
          <div className="dd-header-right">
            <div className="dd-shift-badge">⏰ الوردية: {shiftLabel}</div>
            <div className="dd-notif-bell-wrap">
              <button
                type="button"
                className="dd-icon-btn"
                onClick={() => setShowNotifPanel((v) => !v)}
              >
                🔔
                {pendingNotifications.length > 0 && <span className="dd-notif-badge">{pendingNotifications.length}</span>}
              </button>

              {showNotifPanel && (
                <div className="dd-notif-panel">
                  <div className="dd-notif-panel-header">الإشعارات</div>
                  {pendingNotifications.length > 0 ? (
                    pendingNotifications.map((notif) => (
                      <div key={notif.notificationId} className="dd-notif-panel-item">
                        <div className="dd-notif-panel-icon">🚚</div>
                        <div className="dd-notif-panel-body">
                          <p className="dd-notif-panel-title">طلب توصيل جديد</p>
                          <p className="dd-notif-panel-route">
                            {notif.route.join(' ← ')}
                          </p>
                          <p className="dd-notif-panel-meta">
                            {notif.shipmentCount} شحنة · {notif.totalVolume.toFixed(0)} وحدة
                          </p>
                          <div className="dd-notif-panel-actions">
                            <button className="dd-notif-btn accept" onClick={() => handleAcceptBatch(notif)}>✓ قبول</button>
                            <button className="dd-notif-btn decline" onClick={() => handleDeclineBatch(notif.notificationId)}>✕ رفض</button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="dd-notif-panel-empty">لا توجد إشعارات</p>
                  )}
                </div>
              )}
            </div>
            <div className="dd-header-avatar" style={{ '--dd-avatar-bg': avatarColor(name ?? 'م') } as React.CSSProperties}>
              {initials}
            </div>
          </div>
          <div className="dd-header-left">
            <h1>{greeting}، {name ?? 'السائق'} 👋</h1>
            <p>{dateStr} · {zoneLabel}</p>
          </div>
        </header>

        <div className="dd-content">

          {/* ── Stats ── */}
          <div className="dd-stats">

            <div className="dd-stat-card">
              <div className="dd-stat-icon-dark">≡</div>
              <span className="dd-stat-label">طلبات اليوم</span>
              <span className="dd-stat-value">{todayOrders.length}</span>
              <span className="dd-stat-sub dd-stat-sub-light">
                {todayOrders.length > 0 ? (
                  <>
                    <span className={todayVsYesterday >= 0 ? 'dd-arrow-up' : 'dd-arrow-down'}>
                      {todayVsYesterday >= 0 ? '▲' : '▼'}
                    </span>
                    {' '}مقابل {yesterdayCount} أمس
                  </>
                ) : 'لا توجد طلبات اليوم'}
              </span>
            </div>

            <div className="dd-stat-card">
              <div className="dd-stat-icon green">✓</div>
              <span className="dd-stat-label">تم التسليم</span>
              <span className="dd-stat-value">{delivered}</span>
              <span className="dd-stat-sub up">
                <span className="dd-arrow-up">↑</span> معدل {deliveryRate}%
              </span>
            </div>

            <div className="dd-stat-card">
              <div className="dd-stat-icon amber">⏱</div>
              <span className="dd-stat-label">قيد التوصيل</span>
              <span className="dd-stat-value">{inTransit}</span>
              <span className="dd-stat-sub live">
                {inTransit > 0
                  ? <><span className="dd-dot-live">●</span> نشط</>
                  : 'لا يوجد نشط'}
              </span>
            </div>

            <div className="dd-stat-card">
              <div className="dd-stat-icon gold">★</div>
              <span className="dd-stat-label">أرباح اليوم</span>
              <span className="dd-stat-value">₪{todayEarnings.toFixed(0)}</span>
              <span className="dd-stat-sub up">
                {earningsDiff !== null ? (
                  <>
                    <span className={earningsDiff >= 0 ? 'dd-arrow-up' : 'dd-arrow-down'}>
                      {earningsDiff >= 0 ? '▲' : '▼'}
                    </span>
                    {' '}{Math.abs(earningsDiff)}% من المتوسط
                  </>
                ) : 'لا توجد بيانات سابقة'}
              </span>
            </div>
          </div>

          {/* ── Active Orders ── */}
          <div className="dd-orders-card">
            <div className="dd-orders-header">
              <h2 className="dd-orders-title">الطلبات النشطة</h2>
              <div className="dd-orders-header-right">
                <select
                  className="dd-status-filter"
                  aria-label="تصفية حسب الحالة"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">كل الحالات</option>
                  <option value="delivering">قيد التوصيل</option>
                  <option value="consolidated">قيد الانتظار</option>
                  <option value="completed">تم التسليم</option>
                  <option value="failed">فاشل</option>
                </select>
                <Link className="dd-view-all" to="/deliverer">← عرض الكل</Link>
              </div>
            </div>

            {loading ? (
              <div className="dd-loading">جاري تحميل الطلبات…</div>
            ) : filteredOrders.length === 0 ? (
              <div className="dd-empty">لا توجد طلبات</div>
            ) : (
              <table className="dd-orders-table">
                <thead>
                  <tr>
                    <th>رقم الطلب</th>
                    <th>العميل</th>
                    <th>العنوان</th>
                    <th>الحالة</th>
                    <th>الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const badge        = statusBadge(o.status);
                    const custInitials = getInitials(o.customer_name);
                    return (
                      <tr key={o.id}>
                        <td><span className="dd-order-id">#SL-{o.id}</span></td>
                        <td>
                          <div className="dd-customer">
                            <div
                              className="dd-customer-avatar"
                              style={{ '--dd-avatar-bg': avatarColor(o.customer_name) } as React.CSSProperties}
                            >
                              {custInitials}
                            </div>
                            {o.customer_name}
                          </div>
                        </td>
                        <td>
                          <span className="dd-address">
                            {o.delivery_address ?? '—'}
                          </span>
                        </td>
                        <td>
                          <span className={`dd-badge ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td><span className="dd-time">{formatTime(o.created_at)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

    </div>
  );
}
