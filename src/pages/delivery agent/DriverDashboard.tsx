import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import DriverNotificationBell from './DriverNotificationBell';
import AdminMessagesInbox from '../../components/AdminMessagesInbox';
import './DriverDashboard.css';

// ── Types ──────────────────────────────────────────────────────────────────

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

interface ShipmentProgress {
  id: string;
  status: string;
  pickup_zone: string;
  dropoff_zone: string;
  picked_up_at: string | null;
  delivered_at: string | null;
}

interface ActiveMission {
  batchId: string;
  batchStatus: string;
  route: string[];
  shipments: ShipmentProgress[];
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
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <div className={`dd-sidebar-item${active ? ' dd-active' : ''}`} onClick={onClick}>
      <span className="dd-sidebar-item-icon">{icon}</span>
      <span className="dd-sidebar-item-label">{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          marginRight: 'auto', background: '#2563eb', color: '#fff',
          borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 800,
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { name, rawUser } = useSharedAuth();
  const navigate = useNavigate();
  const avatarRef = useRef<HTMLDivElement>(null);

  const [currentPage, setCurrentPage]           = useState<'home' | 'inbox'>('home');
  const [unreadMsgCount, setUnreadMsgCount]     = useState(0);
  const [driverInfo, setDriverInfo]             = useState<DriverInfo | null>(null);
  const [batches, setBatches]                   = useState<BatchRow[]>([]);

  const [loading, setLoading]                   = useState(true);
  const [statusFilter, setStatusFilter]         = useState('all');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu]     = useState(false);

  const [activeMissions, setActiveMissions]     = useState<ActiveMission[]>([]);
  const [actionLoading, setActionLoading]       = useState<string | null>(null);

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

