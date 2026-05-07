import { useState, useEffect, useRef } from 'react';
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
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'مساء الخير';
  return 'مساء النور';
}

function formatDate(): string {
  return new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

function formatShiftTime(t: string | null): string {
  if (!t) return '--:--';
  return t.slice(0, 5);
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function isYesterday(iso: string): boolean {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  delivering:   { label: 'قيد التوصيل', color: '#2563eb' },
  consolidated: { label: 'قيد الانتظار', color: '#7c3aed' },
  completed:    { label: 'تم التسليم',  color: '#16a34a' },
  failed:       { label: 'فاشل',        color: '#dc2626' },
};

// ── SidebarItem (matches MerchantDashboard pattern) ───────────────────────

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`dd-sidebar-item${active ? ' dd-active' : ''}`} onClick={onClick}>
      <span className="dd-sidebar-item-icon">{icon}</span>
      <span className="dd-sidebar-item-label">{label}</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { name, rawUser } = useSharedAuth();
  const navigate = useNavigate();
  const avatarRef = useRef<HTMLDivElement>(null);

  const [driverInfo, setDriverInfo]             = useState<DriverInfo | null>(null);
  const [orders, setOrders]                     = useState<OrderRow[]>([]);
  const [yesterdayCount, setYesterdayCount]     = useState(0);
  const [avgDailyEarnings, setAvgDailyEarnings] = useState(0);
  const [loading, setLoading]                   = useState(true);
  const [statusFilter, setStatusFilter]         = useState('all');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu]     = useState(false);
  const [pendingNotifications, setPendingNotifications] = useState<PendingBatchNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel]     = useState(false);

  const initials       = getInitials(name ?? 'س');
  const displayInitial = initials.charAt(0);
  const greeting       = getGreeting();
  const today          = formatDate();

  // ── Close avatar menu on outside click ──────────────────────────────────
  useEffect(() => {
    if (!showAvatarMenu) return;
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setShowAvatarMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAvatarMenu]);

  // ── Fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!rawUser) return;
    fetchAll();
    loadPendingNotifications();
  }, [rawUser?.id]);

  // ── Realtime batch assignment notifications ──────────────────────────────
  useEffect(() => {
    if (!rawUser?.id) return;
    const channel = supabase
      .channel('driver-batch-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_notifications', filter: `courier_id=eq.${rawUser.id}` },
        async (payload) => {
          const batchId        = payload.new.batch_id as string;
          const notificationId = payload.new.id as string;
          const { data: batch } = await supabase
            .from('batches').select('route, total_volume, ab_shipment_ids').eq('id', batchId).single();
          if (!batch) return;
          setPendingNotifications((prev) => {
            if (prev.some((n) => n.notificationId === notificationId)) return prev;
            return [...prev, {
              notificationId, batchId,
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

  async function loadPendingNotifications() {
    if (!rawUser?.id) return;
    const { data: notifs } = await supabase
      .from('driver_notifications').select('id, batch_id').eq('courier_id', rawUser.id).eq('status', 'pending');
    if (!notifs?.length) return;
    const enriched = await Promise.all(
      notifs.map(async (n) => {
        const { data: batch } = await supabase
          .from('batches').select('route, total_volume, ab_shipment_ids').eq('id', n.batch_id).single();
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

  async function handleAcceptBatch(notif: PendingBatchNotification) {
    if (!rawUser?.id) return;
    await supabase.from('batch_acceptances').insert({ batch_id: notif.batchId, courier_id: rawUser.id });
    await supabase.from('driver_notifications').update({ status: 'accepted' }).eq('id', notif.notificationId);
    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
  }

  async function handleDeclineBatch(notifId: string) {
    await supabase.from('driver_notifications').update({ status: 'declined' }).eq('id', notifId);
    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notifId));
  }

  async function fetchAll() {
    setLoading(true);
    const { data: driverRow } = await supabase
      .from('drivers').select('driver_id, shift_start, shift_end, zone, is_available')
      .eq('user_id', rawUser!.id).maybeSingle();
    if (driverRow) setDriverInfo(driverRow as DriverInfo);

    if (rawUser?.id && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        supabase.from('drivers')
          .update({ current_lat: pos.coords.latitude, current_lng: pos.coords.longitude })
          .eq('user_id', rawUser.id).then(() => {});
      });
    }

    const driverId = driverRow?.driver_id ?? null;
    let orderIds: number[] = [];

    if (driverId) {
      const { data: batchRows } = await supabase
        .from('batches').select('id, assigned_driver_id, status').eq('assigned_driver_id', driverId);
      const batchIds = (batchRows ?? []).map((b) => b.id as number);
      if (batchIds.length) {
        const { data: odRows } = await supabase
          .from('order_details').select('order_id, batch_id').in('batch_id', batchIds);
        orderIds = [...new Set((odRows ?? []).map((r) => r.order_id as number))];
      }
    }

    let rawOrders: any[] = [];
    if (orderIds.length) {
      const { data } = await supabase
        .from('orders').select('id, status, total_price, created_at, delivery_address, user_id')
        .in('id', orderIds).order('created_at', { ascending: false }).limit(50);
      rawOrders = data ?? [];
    }

    await hydrateOrders(rawOrders);

    const yOrders = rawOrders.filter((o) => isYesterday(o.created_at) && o.status === 'completed');
    setYesterdayCount(yOrders.length);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30 = rawOrders.filter((o) => o.status === 'completed' && new Date(o.created_at) >= thirtyDaysAgo);
    if (last30.length > 0) {
      const totalEarnings30 = last30.reduce((s: number, o: any) => s + (o.total_price ?? 0), 0);
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

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const todayOrders   = orders.filter((o) => isToday(o.created_at));
  const delivered     = todayOrders.filter((o) => o.status === 'completed').length;
  const inTransit     = orders.filter((o) => o.status === 'delivering').length;
  const todayEarnings = todayOrders.filter((o) => o.status === 'completed').reduce((s, o) => s + (o.total_price ?? 0), 0);
  const deliveryRate  = todayOrders.length ? Math.round((delivered / todayOrders.length) * 100) : 0;

  const shiftLabel  = driverInfo ? `${formatShiftTime(driverInfo.shift_start)} – ${formatShiftTime(driverInfo.shift_end)}` : '--:-- – --:--';
  const zoneLabel   = driverInfo?.zone ?? '—';
  const dutyLabel   = driverInfo ? (driverInfo.is_available ? 'في الخدمة' : 'خارج الخدمة') : '—';

  const filteredOrders = statusFilter === 'all' ? orders : orders.filter((o) => o.status === statusFilter);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="dd-root">

      {/* ── Topbar ── */}
      <header className="dd-topbar">
        <div className="dd-topbar-brand" onClick={() => navigate('/')}>
          <img src="/logo.png" alt="سوق لينك" className="dd-topbar-logo" />
          <div className="dd-topbar-brand-text">سوق <span>لينك</span></div>
        </div>

        <div className="dd-topbar-actions">
          {/* Notification bell */}
          <div className="dd-notif-bell-wrap">
            <button
              type="button"
              className="dd-topbar-bell"
              aria-label="الإشعارات"
              onClick={() => setShowNotifPanel((v) => !v)}
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {pendingNotifications.length > 0 && (
                <span className="dd-notif-dot">{pendingNotifications.length}</span>
              )}
            </button>

            {showNotifPanel && (
              <div className="dd-notif-panel">
                <div className="dd-notif-panel-header">الإشعارات</div>
                {pendingNotifications.length > 0 ? (
                  pendingNotifications.map((notif) => (
                    <div key={notif.notificationId} className="dd-notif-panel-item">
                      <div className="dd-notif-panel-icon">
                        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8l4 2v5h-4V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                        </svg>
                      </div>
                      <div className="dd-notif-panel-body">
                        <p className="dd-notif-panel-title">طلب توصيل جديد</p>
                        <p className="dd-notif-panel-route">{notif.route.join(' ← ')}</p>
                        <p className="dd-notif-panel-meta">{notif.shipmentCount} شحنة · {notif.totalVolume.toFixed(0)} وحدة</p>
                        <div className="dd-notif-panel-actions">
                          <button className="dd-notif-btn accept" onClick={() => handleAcceptBatch(notif)}>قبول</button>
                          <button className="dd-notif-btn decline" onClick={() => handleDeclineBatch(notif.notificationId)}>رفض</button>
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

          {/* Avatar dropdown */}
          <div className="dd-avatar-wrapper" ref={avatarRef}>
            <div
              className={`dd-topbar-avatar${showAvatarMenu ? ' dd-avatar-active' : ''}`}
              title={name ?? 'السائق'}
              onClick={() => setShowAvatarMenu((v) => !v)}
            >
              {displayInitial}
            </div>
            {showAvatarMenu && (
              <div className="dd-avatar-menu">
                <div className="dd-avatar-menu-header">
                  <div className="dd-avatar-menu-name">{name ?? 'السائق'}</div>
                  <div className="dd-avatar-menu-role">SOUQ LINK Driver</div>
                </div>
                <button
                  type="button"
                  className="dd-avatar-menu-item"
                  onClick={() => { setShowChangePassword(true); setShowAvatarMenu(false); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  تغيير كلمة المرور
                </button>
                <button
                  type="button"
                  className="dd-avatar-menu-item dd-avatar-menu-logout"
                  onClick={() => { setShowAvatarMenu(false); handleLogout(); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="dd-body">

        {/* ── Sidebar ── */}
        <aside className="dd-sidebar">
          <div className="dd-sidebar-greeting">
            <div className="dd-sidebar-greeting-name">{greeting}، <strong>{name ?? 'السائق'}</strong></div>
            <div className="dd-sidebar-greeting-date">{today}</div>
          </div>

          <nav className="dd-sidebar-nav">
            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              label="الرئيسية"
              active={true}
              onClick={() => navigate('/driver-dashboard')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <path d="M16 8l4 2v5h-4V8z" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              }
              label="طلباتي"
              active={false}
              onClick={() => navigate('/deliverer')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <polyline points="12 12 16 14" />
                </svg>
              }
              label="وردياتي"
              active={false}
              onClick={() => {}}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              label="الأرباح"
              active={false}
              onClick={() => {}}
            />

            <div className="dd-sidebar-divider" />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              }
              label="خريطة المسار"
              active={false}
              onClick={() => navigate('/driver-route')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
              label="التقييمات"
              active={false}
              onClick={() => {}}
            />
          </nav>

          {/* Sidebar footer */}
          <div className="dd-sidebar-footer">
            <div className="dd-sidebar-user">
              <div className="dd-sidebar-user-avatar">{displayInitial}</div>
              <div className="dd-sidebar-user-info">
                <div className="dd-sidebar-user-name">{name ?? 'السائق'}</div>
                <div className="dd-sidebar-user-role">
                  <span className={`dd-duty-dot${driverInfo?.is_available ? '' : ' dd-duty-dot-off'}`} />
                  {dutyLabel}
                </div>
              </div>
            </div>
            <button type="button" className="dd-sidebar-logout" onClick={handleLogout}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              تسجيل الخروج
            </button>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main className="dd-content">

          {/* ── Shift info banner ── */}
          <div className="dd-shift-banner">
            <div className="dd-shift-item">
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><polyline points="12 12 16 14" />
              </svg>
              الوردية: {shiftLabel}
            </div>
            <div className="dd-shift-item">
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              المنطقة: {zoneLabel}
            </div>
          </div>

          {/* ── Stats Cards ── */}
          <div className="dd-stats-grid">

            <div className="dd-stat-card">
              <div className="dd-card-top">
                <span className="dd-card-label">إجمالي التوصيلات</span>
                <div className="dd-card-icon dd-icon-green">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="1" y="3" width="15" height="13" rx="2" />
                    <path d="M16 8l4 2v5h-4V8z" />
                    <circle cx="5.5" cy="18.5" r="2.5" />
                    <circle cx="18.5" cy="18.5" r="2.5" />
                  </svg>
                </div>
              </div>
              <div className="dd-card-value">{orders.filter(o => o.status === 'completed').length.toLocaleString('ar-EG')}</div>
              <div className="dd-card-sub">إجمالي المكتملة</div>
            </div>

            <div className="dd-stat-card">
              <div className="dd-card-top">
                <span className="dd-card-label">أرباح اليوم</span>
                <div className="dd-card-icon dd-icon-amber">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
              </div>
              <div className="dd-card-value">{todayEarnings.toLocaleString('ar-EG')}</div>
              <div className="dd-card-sub">جنيه مصري</div>
            </div>

            <div className="dd-stat-card">
              <div className="dd-card-top">
                <span className="dd-card-label">قيد التوصيل</span>
                <div className="dd-card-icon dd-icon-blue">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
              </div>
              <div className="dd-card-value">{inTransit.toLocaleString('ar-EG')}</div>
              <div className="dd-card-sub">نشطة الآن</div>
            </div>

            <div className="dd-stat-card">
              <div className="dd-card-top">
                <span className="dd-card-label">معدل التسليم</span>
                <div className="dd-card-icon dd-icon-pink">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </div>
              </div>
              <div className="dd-card-value">{deliveryRate}</div>
              <div className="dd-card-sub">% من طلبات اليوم</div>
            </div>

          </div>

          {/* ── Active Orders ── */}
          <div className="dd-orders-section">
            <div className="dd-orders-header">
              <select
                className="dd-status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">كل الحالات</option>
                <option value="delivering">قيد التوصيل</option>
                <option value="consolidated">قيد الانتظار</option>
                <option value="completed">تم التسليم</option>
                <option value="failed">فاشل</option>
              </select>
              <h2 className="dd-orders-title">الطلبات النشطة</h2>
            </div>

            <div className="dd-orders-actions">
              <Link to="/deliverer" className="dd-view-all-link">← عرض جميع الطلبات</Link>
            </div>

            {loading ? (
              <div className="dd-orders-empty">جاري تحميل الطلبات...</div>
            ) : filteredOrders.length === 0 ? (
              <div className="dd-orders-empty">لا توجد طلبات</div>
            ) : (
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>رقم الطلب</th>
                      <th>العميل</th>
                      <th>عنوان التوصيل</th>
                      <th>الحالة</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const s = STATUS_LABEL[order.status] ?? { label: order.status, color: '#6b7280' };
                      return (
                        <tr key={order.id}>
                          <td className="dd-td-id">#SL-{order.id}</td>
                          <td>{order.customer_name}</td>
                          <td className="dd-td-address">{order.delivery_address ?? '—'}</td>
                          <td>
                            <span
                              className="dd-badge"
                              style={{ background: `${s.color}18`, color: s.color, borderColor: `${s.color}30` }}
                            >
                              {s.label}
                            </span>
                          </td>
                          <td className="dd-td-time">{formatTime(order.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
