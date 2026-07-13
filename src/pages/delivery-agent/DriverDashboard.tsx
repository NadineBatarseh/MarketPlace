import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import DriverNotificationBell from './DriverNotificationBell';
import DriverMessagesInbox from './DriverMessagesInbox';
import './DriverDashboard.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface DriverInfo {
  id: string;
  home_base_zone: string | null;
  status: 'available' | 'on_route' | 'offline';
}

interface WorkSummary {
  status: 'available' | 'on_route' | 'offline';
  activeWorkSession: { id: string; startedAt: string } | null;
  activeDeliverySession: { id: string; batchId: string; startedAt: string } | null;
  totalDutyMinutesToday: number;
  activeDeliveryMinutesToday: number;
  availableWaitingMinutesToday: number;
  completedBatchesToday: number;
  activeBatch: { id: string; batchNumber: string; status: string; route: string[] } | null;
}

interface DayHistoryEntry {
  date: string;
  day: number;
  weekday: string;
  totalDutyMinutes: number;
  activeDeliveryMinutes: number;
  availableWaitingMinutes: number;
  completedBatches: number;
  worked: boolean;
}

interface BatchRow {
  id: string;
  batchNumber: string;
  route: string[];
  status: string;
  totalVolume: number;
  shipmentCount: number;
  assignedAt: string | null;
}

// ── Pickup & delivery view (التسليم والاستلام) ──────────────────────────────

interface StoreDetails {
  name: string;
  location: string | null;
  lat: number | null;
  lng: number | null;
  whatsapp: string | null;
}

interface BuyerDetails {
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
}

interface PDShipment {
  id: string;
  shipmentNumber: string;
  status: string;
  pickupZone: string;
  dropoffZone: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  store: StoreDetails;
  buyer: BuyerDetails;
}

interface PDBatch {
  id: string;
  batchNumber: string;
  route: string[];
  shipments: PDShipment[];
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
  return new Date().toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}


