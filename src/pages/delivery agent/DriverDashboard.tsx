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
  isAccepted: boolean;
}

interface DriverInfo {
  id: string;
  home_base_zone: string | null;
  status: 'available' | 'on_route' | 'offline';
}

interface BatchRow {
  id: string;
  route: string[];
  status: string;
  totalVolume: number;
  shipmentCount: number;
  assignedAt: string | null;
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


function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}


const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_assignment: { label: 'في انتظار التخصيص', color: '#f59e0b' },
  assigned:           { label: 'مخصصة',             color: '#2563eb' },
  in_transit:         { label: 'قيد التوصيل',       color: '#7c3aed' },
  completed:          { label: 'مكتملة',             color: '#16a34a' },
  cancelled:          { label: 'ملغاة',              color: '#dc2626' },
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
  const [batches, setBatches]                   = useState<BatchRow[]>([]);

  const [loading, setLoading]                   = useState(true);
  const [statusFilter, setStatusFilter]         = useState('all');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu]     = useState(false);
  const [pendingNotifications, setPendingNotifications] = useState<PendingBatchNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel]     = useState(false);
  const [unreadCount, setUnreadCount]           = useState(0);

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
            setUnreadCount((c) => c + 1);
            return [...prev, {
              notificationId, batchId,
              route:         (batch.route as string[]) ?? [],
              shipmentCount: (batch.ab_shipment_ids as string[])?.length ?? 0,
              totalVolume:   batch.total_volume ?? 0,
              isAccepted:    false,
            }];
          });
          setShowNotifPanel(true);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'driver_notifications', filter: `courier_id=eq.${rawUser.id}` },
        (payload) => {
          const notificationId = payload.new.id as string;
          const isAccepted     = payload.new.is_accepted as boolean;
          setPendingNotifications((prev) =>
            prev.map((n) => n.notificationId === notificationId ? { ...n, isAccepted } : n)
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rawUser?.id]);

  async function loadPendingNotifications() {
    if (!rawUser?.id) return;
    const { data: notifs } = await supabase
      .from('driver_notifications').select('id, batch_id, is_accepted').eq('courier_id', rawUser.id);
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
          isAccepted:     n.is_accepted as boolean,
        };
      })
    );
    setPendingNotifications(enriched);
    const seenIds: string[] = JSON.parse(localStorage.getItem(`dd_seen_notifs_${rawUser.id}`) ?? '[]');
    const seenSet = new Set(seenIds);
    setUnreadCount(enriched.filter((n) => !seenSet.has(n.notificationId)).length);
  }

  async function handleAcceptBatch(notif: PendingBatchNotification) {
    if (!rawUser?.id) return;

    // Atomic assignment — same guard the backend uses: only succeeds if batch is still pending_assignment
    const { data } = await supabase
      .from('batches')
      .update({ status: 'assigned', assigned_to: rawUser.id, assigned_at: new Date().toISOString() })
      .eq('id', notif.batchId)
      .eq('status', 'pending_assignment')
      .select('id');

    const won = Array.isArray(data) && data.length > 0;

    if (won) {
      // Flip ALL notifications for this batch so every other notified driver sees "taken"
      await supabase
        .from('driver_notifications')
        .update({ is_accepted: true })
        .eq('batch_id', notif.batchId);
    } else {
      // Someone else already took it — disable just this driver's button
      await supabase
        .from('driver_notifications')
        .update({ is_accepted: true })
        .eq('id', notif.notificationId);
    }

    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
  }

  async function handleDeclineBatch(notifId: string) {
    await supabase.from('driver_notifications').delete().eq('id', notifId);
    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notifId));
  }

  async function fetchAll() {
    setLoading(true);
    const { data: driverRow } = await supabase
      .from('couriers').select('id, home_base_zone, status')
      .eq('id', rawUser!.id).maybeSingle();
    if (driverRow) setDriverInfo(driverRow as DriverInfo);

    if (rawUser?.id && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        supabase.from('couriers')
          .update({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude } })
          .eq('id', rawUser.id).then(() => {});
      });
    }

    if (rawUser?.id) {
      const { data: batchRows } = await supabase
        .from('batches')
        .select('id, route, status, total_volume, ab_shipment_ids, bc_shipment_ids, assigned_at')
        .eq('assigned_to', rawUser.id)
        .order('assigned_at', { ascending: false });

      setBatches((batchRows ?? []).map((b) => ({
        id:           b.id as string,
        route:        (b.route as string[]) ?? [],
        status:       b.status as string,
        totalVolume:  b.total_volume ?? 0,
        shipmentCount:
          ((b.ab_shipment_ids as string[])?.length ?? 0) +
          ((b.bc_shipment_ids as string[])?.length ?? 0),
        assignedAt:   b.assigned_at ?? null,
      })));
    }

    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const todayBatches    = batches.filter((b) => b.assignedAt && isToday(b.assignedAt));
  const delivered       = batches.filter((b) => b.status === 'completed').length;
  const inTransit       = batches.filter((b) => b.status === 'in_transit').length;
  const todayCompleted  = todayBatches.filter((b) => b.status === 'completed').length;
  const deliveryRate    = todayBatches.length ? Math.round((todayCompleted / todayBatches.length) * 100) : 0;

  const shiftLabel  = '--:-- – --:--';
  const zoneLabel   = driverInfo?.home_base_zone ?? '—';
  const dutyLabel   = driverInfo ? (driverInfo.status === 'available' ? 'في الخدمة' : 'خارج الخدمة') : '—';

  const filteredBatches = statusFilter === 'all' ? batches : batches.filter((b) => b.status === statusFilter);

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
              onClick={() => {
                setShowNotifPanel((v) => !v);
                setUnreadCount(0);
                if (rawUser?.id) {
                  const ids = pendingNotifications.map((n) => n.notificationId);
                  localStorage.setItem(`dd_seen_notifs_${rawUser.id}`, JSON.stringify(ids));
                }
              }}
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="dd-notif-dot">{unreadCount}</span>
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
                          {notif.isAccepted ? (
                            <span className="dd-notif-taken">تم القبول من سائق آخر</span>
                          ) : (
                            <>
                              <button className="dd-notif-btn accept" onClick={() => handleAcceptBatch(notif)}>قبول</button>
                              <button className="dd-notif-btn decline" onClick={() => handleDeclineBatch(notif.notificationId)}>رفض</button>
                            </>
                          )}
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
                  <span className={`dd-duty-dot${driverInfo?.status === 'available' ? '' : ' dd-duty-dot-off'}`} />
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
              <div className="dd-card-value">{delivered.toLocaleString('ar-EG')}</div>
              <div className="dd-card-sub">إجمالي المكتملة</div>
            </div>

            <div className="dd-stat-card">
              <div className="dd-card-top">
                <span className="dd-card-label">دفعات اليوم</span>
                <div className="dd-card-icon dd-icon-amber">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="7" width="20" height="14" rx="2" />
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  </svg>
                </div>
              </div>
              <div className="dd-card-value">{todayBatches.length.toLocaleString('ar-EG')}</div>
              <div className="dd-card-sub">مخصصة اليوم</div>
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

          {/* ── Assigned Batches ── */}
          <div className="dd-orders-section">
            <div className="dd-orders-header">
              <select
                className="dd-status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">كل الحالات</option>
                <option value="assigned">مخصصة</option>
                <option value="in_transit">قيد التوصيل</option>
                <option value="completed">مكتملة</option>
                <option value="cancelled">ملغاة</option>
              </select>
              <h2 className="dd-orders-title">الدفعات المخصصة</h2>
            </div>

            <div className="dd-orders-actions">
              <Link to="/deliverer" className="dd-view-all-link">← عرض جميع الطلبات</Link>
            </div>

            {loading ? (
              <div className="dd-orders-empty">جاري تحميل الدفعات...</div>
            ) : filteredBatches.length === 0 ? (
              <div className="dd-orders-empty">لا توجد دفعات مخصصة</div>
            ) : (
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>رقم الدفعة</th>
                      <th>المسار</th>
                      <th>عدد الشحنات</th>
                      <th>الحجم الكلي</th>
                      <th>الحالة</th>
                      <th>وقت التخصيص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.map((batch) => {
                      const s = STATUS_LABEL[batch.status] ?? { label: batch.status, color: '#6b7280' };
                      return (
                        <tr key={batch.id}>
                          <td className="dd-td-id">#{batch.id.slice(-8).toUpperCase()}</td>
                          <td className="dd-td-address">{batch.route.join(' ← ') || '—'}</td>
                          <td>{batch.shipmentCount}</td>
                          <td>{batch.totalVolume.toFixed(1)}</td>
                          <td>
                            <span
                              className="dd-badge"
                              style={{ background: `${s.color}18`, color: s.color, borderColor: `${s.color}30` }}
                            >
                              {s.label}
                            </span>
                          </td>
                          <td className="dd-td-time">{batch.assignedAt ? formatTime(batch.assignedAt) : '—'}</td>
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
