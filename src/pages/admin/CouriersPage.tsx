import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import supabase from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import AdminMessageModal from '../../components/AdminMessageModal';
import { archiveCourier, restoreCourier } from '../../lib/adminArchive';
import './adminResponsiveTable.css';

interface Courier {
  id: string;
  name: string;
  status: 'available' | 'on_route' | 'offline';
  is_archived: boolean;
  home_base_zone: string | null;
  home_base: { lat: number; lng: number } | null;
  location: { lat: number; lng: number } | null;
  max_volume: number | null;
  hours_driven_today: number | null;
  user_id: string | null;
  id_front_url: string | null;
  id_back_url: string | null;
  license_front_url: string | null;
  license_back_url: string | null;
}

interface CourierWithBatches extends Courier {
  activeBatches: number;
  email: string | null;
  phone_number: string | null;
  type_of_vehicle: string | null;
}

function getStatusConfig(t: TFunction) {
  return {
    available: { label: t('couriers.status.available'), bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
    on_route:  { label: t('couriers.status.on_route'), bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' },
    offline:   { label: t('couriers.status.offline'), bg: '#F8FAFC', text: '#64748B', border: '#CBD5E1' },
  };
}

function getVehicleLabels(t: TFunction): Record<string, string> {
  return {
    motorcycle: t('couriers.vehicle.motorcycle'),
    car:        t('couriers.vehicle.car'),
    van:        t('couriers.vehicle.van'),
    bicycle:    t('couriers.vehicle.bicycle'),
  };
}

// ── Performance indicator (نشاط جيد / وقت انتظار مرتفع) ──────────────────────
// Operational monitoring only — never used for payroll/salary calculation.
// Waiting Ratio = Waiting Time / Total Duty Time × 100.
interface CourierTodayMinutes {
  totalDutyMinutes: number;
  activeDeliveryMinutes: number;
  availableWaitingMinutes: number;
}

interface PerformanceBadgeConfig {
  bg: string;
  text: string;
  border: string;
  icon: string;
  label: string;
}

function getPerformanceBadge(waitingRatioPct: number, t: TFunction): PerformanceBadgeConfig {
  if (waitingRatioPct <= 40) {
    return { bg: '#F0FDF4', text: '#15803D', border: '#86EFAC', icon: '✓', label: t('couriers.performance.good') };
  }
  if (waitingRatioPct <= 70) {
    return { bg: '#FFFBEB', text: '#B45309', border: '#FCD34D', icon: '⚠️', label: t('couriers.performance.highWait') };
  }
  return { bg: '#FEF2F2', text: '#B91C1C', border: '#FCA5A5', icon: '⚠️', label: t('couriers.performance.veryHighWait') };
}

function PerformanceBadge({ minutes }: { minutes: CourierTodayMinutes | undefined }) {
  const { t } = useTranslation('admin');
  if (!minutes || minutes.totalDutyMinutes <= 0) return null;
  const ratio = Math.round((minutes.availableWaitingMinutes / minutes.totalDutyMinutes) * 100);
  const cfg = getPerformanceBadge(ratio, t);
  return (
    <div
      style={{
        marginTop: 7,
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 1,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 6,
        padding: '3px 7px',
      }}
    >
      <span style={{ color: cfg.text, fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
        <span>{cfg.icon}</span>{cfg.label}
      </span>
      <span style={{ color: cfg.text, fontSize: 9.5, fontWeight: 600, opacity: 0.85, whiteSpace: 'nowrap' }}>
        {t('couriers.performance.waitRatio', { ratio })}
      </span>
    </div>
  );
}

async function reverseGeocode(lat: number, lng: number, lang: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${lang}`,
      { headers: { 'Accept-Language': lang } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const a = json.address ?? {};
    const street = a.road ?? a.neighbourhood ?? a.suburb ?? '';
    const city   = a.city ?? a.town ?? a.village ?? a.county ?? '';
    if (street && city) return `${street}, ${city}`;
    return city || street || json.display_name?.split(',')[0] || null;
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: Courier['status'] }) {
  const { t } = useTranslation('admin');
  const STATUS_CONFIG = getStatusConfig(t);
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <span style={{
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
      borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function Dot({ status }: { status: Courier['status'] }) {
  const colors = { available: '#16a34a', on_route: '#2563eb', offline: '#94a3b8' };
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status] ?? colors.offline, marginLeft: 6, flexShrink: 0,
    }} />
  );
}

function DocImage({ label, path, bucket }: { label: string; path: string; bucket: string }) {
  const { t } = useTranslation('admin');
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isPdf = /\.pdf$/i.test(path);

  useEffect(() => {
    let active = true;
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!active) return;
      if (error || !data?.signedUrl) setFailed(true);
      else setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path, bucket]);

  const openFull = () => { if (url) window.open(url, '_blank'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
      <div
        onClick={openFull}
        title={url ? t('couriers.openFullSize') : undefined}
        style={{
          width: 130, height: 88, borderRadius: 8, border: '1.5px solid #E2E8F0',
          background: '#F8FAFC', overflow: 'hidden', cursor: url ? 'zoom-in' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {failed ? (
          <span style={{ fontSize: 11, color: '#CBD5E1' }}>{t('couriers.loadFailed')}</span>
        ) : isPdf ? (
          <span style={{ fontSize: 30 }}>📄</span>
        ) : url ? (
          <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 11, color: '#94A3B8' }}>{t('couriers.loadingEllipsis')}</span>
        )}
      </div>
      <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#0F2B4E', fontWeight: 600 }}>{value ?? <span style={{ color: '#CBD5E1' }}>—</span>}</span>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'right', color: '#64748B',
  fontWeight: 700, fontSize: 11, borderBottom: '1.5px solid #E2E8F0',
  whiteSpace: 'nowrap', background: '#F8FAFC', letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px', color: '#0F2B4E', fontSize: 13,
  verticalAlign: 'middle', textAlign: 'right', borderBottom: '1px solid #F1F5F9',
};

export default function CouriersPage() {
  const { t } = useTranslation('admin');
  const { direction, lang } = useLanguage();
  const STATUS_CONFIG = getStatusConfig(t);
  const VEHICLE_LABELS = getVehicleLabels(t);
  const [couriers, setCouriers]         = useState<CourierWithBatches[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Courier['status']>('all');
  const [search, setSearch]             = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [autoRefresh, setAutoRefresh]   = useState(false);
  const [addresses, setAddresses]       = useState<Record<string, string | null>>({});
  const geocodingRef                    = useRef(false);
  const [archiveTarget, setArchiveTarget] = useState<CourierWithBatches | null>(null);
  const [archiving, setArchiving]         = useState(false);
  const [archiveError, setArchiveError]   = useState('');
  const [archiveBlock, setArchiveBlock]   = useState<{ activeCount?: number } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<CourierWithBatches | null>(null);
  const [restoring, setRestoring]         = useState(false);
  const [restoreError, setRestoreError]   = useState('');
  const [messageTarget, setMessageTarget] = useState<CourierWithBatches | null>(null);
  const [openMenuId, setOpenMenuId]     = useState<string | null>(null);
  const [menuPos, setMenuPos]           = useState<{ top: number; left: number } | null>(null);
  const menuRef                         = useRef<HTMLDivElement | null>(null);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [perfStats, setPerfStats]       = useState<Record<string, CourierTodayMinutes>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    const [{ data: courierRows, error: cErr }, { data: batchRows }] = await Promise.all([
      supabase
        .from('couriers')
        .select('id, name, status, home_base_zone, home_base, location, max_volume, hours_driven_today, user_id, id_front_url, id_back_url, license_front_url, license_back_url, is_archived')
        .order('name'),
      supabase.from('batches').select('assigned_to').in('status', ['assigned', 'in_transit']),
    ]);

    if (cErr) { setError(t('couriers.loadError', { error: cErr.message })); setLoading(false); return; }

    // Enrich with personal info from delivery_applications via Users
    const userIds = (courierRows ?? []).map((c: any) => c.user_id).filter(Boolean);
    const [{ data: userRows }, { data: deliveryApps }] = await Promise.all([
      userIds.length > 0
        ? supabase.from('Users').select('user_id, email').in('user_id', userIds)
        : Promise.resolve({ data: [] as { user_id: string; email: string }[], error: null }),
      supabase
        .from('delivery_applications')
        .select('platform_email, email, phone_number, type_of_vehicle')
        .eq('status', 'approved'),
    ]);

    const platformEmailByUserId: Record<string, string> = {};
    for (const u of userRows ?? []) platformEmailByUserId[u.user_id] = u.email;

    const appByPlatformEmail: Record<string, { email: string | null; phone_number: string | null; type_of_vehicle: string | null }> = {};
    for (const a of deliveryApps ?? []) if (a.platform_email) appByPlatformEmail[a.platform_email] = a;

    const activeCounts: Record<string, number> = {};
    for (const b of batchRows ?? []) {
      if (b.assigned_to) activeCounts[b.assigned_to] = (activeCounts[b.assigned_to] ?? 0) + 1;
    }

    const loaded: CourierWithBatches[] = (courierRows ?? []).map((c: any) => {
      const platformEmail = c.user_id ? (platformEmailByUserId[c.user_id] ?? null) : null;
      const appData       = platformEmail ? (appByPlatformEmail[platformEmail] ?? null) : null;
      return {
        ...c,
        activeBatches:   activeCounts[c.id] ?? 0,
        email:           appData?.email ?? null, // personal email from the application
        phone_number:    appData?.phone_number    ?? null,
        type_of_vehicle: appData?.type_of_vehicle ?? null,
      };
    });

    setCouriers(loaded);
    setLoading(false);
    geocodeAll(loaded);
    loadPerformance(loaded.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  async function loadPerformance(courierIds: string[]) {
    if (!courierIds.length) { setPerfStats({}); return; }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`/api/admin/couriers/work-summary/today?courier_ids=${courierIds.join(',')}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (res.ok && json.success) setPerfStats(json.summaries ?? {});
    } catch (err) {
      console.error('[CouriersPage] performance fetch failed:', err);
    }
  }

  async function geocodeAll(rows: CourierWithBatches[]) {
    if (geocodingRef.current) return;
    geocodingRef.current = true;
    for (const c of rows) {
      if (!c.location?.lat || !c.location?.lng) continue;
      setAddresses(prev => {
        if (prev[c.id] !== undefined) return prev;
        return { ...prev, [c.id]: '' };
      });
      const addr = await reverseGeocode(c.location.lat, c.location.lng, lang);
      setAddresses(prev => ({ ...prev, [c.id]: addr }));
      await new Promise(r => setTimeout(r, 350));
    }
    geocodingRef.current = false;
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    setArchiveError('');
    const force = archiveBlock !== null;
    const res = await archiveCourier(archiveTarget.id, { force });
    if (!res.ok) {
      if (res.code === 'ACTIVE_BATCHES') {
        setArchiveBlock({ activeCount: res.activeCount });
        setArchiving(false);
        return;
      }
      setArchiveError(t('couriers.deleteFailed', { error: res.error ?? '' }));
      setArchiving(false);
      return;
    }
    setCouriers(prev => prev.map(c => c.id === archiveTarget.id ? { ...c, is_archived: true } : c));
    closeArchiveDialog();
    setArchiving(false);
  }

  function closeArchiveDialog() {
    setArchiveTarget(null);
    setArchiveError('');
    setArchiveBlock(null);
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreError('');
    const res = await restoreCourier(restoreTarget.id);
    if (!res.ok) { setRestoreError(t('couriers.restoreFailed', { error: res.error ?? '' })); setRestoring(false); return; }
    setCouriers(prev => prev.map(c => c.id === restoreTarget.id ? { ...c, is_archived: false } : c));
    setRestoreTarget(null);
    setRestoring(false);
  }

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  useEffect(() => {
    const ch = supabase
      .channel('admin-couriers-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couriers' }, async (payload) => {
        const updated = payload.new as Partial<CourierWithBatches>;
        setCouriers(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
        const loc = updated.location as { lat: number; lng: number } | null;
        if (loc?.lat && loc?.lng && updated.id) {
          setAddresses(prev => ({ ...prev, [updated.id!]: '' }));
          const addr = await reverseGeocode(loc.lat, loc.lng, lang);
          setAddresses(prev => ({ ...prev, [updated.id!]: addr }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCouriers = couriers.filter(c => !c.is_archived);
  const counts = {
    all:       activeCouriers.length,
    available: activeCouriers.filter(c => c.status === 'available').length,
    on_route:  activeCouriers.filter(c => c.status === 'on_route').length,
    offline:   activeCouriers.filter(c => c.status === 'offline').length,
  };
  const archivedCount = couriers.length - activeCouriers.length;

  const visible = couriers
    .filter(c => showArchived ? c.is_archived : !c.is_archived)
    .filter(c => statusFilter === 'all' || c.status === statusFilter)
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
                 (c.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
                 (c.phone_number ?? '').includes(search));

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction, color: '#0F2B4E' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
        .admin-stat-card {
          background: #fff; border-radius: 14px; padding: 12px 14px 10px;
          display: flex; flex-direction: column; gap: 4px;
          border: 1px solid #f0ede8; box-shadow: 0 1px 4px rgba(26,26,46,0.05);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .admin-stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
        .admin-stats-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
        .admin-stat-icon { width: 30px; height: 30px; border-radius: 8px; }
        .admin-stat-value { font-size: 26px; font-weight: 800; color: #111827; line-height: 1; }
        .admin-stat-sub { font-size: 11px; color: #6b7280; font-weight: 500; margin-top: 2px; }
        @media (max-width: 768px) {
          .admin-stats-strip { grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
          .admin-stat-card { padding: 8px 10px 7px; border-radius: 11px; }
          .admin-stat-icon { width: 26px; height: 26px; }
          .admin-stat-value { font-size: 18px; }
        }
        .courier-expand-btn {
          width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid #E2E8F0;
          background: #fff; color: #64748B; cursor: pointer; display: flex;
          align-items: center; justify-content: center; font-size: 14px; transition: all 0.15s;
        }
        .courier-expand-btn:hover { background: #F1F5F9; }
        .courier-expand-btn.active { background: #EFF6FF; border-color: #93C5FD; color: #2563eb; }
        .courier-detail-panel {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 14px; padding: 16px; background: #fff;
          border-radius: 10px; border: 1px solid #E2E8F0;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.03);
        }
        .courier-detail-docs {
          grid-column: 1 / -1; display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start;
          padding-top: 12px; border-top: 1px solid #F1F5F9; margin-top: 4px;
        }
      `}</style>

      {messageTarget && (
        <AdminMessageModal
          recipientName={messageTarget.name}
          recipientId={messageTarget.id}
          onClose={() => setMessageTarget(null)}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          title={t('couriers.confirmDeleteTitle')}
          icon="🗑️"
          message={t('couriers.confirmDeleteMessage', { name: archiveTarget.name })}
          warning={
            archiveBlock
              ? t('couriers.deleteBlockedWarning', { count: archiveBlock.activeCount })
              : archiveTarget.activeBatches > 0
                ? t('couriers.hasActiveBatchesWarning', { count: archiveTarget.activeBatches })
                : undefined
          }
          confirmColor="#DC2626"
          confirmLabel={archiveBlock ? t('couriers.deleteDespiteActive') : t('couriers.delete')}
          reversible
          loading={archiving}
          error={archiveError}
          onConfirm={handleArchive}
          onCancel={closeArchiveDialog}
        />
      )}

      {restoreTarget && (
        <ConfirmDialog
          title={t('couriers.confirmRestoreTitle')}
          icon="♻️"
          message={t('couriers.confirmRestoreMessage', { name: restoreTarget.name })}
          confirmColor="#16a34a"
          confirmLabel={t('couriers.restore')}
          reversible
          loading={restoring}
          error={restoreError}
          onConfirm={handleRestore}
          onCancel={() => { setRestoreTarget(null); setRestoreError(''); }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t('couriers.title')}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#64748B' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            {t('couriers.autoRefresh15s')}
          </label>
          <button onClick={load} disabled={loading}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ↻ {t('couriers.refresh')}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="admin-stats-strip">
        {[
          {
            label: t('couriers.stats.total'), sub: t('couriers.stats.totalSub'), value: counts.all,
            iconBg: '#eff6ff', iconColor: '#2563eb',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
          },
          {
            label: t('couriers.status.available'), sub: t('couriers.stats.availableSub'), value: counts.available,
            iconBg: '#f0fdf4', iconColor: '#16a34a',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
          },
          {
            label: t('couriers.stats.onRoute'), sub: t('couriers.stats.onRouteSub'), value: counts.on_route,
            iconBg: '#eff6ff', iconColor: '#2563eb',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
          },
          {
            label: t('couriers.status.offline'), sub: t('couriers.stats.offlineSub'), value: counts.offline,
            iconBg: '#f1f5f9', iconColor: '#64748b',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
          },
        ].map(s => (
          <div key={s.label} className="admin-stat-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.label}</span>
              <div className="admin-stat-icon" style={{ background: s.iconBg, color: s.iconColor, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {s.icon}
              </div>
            </div>
            <div className="admin-stat-value">{s.value}</div>
            <div className="admin-stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter + Search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'available', 'on_route', 'offline'] as const).map(s => {
          const active = statusFilter === s;
          const cfg = s !== 'all' ? STATUS_CONFIG[s] : null;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 13px', borderRadius: 20, border: '1.5px solid',
                borderColor: active ? (cfg ? cfg.border : '#0F2B4E') : '#E2E8F0',
                background:  active ? (cfg ? cfg.bg   : '#0F2B4E') : '#fff',
                color:       active ? (cfg ? cfg.text  : '#fff')   : '#64748B',
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: active ? 700 : 400,
              }}>
              {s === 'all' ? t('couriers.all') : STATUS_CONFIG[s].label}
              <span style={{ marginRight: 5, fontFamily: 'monospace', opacity: 0.8 }}>{counts[s]}</span>
            </button>
          );
        })}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('couriers.searchPlaceholder')}
          style={{
            marginRight: 'auto', padding: '6px 12px', borderRadius: 8,
            border: '1.5px solid #E2E8F0', fontSize: 12, fontFamily: 'inherit',
            color: '#0F2B4E', outline: 'none', minWidth: 220,
          }}
        />

        {/* Deleted items (soft-deleted) — kept separate from the main status filters */}
        <button
          onClick={() => setShowArchived(v => !v)}
          title={t('couriers.showDeletedItems')}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 13px', borderRadius: 20, border: '1.5px solid',
            borderColor: showArchived ? '#94A3B8' : '#E2E8F0',
            background:  showArchived ? '#475569' : '#fff',
            color:       showArchived ? '#fff' : '#64748B',
            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: showArchived ? 700 : 400,
          }}>
          🗑️ {t('couriers.trashBin')}
          {archivedCount > 0 && (
            <span style={{ fontFamily: 'monospace', opacity: 0.8 }}>{archivedCount}</span>
          )}
        </button>
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('couriers.loading')}</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('couriers.noCouriers')}</div>
      ) : (
        <div className="adm-scroll" style={{ overflowX: 'auto', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff' }}>
          <table className="adm-rtable" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('couriers.table.courier')}</th>
                <th style={thStyle}>{t('couriers.table.status')}</th>
                <th style={thStyle}>{t('couriers.table.homeZone')}</th>
                <th style={thStyle}>{t('couriers.table.activeBatches')}</th>
                <th style={thStyle}>{t('couriers.table.capacity')}</th>
                <th style={thStyle}>{t('couriers.table.hoursToday')}</th>
                <th style={thStyle}>{t('couriers.table.lastLocation')}</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>{t('couriers.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(courier => {
                const addr    = addresses[courier.id];
                const hasLoc  = !!(courier.location?.lat && courier.location?.lng);
                const mapsUrl = hasLoc
                  ? `https://www.google.com/maps?q=${courier.location!.lat},${courier.location!.lng}`
                  : undefined;
                const isExpanded = expandedId === courier.id;
                const hasDocs = !!(courier.id_front_url || courier.id_back_url || courier.license_front_url || courier.license_back_url);
                const hasPersonal = !!(courier.email || courier.phone_number || courier.type_of_vehicle || hasDocs);

                return (
                  <>
                    <tr
                      key={courier.id}
                      style={{ transition: 'background 0.1s', background: isExpanded ? '#F8FAFC' : '#fff' }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#F8FAFC'; }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = '#fff'; }}
                    >
                      {/* Name + vehicle badge */}
                      <td style={tdStyle} data-label={t('couriers.table.courier')}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Dot status={courier.status} />
                          <div>
                            <div style={{ fontWeight: 700 }}>{courier.name}</div>
                            <div style={{ display: 'flex', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                              {courier.type_of_vehicle && (
                                <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>
                                  {VEHICLE_LABELS[courier.type_of_vehicle] ?? courier.type_of_vehicle}
                                </span>
                              )}
                              <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>
                                {courier.id.slice(0, 8).toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={tdStyle} data-label={t('couriers.table.status')}><StatusBadge status={courier.status} /></td>

                      {/* Zone */}
                      <td style={tdStyle} data-label={t('couriers.table.homeZone')}>
                        {courier.home_base_zone
                          ? <span style={{ background: '#F1F5F9', color: '#0F2B4E', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{courier.home_base_zone}</span>
                          : <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>

                      {/* Active batches */}
                      <td style={tdStyle} data-label={t('couriers.table.activeBatches')}>
                        {courier.activeBatches > 0
                          ? <span style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{courier.activeBatches}</span>
                          : <span style={{ color: '#CBD5E1', fontSize: 12 }}>0</span>}
                      </td>

                      {/* Max volume */}
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }} data-label={t('couriers.table.capacity')}>
                        {courier.max_volume != null ? t('couriers.volumeUnit', { volume: courier.max_volume }) : <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>

                      {/* Hours today */}
                      <td style={tdStyle} data-label={t('couriers.table.hoursToday')}>
                        <div style={{ fontFamily: 'monospace' }}>
                          {courier.hours_driven_today != null
                            ? t('couriers.hoursUnit', { hours: courier.hours_driven_today.toFixed(1) })
                            : <span style={{ color: '#CBD5E1' }}>—</span>}
                        </div>
                        <PerformanceBadge minutes={perfStats[courier.id]} />
                      </td>

                      {/* Location */}
                      <td style={tdStyle} data-label={t('couriers.table.lastLocation')}>
                        {!hasLoc ? (
                          <span style={{ color: '#CBD5E1', fontSize: 12 }}>{t('couriers.unknown')}</span>
                        ) : (
                          <a href={mapsUrl} target="_blank" rel="noreferrer"
                            style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}>
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                            </svg>
                            <span style={{ fontSize: 12, lineHeight: 1.4 }}>
                              {addr === ''
                                ? <span style={{ color: '#94A3B8' }}>{t('couriers.locating')}</span>
                                : addr
                                ? addr
                                : <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                    {courier.location!.lat.toFixed(4)}, {courier.location!.lng.toFixed(4)}
                                  </span>}
                            </span>
                          </a>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ ...tdStyle, textAlign: 'center' }} data-label={t('couriers.table.actions')}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                          {/* Expand personal info toggle */}
                          {hasPersonal && (
                            <button
                              className={`courier-expand-btn${isExpanded ? ' active' : ''}`}
                              title={isExpanded ? t('couriers.hidePersonalInfo') : t('couriers.showPersonalInfo')}
                              onClick={() => setExpandedId(prev => prev === courier.id ? null : courier.id)}
                            >
                              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                              </svg>
                            </button>
                          )}

                          {/* 3-dot menu */}
                          <div style={{ position: 'relative', display: 'inline-block' }}
                            ref={openMenuId === courier.id ? menuRef : null}>
                            <button
                              onClick={e => {
                                if (openMenuId === courier.id) { setOpenMenuId(null); return; }
                                const r = e.currentTarget.getBoundingClientRect();
                                setMenuPos({ top: r.bottom + 4, left: r.left });
                                setOpenMenuId(courier.id);
                              }}
                              title={t('couriers.moreActions')}
                              style={{
                                width: 32, height: 32, borderRadius: 8,
                                border: '1.5px solid #E2E8F0',
                                background: openMenuId === courier.id ? '#F1F5F9' : '#fff',
                                color: '#475569', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 18, lineHeight: 1, fontWeight: 700,
                                transition: 'background 0.1s',
                              }}>
                              ···
                            </button>

                            {openMenuId === courier.id && menuPos && (
                              <div style={{
                                position: 'fixed', top: menuPos.top, left: menuPos.left,
                                background: '#fff', border: '1.5px solid #E2E8F0',
                                borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
                                zIndex: 1000, minWidth: 148, overflow: 'hidden',
                              }}>
                                <button
                                  onClick={() => { setOpenMenuId(null); setMessageTarget(courier); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#EFF6FF')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                  </svg>
                                  {t('couriers.sendMessage')}
                                </button>
                                <div style={{ height: 1, background: '#F1F5F9', margin: '2px 0' }} />
                                {courier.is_archived ? (
                                  <button
                                    onClick={() => { setOpenMenuId(null); setRestoreTarget(courier); setRestoreError(''); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', color: '#15803D', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                                    <span>♻️</span> {t('couriers.restore')}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => { setOpenMenuId(null); setArchiveTarget(courier); setArchiveError(''); setArchiveBlock(null); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#FEF2F2')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                                    <span>🗑️</span> {t('couriers.delete')}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded personal info panel */}
                    {isExpanded && (
                      <tr key={`${courier.id}-detail`}>
                        <td colSpan={8} style={{ padding: '0 14px 14px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                          <div className="courier-detail-panel">
                            <InfoRow label={t('couriers.detail.email')} value={
                              courier.email
                                ? <a href={`mailto:${courier.email}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{courier.email}</a>
                                : null
                            } />
                            <InfoRow label={t('couriers.detail.phone')} value={
                              courier.phone_number
                                ? <a href={`tel:${courier.phone_number}`} style={{ color: '#0F2B4E', textDecoration: 'none' }}>{courier.phone_number}</a>
                                : null
                            } />
                            <InfoRow label={t('couriers.detail.vehicleType')} value={
                              courier.type_of_vehicle
                                ? <span style={{ background: '#F1F5F9', color: '#334155', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                                    {VEHICLE_LABELS[courier.type_of_vehicle] ?? courier.type_of_vehicle}
                                  </span>
                                : null
                            } />
                            {hasDocs && (
                              <div className="courier-detail-docs">
                                <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, marginLeft: 4, alignSelf: 'flex-start', marginTop: 4 }}>{t('couriers.detail.documents')}:</span>
                                {courier.id_front_url && (
                                  <DocImage label={`💳 ${t('couriers.detail.idFront')}`} path={courier.id_front_url} bucket="delivery-applications" />
                                )}
                                {courier.id_back_url && (
                                  <DocImage label={`💳 ${t('couriers.detail.idBack')}`} path={courier.id_back_url} bucket="delivery-applications" />
                                )}
                                {courier.license_front_url && (
                                  <DocImage label={`🚗 ${t('couriers.detail.licenseFront')}`} path={courier.license_front_url} bucket="delivery-applications" />
                                )}
                                {courier.license_back_url && (
                                  <DocImage label={`🚗 ${t('couriers.detail.licenseBack')}`} path={courier.license_back_url} bucket="delivery-applications" />
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