function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// "2 ساعة و 15 دقيقة" / "45 دقيقة" — used for the "ملخص اليوم" stat cards.
function formatMinutesLabel(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} دقيقة`;
  if (rem === 0) return `${h} ساعة`;
  return `${h} ساعة و ${rem} دقيقة`;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_assignment: { label: 'في انتظار التخصيص', color: '#f59e0b' },
  assigned:           { label: 'لم تبدأ بعد',        color: '#2563eb' },
  in_transit:         { label: 'قيد التوصيل',       color: '#7c3aed' },
  completed:          { label: 'مكتملة',             color: '#16a34a' },
  cancelled:          { label: 'ملغاة',              color: '#dc2626' },
};

// Trip-history label map — "assigned" reads as "not started yet" in this context
const TRIP_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_assignment: { label: 'في انتظار التخصيص', color: '#f59e0b' },
  assigned:           { label: 'لم تبدأ بعد',       color: '#2563eb' },
  in_transit:         { label: 'قيد التوصيل',       color: '#7c3aed' },
  completed:          { label: 'مكتملة',             color: '#16a34a' },
  cancelled:          { label: 'ملغاة',             color: '#dc2626' },
};

// Filter tabs for the trip-history view
const TRIP_FILTERS: { value: string; label: string }[] = [
  { value: 'all',        label: 'الكل' },
  { value: 'assigned',   label: 'لم تبدأ بعد' },
  { value: 'in_transit', label: 'قيد التوصيل' },
  { value: 'completed',  label: 'مكتملة' },
  { value: 'cancelled',  label: 'ملغاة' },
];

// Per-shipment status labels (used in the pickup & delivery view badges)
const SHIPMENT_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: 'قيد التحضير',      color: '#9ca3af' },
  available: { label: 'متاحة',            color: '#f59e0b' },
  delayed:   { label: 'مؤجلة',            color: '#2563eb' },
  batched:   { label: 'بانتظار الاستلام', color: '#2563eb' },
  reserved:  { label: 'محجوزة',           color: '#2563eb' },
  picked_up: { label: 'قيد التوصيل',      color: '#7c3aed' },
  delivered: { label: 'تم التسليم',       color: '#16a34a' },
  stranded:  { label: 'مشكلة في النقل',   color: '#dc2626' },
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
        <span className="dd-sidebar-badge">{badge}</span>
      )}
    </div>
  );
}

// ── Detail row for store / buyer panels ─────────────────────────────────────

function DetailRow({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="dd-pd-detail-row">
      <span className="dd-pd-detail-label">{label}</span>
      {href ? (
        <a className="dd-pd-detail-value dd-pd-link" href={href} target="_blank" rel="noreferrer">{value}</a>
      ) : (
        <span className="dd-pd-detail-value">{value}</span>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { name, rawUser } = useSharedAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const avatarRef = useRef<HTMLDivElement>(null);

  const initialPage = (location.state as { page?: 'home' | 'inbox' | 'trips' | 'pickup_delivery' | 'work_hours' } | null)?.page ?? 'home';
  const [currentPage, setCurrentPage]           = useState<'home' | 'inbox' | 'trips' | 'pickup_delivery' | 'work_hours'>(initialPage);
  const [tripFilter, setTripFilter]             = useState('all');
  const [tripSortDir, setTripSortDir]           = useState<'desc' | 'asc'>('desc');

  // Pickup & delivery (التسليم والاستلام)
  const [pdBatches, setPdBatches]               = useState<PDBatch[]>([]);
  const [pdLoading, setPdLoading]               = useState(false);
  const [pdOpenBatches, setPdOpenBatches]       = useState<Set<string>>(new Set());
  const [pdOpenStores, setPdOpenStores]         = useState<Set<string>>(new Set());
  const [pdOpenBuyers, setPdOpenBuyers]         = useState<Set<string>>(new Set());
  const [unreadMsgCount, setUnreadMsgCount]     = useState(0);
  const [driverInfo, setDriverInfo]             = useState<DriverInfo | null>(null);
  const [batches, setBatches]                   = useState<BatchRow[]>([]);

  // Duty-time / mission-time tracking (حالة الدوام)
  const [workSummary, setWorkSummary]           = useState<WorkSummary | null>(null);
  const [dutyActionLoading, setDutyActionLoading] = useState(false);

  // سجل ساعات العمل (work-hours log — monthly history table)
  const now0 = new Date();
  const [workHistoryYear, setWorkHistoryYear]   = useState(now0.getFullYear());
  const [workHistoryMonth, setWorkHistoryMonth] = useState(now0.getMonth() + 1);
  const [workHistoryDays, setWorkHistoryDays]   = useState<DayHistoryEntry[]>([]);
  const [workHistoryLoading, setWorkHistoryLoading] = useState(false);

  const [loading, setLoading]                   = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu]     = useState(false);

  const [actionLoading, setActionLoading]       = useState<string | null>(null);

  // Vehicle-breakdown report (confirm dialog + result toast)
  const [showBreakdownConfirm, setShowBreakdownConfirm] = useState(false);
  const [breakdownReason, setBreakdownReason]           = useState('');
  const [breakdownSubmitting, setBreakdownSubmitting]   = useState(false);
  const [toast, setToast]                               = useState<string | null>(null);
  const toastTimer                                      = useRef<ReturnType<typeof setTimeout>>();

  function showToast(msg: string) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

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
    fetchWorkSummary();
  }, [rawUser?.id]);

  // ── Poll the duty/mission-time summary so "ملخص اليوم" stays fresh ────────
  useEffect(() => {
    if (!rawUser?.id) return;
    const id = setInterval(() => fetchWorkSummary(), 30_000);
    return () => clearInterval(id);
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

  // ── Pickup & delivery: load in_transit batches with store + buyer details ──
  useEffect(() => {
    if (currentPage === 'pickup_delivery' && rawUser?.id) fetchPickupDelivery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, rawUser?.id]);

  // ── سجل ساعات العمل: load the selected month's daily history ───────────────
  useEffect(() => {
    if (currentPage === 'work_hours' && rawUser?.id) fetchWorkHistory(workHistoryYear, workHistoryMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, rawUser?.id, workHistoryYear, workHistoryMonth]);

  function goToPreviousMonth() {
    setWorkHistoryMonth((m) => {
      if (m === 1) { setWorkHistoryYear((y) => y - 1); return 12; }
      return m - 1;
    });
  }

  function goToNextMonth() {
    setWorkHistoryMonth((m) => {
      if (m === 12) { setWorkHistoryYear((y) => y + 1); return 1; }
      return m + 1;
    });
  }

  async function fetchPickupDelivery(silent = false) {
    if (!silent) setPdLoading(true);
    try {
      // Served by the backend (service-role) so store/buyer details aren't blocked
      // by the RLS that applies to the driver's browser Supabase client.
      const res = await fetch(`/api/logistics/pickup-delivery?courier_id=${encodeURIComponent(rawUser!.id)}`);
      const json = await res.json();
      setPdBatches(res.ok && json.success ? (json.batches as PDBatch[]) : []);
    } catch (err) {
      console.error('[DriverDashboard] pickup-delivery fetch failed:', err);
      setPdBatches([]);
    } finally {
      if (!silent) setPdLoading(false);
    }
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
        .select('id, batch_number, route, status, total_volume, ab_shipment_ids, bc_shipment_ids, assigned_at')
        .eq('assigned_to', rawUser.id)
        .order('assigned_at', { ascending: false });

      const mapped: BatchRow[] = (batchRows ?? []).map((b) => ({
        id:           b.id as string,
        batchNumber:  (b.batch_number as string) ?? '',
        route:        (b.route as string[]) ?? [],
        status:       b.status as string,
        totalVolume:  b.total_volume ?? 0,
        shipmentCount:
          ((b.ab_shipment_ids as string[])?.length ?? 0) +
          ((b.bc_shipment_ids as string[])?.length ?? 0),
        assignedAt:   b.assigned_at ?? null,
      }));
      setBatches(mapped);
    }

    if (!silent) setLoading(false);
  }

  async function fetchWorkSummary() {
    if (!rawUser?.id) return;
    try {
      const res = await fetch(`/api/couriers/work-summary/today?courier_id=${encodeURIComponent(rawUser.id)}`);
      const json = await res.json();
      if (res.ok && json.success) {
        const { success, ...summary } = json;
        setWorkSummary(summary as WorkSummary);
      }
    } catch (err) {
      console.error('[DriverDashboard] work-summary fetch failed:', err);
    }
  }

  async function fetchWorkHistory(year: number, month: number) {
    if (!rawUser?.id) return;
    setWorkHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/couriers/work-summary/history?courier_id=${encodeURIComponent(rawUser.id)}&year=${year}&month=${month}`
      );
      const json = await res.json();
      setWorkHistoryDays(res.ok && json.success ? (json.days as DayHistoryEntry[]) : []);
    } catch (err) {
      console.error('[DriverDashboard] work-history fetch failed:', err);
      setWorkHistoryDays([]);
    } finally {
      setWorkHistoryLoading(false);
    }
  }

  async function handleStartWork() {
    if (!rawUser?.id) return;
    setDutyActionLoading(true);
    try {
      const res = await fetch('/api/couriers/start-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier_id: rawUser.id }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        await fetchAll(true);
        await fetchWorkSummary();
      } else {
        showToast(json?.error ?? 'تعذر بدء الدوام');
      }
    } finally {
      setDutyActionLoading(false);
    }
  }

  async function handleEndWork() {
    if (!rawUser?.id) return;
    setDutyActionLoading(true);
    try {
      const res = await fetch('/api/couriers/end-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier_id: rawUser.id }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        await fetchAll(true);
        await fetchWorkSummary();
      } else {
        showToast(json?.error ?? 'تعذر إنهاء الدوام');
      }
    } finally {
      setDutyActionLoading(false);
    }
  }

  async function handleStartBatch(batchId: string) {
    setActionLoading('start-' + batchId);
    try {
      const res = await fetch('/api/logistics/start-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId, courier_id: rawUser!.id }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        await fetchAll(true);
        await fetchWorkSummary();
      } else {
        showToast(json?.error ?? 'تعذر بدء المهمة');
      }
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
      if (res.ok) { await fetchAll(true); await fetchPickupDelivery(true); }
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
      if (res.ok) { await fetchAll(true); await fetchPickupDelivery(true); await fetchWorkSummary(); }
    } finally {
      setActionLoading(null);
    }
  }

  // Report a general vehicle breakdown — affects ALL of the driver's in-transit
  // batches (a broken-down vehicle can't continue any of them). Re-pools
  // not-yet-collected shipments and strands the ones already on board.
  function openBreakdownConfirm() {
    const hasActive = batches.some((b) => b.status === 'in_transit');
    if (!hasActive) {
      showToast('لا توجد دفعات قيد التوصيل حالياً للإبلاغ عن عطل فيها.');
      return;
    }
    setShowBreakdownConfirm(true);
  }

  async function confirmBreakdown() {
    const activeIds = batches.filter((b) => b.status === 'in_transit').map((b) => b.id);
    setBreakdownSubmitting(true);
    try {
      const results = await Promise.all(
        activeIds.map((id) =>
          fetch('/api/logistics/breakdown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch_id: id, reason: breakdownReason.trim() || undefined }),
          }),
        ),
      );
      setShowBreakdownConfirm(false);
      setBreakdownReason('');
      showToast(
        results.every((r) => r.ok)
          ? 'تم الإبلاغ عن العطل. سيتولّى فريق الدعم متابعة الشحنات قيد المعالجة.'
          : 'تعذّر الإبلاغ عن بعض الدفعات. يُرجى المحاولة مجدداً أو التواصل مع الدعم.',
      );
      await fetchAll(true);
      await fetchPickupDelivery(true);
      await fetchWorkSummary();
    } finally {
      setBreakdownSubmitting(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/home');
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const todayBatches    = batches.filter((b) => b.assignedAt && isToday(b.assignedAt));
  const delivered       = batches.filter((b) => b.status === 'completed').length;
  const inTransit       = batches.filter((b) => b.status === 'in_transit').length;
  const todayCompleted  = todayBatches.filter((b) => b.status === 'completed').length;
  const deliveryRate    = todayBatches.length ? Math.round((todayCompleted / todayBatches.length) * 100) : 0;

  const shiftLabel  = '--:-- – --:--';
  const zoneLabel   = driverInfo?.home_base_zone ?? '—';

  // ── Duty status (حالة الدوام) ──────────────────────────────────────────────
  const dutyStatus = driverInfo?.status ?? 'offline';
  const DUTY_CONFIG: Record<DriverInfo['status'], { badge: string; color: string; bg: string; border: string; helper: string }> = {
    offline:    { badge: 'خارج الدوام',        color: '#64748b', bg: '#f8fafc', border: '#cbd5e1', helper: 'ابدأ الدوام لتتمكن من استلام المهام.' },
    available:  { badge: 'متاح لاستلام مهمة', color: '#15803d', bg: '#f0fdf4', border: '#86efac', helper: '' },
    on_route:   { badge: 'في مهمة توصيل',     color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd', helper: 'أنهِ المهمة الحالية قبل قبول مهمة جديدة.' },
  };
  const dutyConfig = DUTY_CONFIG[dutyStatus];
  const dutyLabel  = dutyConfig.badge;

  // Current (in_transit) + not-yet-started (assigned) missions — shown as simple rows on the home page
  const activeBatches = batches
    .filter((b) => b.status === 'in_transit' || b.status === 'assigned')
    .slice()
    .sort((a, b) => {
      // in_transit first, then newest assignment first
      if (a.status !== b.status) return a.status === 'in_transit' ? -1 : 1;
      const ta = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
      const tb = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
      return tb - ta;
    });

  // ── Trip history (سجل الرحلات): full batch history, filtered + sorted by date ──
  const tripBatches = batches
    .filter((b) => tripFilter === 'all' ? true : b.status === tripFilter)
    .slice()
    .sort((a, b) => {
      const ta = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
      const tb = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
      return tripSortDir === 'desc' ? tb - ta : ta - tb;
    });

  // Reusable "report a breakdown" button (shown on home + pickup/delivery pages)
  const breakdownButton = (
    <button
      type="button"
      className="dd-pd-breakdown-btn"
      onClick={openBreakdownConfirm}
    >
      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      الإبلاغ عن عطل
    </button>
  );

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
          <DriverNotificationBell driverStatus={driverInfo?.status ?? 'offline'} onBatchAccepted={() => { fetchAll(true); fetchWorkSummary(); }} />

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
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              }
              label="صندوق الرسائل"
              active={currentPage === 'inbox'}
              badge={unreadMsgCount}
              onClick={() => { setCurrentPage('inbox'); setUnreadMsgCount(0); }}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                  <path d="M3 12a9 9 0 0 1 9-9" />
                </svg>
              }
              label="سجل الرحلات"
              active={currentPage === 'trips'}
              onClick={() => setCurrentPage('trips')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M16 16h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
                  <polyline points="9 11 12 14 15 11" />
                  <line x1="12" y1="14" x2="12" y2="4" />
                </svg>
              }
              label="التسليم والاستلام"
              active={currentPage === 'pickup_delivery'}
              onClick={() => setCurrentPage('pickup_delivery')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <path d="M9 16l2-2 2 2 3-3" />
                </svg>
              }
              label="سجل ساعات العمل"
              active={currentPage === 'work_hours'}
              onClick={() => setCurrentPage('work_hours')}
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
          </nav>

          {/* Sidebar footer */}
          <div className="dd-sidebar-footer">
            <div className="dd-sidebar-user">
              <div className="dd-sidebar-user-avatar">{displayInitial}</div>
              <div className="dd-sidebar-user-info">
                <div className="dd-sidebar-user-name">{name ?? 'السائق'}</div>
                <div className="dd-sidebar-user-role">
                  <span className={`dd-duty-dot${dutyStatus === 'on_route' ? ' dd-duty-dot-busy' : dutyStatus === 'offline' ? ' dd-duty-dot-off' : ''}`} />
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

          {/* ── Inbox page (صندوق الرسائل) ── */}
          {currentPage === 'inbox' && rawUser && (
            <DriverMessagesInbox userId={rawUser.id} />
          )}

          {/* ── Trip history page (سجل الرحلات) ── */}
          {currentPage === 'trips' && (
            <div className="dd-orders-section">
              <div className="dd-orders-header">
                <button
                  type="button"
                  className="dd-sort-btn"
                  onClick={() => setTripSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                  aria-label="ترتيب حسب التاريخ"
                >
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    {tripSortDir === 'desc' ? (
                      <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="6 13 12 19 18 13" /></>
                    ) : (
                      <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="6 11 12 5 18 11" /></>
                    )}
                  </svg>
                  {tripSortDir === 'desc' ? 'الأحدث أولاً' : 'الأقدم أولاً'}
                </button>
                <h2 className="dd-orders-title">سجل الرحلات</h2>
              </div>

              {/* Status filter tabs */}
              <div className="dd-trip-filters">
                {TRIP_FILTERS.map((f) => {
                  const count = f.value === 'all'
                    ? batches.length
                    : batches.filter((b) => b.status === f.value).length;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      className={`dd-trip-filter${tripFilter === f.value ? ' dd-trip-filter-active' : ''}`}
                      onClick={() => setTripFilter(f.value)}
                    >
                      {f.label}
                      <span className="dd-trip-filter-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              {loading ? (
                <div className="dd-orders-empty">جاري تحميل سجل الرحلات...</div>
              ) : tripBatches.length === 0 ? (
                <div className="dd-orders-empty">لا توجد رحلات في هذا التصنيف</div>
              ) : (
                <div className="dd-table-wrap">
                  <table className="dd-table">
                    <thead>
                      <tr>
                        <th>رقم الرحلة</th>
                        <th>المسار</th>
                        <th>عدد الشحنات</th>
                        <th>الحجم الكلي</th>
                        <th>الحالة</th>
                        <th>التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tripBatches.map((batch) => {
                        const s = TRIP_STATUS_LABEL[batch.status] ?? { label: batch.status, color: '#6b7280' };
                        return (
                          <tr key={batch.id}>
                            <td className="dd-td-id">{batch.batchNumber}</td>
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
                            <td className="dd-td-time">{batch.assignedAt ? formatDateTime(batch.assignedAt) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Pickup & delivery page (التسليم والاستلام) ── */}
          {currentPage === 'pickup_delivery' && (
            <div className="dd-orders-section">
              <div className="dd-orders-header">
                <h2 className="dd-orders-title">التسليم والاستلام</h2>
                {breakdownButton}
              </div>
              <p className="dd-pd-subtitle">الدفعات قيد التوصيل — اضغط على الدفعة لعرض شحناتها وتفاصيل المتجر والمشتري.</p>

              {pdLoading ? (
                <div className="dd-orders-empty">جاري تحميل الدفعات قيد التوصيل...</div>
              ) : pdBatches.length === 0 ? (
                <div className="dd-orders-empty">لا توجد دفعات قيد التوصيل حالياً</div>
              ) : (
                <div className="dd-pd-list">
                  {pdBatches.map((batch) => {
                    const open = pdOpenBatches.has(batch.id);
                    const deliveredCount = batch.shipments.filter((s) => s.status === 'delivered').length;
                    return (
                      <div key={batch.id} className={`dd-pd-batch${open ? ' dd-pd-batch-open' : ''}`}>
                        {/* Batch header */}
                        <button
                          type="button"
                          className="dd-pd-batch-head"
                          onClick={() => toggleSet(setPdOpenBatches, batch.id)}
                        >
                          <span className={`dd-pd-chevron${open ? ' dd-pd-chevron-open' : ''}`}>
                            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                          </span>
                          <div className="dd-pd-batch-info">
                            <span className="dd-pd-batch-number">{batch.batchNumber}</span>
                            <span className="dd-pd-batch-route">{batch.route.join(' ← ') || '—'}</span>
                          </div>
                          <span className="dd-pd-batch-meta">
                            {batch.shipments.length} شحنة · {deliveredCount} تم تسليمها
                          </span>
                        </button>

                        {/* Shipments */}
                        {open && (
                          <div className="dd-pd-ships">
                            {batch.shipments.length === 0 ? (
                              <div className="dd-orders-empty">لا توجد شحنات في هذه الدفعة</div>
                            ) : (
                              batch.shipments.map((s) => {
                                const storeOpen = pdOpenStores.has(s.id);
                                const buyerOpen = pdOpenBuyers.has(s.id);
                                const st = SHIPMENT_STATUS_LABEL[s.status] ?? { label: s.status, color: '#6b7280' };
                                const anyLoading = actionLoading !== null;
                                return (
                                  <div key={s.id} className="dd-pd-ship">
                                    <div className="dd-pd-ship-head">
                                      <span className="dd-td-id">{s.shipmentNumber}</span>
                                      <span className="dd-pd-ship-route">{s.pickupZone} ← {s.dropoffZone}</span>
                                      <span
                                        className="dd-badge"
                                        style={{ background: `${st.color}18`, color: st.color, borderColor: `${st.color}30` }}
                                      >
                                        {st.label}
                                      </span>
                                    </div>

                                    {/* Store + buyer names (inline summary) */}
                                    <div className="dd-pd-ship-parties">
                                      <span className="dd-pd-party">
                                        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path d="M3 9l1-5h16l1 5M4 9v11h16V9M4 9h16" />
                                        </svg>
                                        <span className="dd-pd-party-label">المتجر:</span> {s.store.name}
                                      </span>
                                      <span className="dd-pd-party">
                                        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                          <circle cx="12" cy="7" r="4" />
                                        </svg>
                                        <span className="dd-pd-party-label">المشتري:</span> {s.buyer.name}
                                      </span>
                                    </div>

                                    {/* Status report action (pickup → deliver → done) */}
                                    <div className="dd-pd-actions">
                                      {s.status === 'delivered' ? (
                                        <span className="dd-mission-done">
                                          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                            <polyline points="20 6 9 17 4 12" />
                                          </svg>
                                          تم التسليم
                                        </span>
                                      ) : s.status === 'stranded' ? (
                                        <span className="dd-pd-stranded">مشكلة في النقل — قيد المعالجة</span>
                                      ) : s.status === 'picked_up' ? (
                                        <button
                                          className="dd-mission-action-btn dd-mission-deliver-btn"
                                          disabled={anyLoading}
                                          onClick={() => handleDeliver(s.id)}
                                        >
                                          {actionLoading === 'deliver-' + s.id ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                                          تم التسليم للعميل
                                        </button>
                                      ) : (
                                        <button
                                          className="dd-mission-action-btn dd-mission-pickup-btn"
                                          disabled={anyLoading}
                                          onClick={() => handlePickup(s.id)}
                                        >
                                          {actionLoading === 'pickup-' + s.id ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                                          تم الاستلام من المتجر
                                        </button>
                                      )}
                                    </div>

                                    {/* Toggle buttons */}
                                    <div className="dd-pd-toggles">
                                      <button
                                        type="button"
                                        className={`dd-pd-toggle${storeOpen ? ' dd-pd-toggle-active' : ''}`}
                                        onClick={() => toggleSet(setPdOpenStores, s.id)}
                                      >
                                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path d="M3 9l1-5h16l1 5M4 9v11h16V9M4 9h16" />
                                        </svg>
                                        تفاصيل المتجر
                                      </button>
                                      <button
                                        type="button"
                                        className={`dd-pd-toggle${buyerOpen ? ' dd-pd-toggle-active' : ''}`}
                                        onClick={() => toggleSet(setPdOpenBuyers, s.id)}
                                      >
                                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                          <circle cx="12" cy="7" r="4" />
                                        </svg>
                                        تفاصيل المشتري
                                      </button>
                                    </div>

                                    {/* Store details panel */}
                                    {storeOpen && (
                                      <div className="dd-pd-detail dd-pd-detail-store">
                                        <div className="dd-pd-detail-title">تفاصيل المتجر (الاستلام)</div>
                                        <DetailRow label="اسم المتجر" value={s.store.name} />
                                        <DetailRow label="العنوان / المنطقة" value={s.store.location} />
                                        <DetailRow
                                          label="واتساب"
                                          value={s.store.whatsapp}
                                          href={s.store.whatsapp ? `https://wa.me/${s.store.whatsapp.replace(/\D/g, '')}` : undefined}
                                        />
                                        {s.store.lat != null && s.store.lng != null && (
                                          <DetailRow
                                            label="الموقع"
                                            value="عرض على الخريطة"
                                            href={`https://www.google.com/maps?q=${s.store.lat},${s.store.lng}`}
                                          />
                                        )}
                                      </div>
                                    )}

                                    {/* Buyer details panel */}
                                    {buyerOpen && (
                                      <div className="dd-pd-detail dd-pd-detail-buyer">
                                        <div className="dd-pd-detail-title">تفاصيل المشتري (التسليم)</div>
                                        <DetailRow label="اسم المشتري" value={s.buyer.name} />
                                        <DetailRow
                                          label="رقم الهاتف"
                                          value={s.buyer.phone}
                                          href={s.buyer.phone ? `https://wa.me/${s.buyer.phone.replace(/\D/g, '')}` : undefined}
                                        />
                                        <DetailRow label="عنوان التسليم" value={s.buyer.address} />
                                        <DetailRow label="وصف عنوان التسليم" value={s.buyer.note} />
                                        {s.buyer.lat != null && s.buyer.lng != null && (
                                          <DetailRow
                                            label="الموقع"
                                            value="عرض على الخريطة"
                                            href={`https://www.google.com/maps?q=${s.buyer.lat},${s.buyer.lng}`}
                                          />
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── سجل ساعات العمل (work-hours log) ── */}
          {currentPage === 'work_hours' && (
            <div className="dd-orders-section">
              <div className="dd-orders-header">
                <h2 className="dd-orders-title">سجل ساعات العمل</h2>
              </div>

              <div className="dd-month-nav">
                <button type="button" className="dd-month-nav-btn" onClick={goToPreviousMonth} aria-label="الشهر السابق">
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <span className="dd-month-nav-label">
                  {new Date(workHistoryYear, workHistoryMonth - 1, 1).toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' })}
                </span>
                <button type="button" className="dd-month-nav-btn" onClick={goToNextMonth} aria-label="الشهر التالي">
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>

              {workHistoryLoading ? (
                <div className="dd-orders-empty">جاري تحميل سجل ساعات العمل...</div>
              ) : (
                <div className="dd-table-wrap">
                  <table className="dd-table">
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>إجمالي وقت الدوام</th>
                        <th>وقت التوصيل الفعلي</th>
                        <th>وقت الانتظار</th>
                        <th>عدد المهام المكتملة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workHistoryDays.map((d) => {
                        const isToday =
                          workHistoryYear === now0.getFullYear() &&
                          workHistoryMonth === now0.getMonth() + 1 &&
                          d.day === now0.getDate();
                        return (
                          <tr key={d.date} className={isToday ? 'dd-history-row-today' : undefined}>
                            <td className="dd-td-id">{d.day} {d.weekday}</td>
                            <td>{d.worked ? formatMinutesLabel(d.totalDutyMinutes) : '—'}</td>
                            <td>{d.worked ? formatMinutesLabel(d.activeDeliveryMinutes) : '—'}</td>
                            <td>{d.worked ? formatMinutesLabel(d.availableWaitingMinutes) : '—'}</td>
                            <td>{d.worked ? d.completedBatches.toLocaleString('en-US') : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
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

            <div className="dd-shift-duty-actions">
              {dutyStatus === 'offline' && (
                <button
                  type="button"
                  className="dd-duty-toggle-btn dd-duty-toggle-start"
                  disabled={dutyActionLoading}
                  onClick={handleStartWork}
                >
                  {dutyActionLoading ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                  بدء الدوام
                </button>
              )}
              {dutyStatus === 'available' && (
                <button
                  type="button"
                  className="dd-duty-toggle-btn dd-duty-toggle-stop"
                  disabled={dutyActionLoading}
                  onClick={handleEndWork}
                >
                  {dutyActionLoading ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                  إنهاء الدوام
                </button>
              )}
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
              <div className="dd-card-value">{delivered.toLocaleString('en-US')}</div>
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
              <div className="dd-card-value">{todayBatches.length.toLocaleString('en-US')}</div>
              <div className="dd-card-sub">لم تبدأ بعد اليوم</div>
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
              <div className="dd-card-value">{inTransit.toLocaleString('en-US')}</div>
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

          {/* ── General vehicle-breakdown report (below the status cards) ── */}
          <div className="dd-breakdown-bar">
            {breakdownButton}
          </div>

          {/* ── Current & not-started missions (simple rows) ── */}
          <div className="dd-orders-section">
            <div className="dd-orders-header">
              <h2 className="dd-orders-title">المهام الحالية</h2>
            </div>

            <div className="dd-orders-actions">
              <Link to="/deliverer" className="dd-view-all-link">← عرض جميع الطلبات</Link>
            </div>

            {loading ? (
              <div className="dd-orders-empty">جاري تحميل المهام...</div>
            ) : activeBatches.length === 0 ? (
              <div className="dd-orders-empty">لا توجد مهام حالية</div>
            ) : (
              <div className="dd-task-rows">
                {activeBatches.map((batch) => {
                  const s = STATUS_LABEL[batch.status] ?? { label: batch.status, color: '#6b7280' };
                  const isStarting = actionLoading === 'start-' + batch.id;
                  return (
                    <div key={batch.id} className="dd-task-row">
                      <div className="dd-task-row-info">
                        <span className="dd-task-row-route">{batch.route.join(' ← ') || '—'}</span>
                        <span className="dd-task-row-date">
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          {batch.assignedAt ? formatDateTime(batch.assignedAt) : '—'}
                        </span>
                      </div>
                      <div className="dd-task-row-side">
                        <span
                          className="dd-badge"
                          style={{ background: `${s.color}18`, color: s.color, borderColor: `${s.color}30` }}
                        >
                          {s.label}
                        </span>
                        {batch.status === 'assigned' && (
                          <button
                            className="dd-task-start-btn"
                            disabled={isStarting}
                            onClick={() => handleStartBatch(batch.id)}
                          >
                            {isStarting ? (
                              <span className="dd-mission-spinner dd-mission-spinner-sm" />
                            ) : (
                              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <polygon points="5 3 19 12 5 21 5 3" />
                              </svg>
                            )}
                            بدء المهمة
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </>}

        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      {showBreakdownConfirm && (
        <ConfirmDialog
          icon="⚠️"
          title="الإبلاغ عن عطل"
          message={
            <>
              هل أنت متأكد من الإبلاغ عن عطل في مركبتك؟ سيتم إلغاء جميع دفعاتك قيد التوصيل.
              <textarea
                value={breakdownReason}
                onChange={(e) => setBreakdownReason(e.target.value)}
                placeholder="وصف العطل (اختياري)"
                rows={3}
                style={{
                  width: '100%', marginTop: 10, padding: '8px 10px', borderRadius: 8,
                  border: '1.5px solid #E2E8F0', fontFamily: 'inherit', fontSize: 12,
                  resize: 'vertical', direction: 'rtl', boxSizing: 'border-box',
                }}
              />
            </>
          }
          warning="ستُعاد الشحنات غير المُستلمة إلى المخزون، وتوضع الشحنات المُستلمة قيد المعالجة اليدوية من قبل فريق الدعم."
          confirmLabel="نعم، الإبلاغ عن عطل"
          cancelLabel="تراجع"
          loading={breakdownSubmitting}
          onConfirm={confirmBreakdown}
          onCancel={() => { setShowBreakdownConfirm(false); setBreakdownReason(''); }}
        />
      )}

      {toast && <div className="dd-toast">{toast}</div>}
    </div>
  );
}