  // ── Unread message count for sidebar badge ───────────────────────────────
  useEffect(() => {
    if (!rawUser?.id) return;
    supabase
      .from('admin_messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', rawUser.id)
      .is('read_at', null)
      .then(({ count }) => setUnreadMsgCount(count ?? 0));

    const ch = supabase
      .channel('dd-inbox-badge-' + rawUser.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'admin_messages',
        filter: `recipient_id=eq.${rawUser.id}`,
      }, () => setUnreadMsgCount(c => c + 1))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rawUser?.id]);

  // ── Fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!rawUser) return;
    fetchAll();
  }, [rawUser?.id]);

  // ── Continuous real-time location tracking ────────────────────────────────
  useEffect(() => {
    if (!rawUser?.id || !navigator.geolocation) return;
    let lastSave = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSave < 15_000) return;
        lastSave = now;
        supabase.from('couriers')
          .update({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude } })
          .eq('id', rawUser.id)
          .then(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [rawUser?.id]);

  async function loadAllActiveMissions(activeBatches: { id: string; status: string; route: string[] }[]) {
    if (!activeBatches.length) { setActiveMissions([]); return; }
    const results = await Promise.all(
      activeBatches.map(async (b) => {
        const { data } = await supabase
          .from('shipments')
          .select('id, status, pickup_zone, dropoff_zone, picked_up_at, delivered_at')
          .eq('batch_id', b.id);
        return {
          batchId:     b.id,
          batchStatus: b.status,
          route:       b.route,
          shipments:   (data ?? []) as ShipmentProgress[],
        };
      })
    );
    // in_transit first, then assigned
    results.sort((a, b) => (a.batchStatus === 'in_transit' ? -1 : 1) - (b.batchStatus === 'in_transit' ? -1 : 1));
    setActiveMissions(results);
  }

  async function fetchAll(silent = false) {
    if (!silent) setLoading(true);
    const { data: driverRow } = await supabase
      .from('couriers').select('id, home_base_zone, status')
      .eq('id', rawUser!.id).maybeSingle();
    if (driverRow) setDriverInfo(driverRow as DriverInfo);

    if (rawUser?.id) {
      const { data: batchRows } = await supabase
        .from('batches')
        .select('id, route, status, total_volume, ab_shipment_ids, bc_shipment_ids, assigned_at')
        .eq('assigned_to', rawUser.id)
        .order('assigned_at', { ascending: false });

      const mapped: BatchRow[] = (batchRows ?? []).map((b) => ({
        id:           b.id as string,
        route:        (b.route as string[]) ?? [],
        status:       b.status as string,
        totalVolume:  b.total_volume ?? 0,
        shipmentCount:
          ((b.ab_shipment_ids as string[])?.length ?? 0) +
          ((b.bc_shipment_ids as string[])?.length ?? 0),
        assignedAt:   b.assigned_at ?? null,
      }));
      setBatches(mapped);

      const activeBatches = mapped.filter((b) => b.status === 'in_transit' || b.status === 'assigned');
      await loadAllActiveMissions(activeBatches);
    }

    if (!silent) setLoading(false);
  }

  async function handleStartBatch(batchId: string) {
    setActionLoading('start-' + batchId);
    try {
      const res = await fetch('/api/logistics/start-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId, courier_id: rawUser!.id }),
      });
      if (res.ok) await fetchAll(true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handlePickup(shipmentId: string) {
    setActionLoading('pickup-' + shipmentId);
    try {
      const res = await fetch('/api/logistics/pickup-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId, courier_id: rawUser!.id }),
      });
      if (res.ok) await fetchAll(true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeliver(shipmentId: string) {
    setActionLoading('deliver-' + shipmentId);
    try {
      const res = await fetch('/api/logistics/deliver-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId, courier_id: rawUser!.id }),
      });
      if (res.ok) await fetchAll(true);
    } finally {
      setActionLoading(null);
    }
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
          <DriverNotificationBell />

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
              active={currentPage === 'home'}
              onClick={() => setCurrentPage('home')}
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

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              }
              label="صندوق الرسائل"
              active={currentPage === 'inbox'}
              badge={unreadMsgCount}
              onClick={() => { setCurrentPage('inbox'); setUnreadMsgCount(0); }}
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

          {/* ── Inbox page ── */}
          {currentPage === 'inbox' && rawUser && (
            <AdminMessagesInbox userId={rawUser.id} />
          )}

          {currentPage === 'home' && <>

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

          {/* ── Active Mission Cards (one per assigned / in_transit batch) ── */}
          {activeMissions.map((mission) => (
            <div
              key={mission.batchId}
              className={`dd-mission-card${mission.batchStatus === 'in_transit' ? ' dd-mission-active' : ' dd-mission-assigned'}`}
            >
              {/* Header */}
              <div className="dd-mission-header">
                <div className="dd-mission-header-info">
                  <div className="dd-mission-label">
                    {mission.batchStatus === 'in_transit' ? (
                      <>
                        <span className="dd-mission-pulse" />
                        المهمة الجارية
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8l4 2v5h-4V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                        </svg>
                        مهمة مخصصة
                      </>
                    )}
                  </div>
                  <div className="dd-mission-route">{mission.route.join(' ← ')}</div>
                  <div className="dd-mission-meta">
                    {mission.shipments.length} شحنة
                    {mission.batchStatus === 'in_transit' && (
                      <> · {mission.shipments.filter((s) => s.status === 'delivered').length} تم تسليمها</>
                    )}
                  </div>
                </div>

                {/* Start button — every assigned batch gets its own */}
                {mission.batchStatus === 'assigned' && (
                  <button
                    className="dd-mission-start-btn"
                    disabled={actionLoading === 'start-' + mission.batchId}
                    onClick={() => handleStartBatch(mission.batchId)}
                  >
                    {actionLoading === 'start-' + mission.batchId ? (
                      <span className="dd-mission-spinner" />
                    ) : (
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                    بدء المهمة
                  </button>
                )}
              </div>

              {/* Shipment list */}
              {mission.shipments.length === 0 ? (
                <div className="dd-mission-loading">لا توجد شحنات في هذه الدفعة</div>
              ) : (
                <div className="dd-mission-table-wrap">
                  <table className="dd-mission-table">
                    <thead>
                      <tr>
                        <th>رقم الشحنة</th>
                        <th>من</th>
                        <th>إلى</th>
                        <th>الحالة / الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mission.shipments.map((s) => {
                        const isPickupLoading  = actionLoading === 'pickup-' + s.id;
                        const isDeliverLoading = actionLoading === 'deliver-' + s.id;
                        const anyLoading       = actionLoading !== null;

                        return (
                          <tr key={s.id}>
                            <td className="dd-td-id">#{s.id.slice(-8).toUpperCase()}</td>
                            <td className="dd-td-address">{s.pickup_zone}</td>
                            <td className="dd-td-address">{s.dropoff_zone}</td>
                            <td>
                              {s.status === 'delivered' ? (
                                <span className="dd-mission-done">
                                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  تم التسليم
                                </span>
                              ) : s.status === 'picked_up' ? (
                                <button
                                  className="dd-mission-action-btn dd-mission-deliver-btn"
                                  disabled={anyLoading}
                                  onClick={() => handleDeliver(s.id)}
                                >
                                  {isDeliverLoading ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                                  تم التسليم للعميل
                                </button>
                              ) : (
                                <button
                                  className="dd-mission-action-btn dd-mission-pickup-btn"
                                  disabled={anyLoading || mission.batchStatus !== 'in_transit'}
                                  onClick={() => handlePickup(s.id)}
                                >
                                  {isPickupLoading ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                                  تم الاستلام من المتجر
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

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

          </>}

        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
