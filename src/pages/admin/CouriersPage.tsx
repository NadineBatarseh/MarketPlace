import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../../lib/supabase';
import ConfirmDialog from '../../components/ConfirmDialog';
import AdminMessageModal from '../../components/AdminMessageModal';

interface Courier {
  id: string;
  name: string;
  status: 'available' | 'on_route' | 'offline';
  home_base_zone: string | null;
  home_base: { lat: number; lng: number } | null;
  location: { lat: number; lng: number } | null;
  max_volume: number | null;
  hours_driven_today: number | null;
}

interface CourierWithBatches extends Courier {
  activeBatches: number;
}

const STATUS_CONFIG = {
  available: { label: 'متاح',       bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
  on_route:  { label: 'في الطريق',  bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' },
  offline:   { label: 'غير متصل',  bg: '#F8FAFC', text: '#64748B', border: '#CBD5E1' },
};

// Reverse-geocode a coordinate using Nominatim (free, no key required).
// Returns a short human-readable label in Arabic, or null on failure.
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar`,
      { headers: { 'Accept-Language': 'ar' } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const a = json.address ?? {};
    // Build a concise label: road/neighbourhood + city/town/village
    const street = a.road ?? a.neighbourhood ?? a.suburb ?? '';
    const city   = a.city ?? a.town ?? a.village ?? a.county ?? '';
    if (street && city) return `${street}، ${city}`;
    return city || street || json.display_name?.split(',')[0] || null;
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: Courier['status'] }) {
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
  const [couriers, setCouriers]         = useState<CourierWithBatches[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Courier['status']>('all');
  const [search, setSearch]             = useState('');
  const [autoRefresh, setAutoRefresh]   = useState(false);
  const [addresses, setAddresses]       = useState<Record<string, string | null>>({});
  const geocodingRef                    = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<CourierWithBatches | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [deleteError, setDeleteError]   = useState('');
  const [messageTarget, setMessageTarget] = useState<CourierWithBatches | null>(null);
  const [openMenuId, setOpenMenuId]     = useState<string | null>(null);
  const menuRef                         = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    const [{ data: courierRows, error: cErr }, { data: batchRows }] = await Promise.all([
      supabase.from('couriers').select('id, name, status, home_base_zone, home_base, location, max_volume, hours_driven_today').order('name'),
      supabase.from('batches').select('assigned_to').in('status', ['assigned', 'in_transit']),
    ]);

    if (cErr) { setError('تعذّر تحميل البيانات: ' + cErr.message); setLoading(false); return; }

    const activeCounts: Record<string, number> = {};
    for (const b of batchRows ?? []) {
      if (b.assigned_to) activeCounts[b.assigned_to] = (activeCounts[b.assigned_to] ?? 0) + 1;
    }

    const loaded = (courierRows ?? []).map((c: any) => ({ ...c, activeBatches: activeCounts[c.id] ?? 0 }));
    setCouriers(loaded);
    setLoading(false);
    geocodeAll(loaded);
  }, []);

  // Sequentially reverse-geocode each courier with a location, 350 ms apart
  // to respect Nominatim's 1 req/sec policy.
  async function geocodeAll(rows: CourierWithBatches[]) {
    if (geocodingRef.current) return;
    geocodingRef.current = true;

    for (const c of rows) {
      if (!c.location?.lat || !c.location?.lng) continue;
      // Skip if we already have an address for this courier
      setAddresses(prev => {
        if (prev[c.id] !== undefined) return prev;
        return { ...prev, [c.id]: '' }; // '' = loading sentinel
      });

      const addr = await reverseGeocode(c.location.lat, c.location.lng);
      setAddresses(prev => ({ ...prev, [c.id]: addr }));

      // 350 ms gap between requests
      await new Promise(r => setTimeout(r, 350));
    }

    geocodingRef.current = false;
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    const { error: err } = await supabase.from('couriers').delete().eq('id', deleteTarget.id);
    if (err) {
      setDeleteError('فشل الحذف: ' + err.message);
      setDeleting(false);
      return;
    }
    setCouriers(prev => prev.filter(c => c.id !== deleteTarget.id));
    setAddresses(prev => { const next = { ...prev }; delete next[deleteTarget.id]; return next; });
    setDeleteTarget(null);
    setDeleting(false);
  }

  function openMessageModal(courier: CourierWithBatches) {
    setMessageTarget(courier);
  }

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Realtime status + location updates
  useEffect(() => {
    const ch = supabase
      .channel('admin-couriers-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couriers' }, async (payload) => {
        const updated = payload.new as Partial<CourierWithBatches>;
        setCouriers(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));

        // Re-geocode if location changed
        const loc = updated.location as { lat: number; lng: number } | null;
        if (loc?.lat && loc?.lng && updated.id) {
          setAddresses(prev => ({ ...prev, [updated.id!]: '' }));
          const addr = await reverseGeocode(loc.lat, loc.lng);
          setAddresses(prev => ({ ...prev, [updated.id!]: addr }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const counts = {
    all:       couriers.length,
    available: couriers.filter(c => c.status === 'available').length,
    on_route:  couriers.filter(c => c.status === 'on_route').length,
    offline:   couriers.filter(c => c.status === 'offline').length,
  };

  const visible = couriers
    .filter(c => statusFilter === 'all' || c.status === statusFilter)
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction: 'rtl', color: '#0F2B4E' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
        .admin-stat-card {
          background: #fff;
          border-radius: 14px;
          padding: 12px 14px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          border: 1px solid #f0ede8;
          box-shadow: 0 1px 4px rgba(26,26,46,0.05);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .admin-stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
      `}</style>

      {messageTarget && (
        <AdminMessageModal
          recipientName={messageTarget.name}
          recipientId={messageTarget.id}
          onClose={() => setMessageTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="تأكيد حذف المندوب"
          message={<>هل أنت متأكد من حذف المندوب <strong>{deleteTarget.name}</strong>؟</>}
          warning={deleteTarget.activeBatches > 0
            ? `تحذير: لدى هذا المندوب ${deleteTarget.activeBatches} دفعة نشطة حالياً.`
            : undefined}
          confirmLabel="حذف"
          loading={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>المناديب</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#64748B' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            تحديث تلقائي كل 15 ث
          </label>
          <button onClick={load} disabled={loading}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ↻ تحديث
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {[
          {
            label: 'الإجمالي', sub: 'إجمالي المناديب', value: counts.all,
            iconBg: '#eff6ff', iconColor: '#2563eb',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
          },
          {
            label: 'متاح', sub: 'جاهز للتوصيل', value: counts.available,
            iconBg: '#f0fdf4', iconColor: '#16a34a',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
          },
          {
            label: 'في الطريق', sub: 'نشط الآن', value: counts.on_route,
            iconBg: '#eff6ff', iconColor: '#2563eb',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
          },
          {
            label: 'غير متصل', sub: 'خارج الخدمة', value: counts.offline,
            iconBg: '#f1f5f9', iconColor: '#64748b',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
          },
        ].map(s => (
          <div key={s.label} className="admin-stat-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.label}</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: s.iconBg, color: s.iconColor, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {s.icon}
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter + Search row */}
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
              {s === 'all' ? 'الكل' : STATUS_CONFIG[s].label}
              <span style={{ marginRight: 5, fontFamily: 'monospace', opacity: 0.8 }}>{counts[s]}</span>
            </button>
          );
        })}

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم المندوب..."
          style={{
            marginRight: 'auto', padding: '6px 12px', borderRadius: 8,
            border: '1.5px solid #E2E8F0', fontSize: 12, fontFamily: 'inherit',
            color: '#0F2B4E', outline: 'none', minWidth: 200,
          }}
        />
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا يوجد مناديب</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>الاسم</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>المنطقة الرئيسية</th>
                <th style={thStyle}>الدفعات النشطة</th>
                <th style={thStyle}>الطاقة الاستيعابية</th>
                <th style={thStyle}>ساعات اليوم</th>
                <th style={thStyle}>آخر موقع</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(courier => {
                const addr    = addresses[courier.id];
                const hasLoc  = !!(courier.location?.lat && courier.location?.lng);
                const mapsUrl = hasLoc
                  ? `https://www.google.com/maps?q=${courier.location!.lat},${courier.location!.lng}`
                  : undefined;

                return (
                  <tr key={courier.id} style={{ transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>

                    {/* Name */}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Dot status={courier.status} />
                        <div>
                          <div style={{ fontWeight: 700 }}>{courier.name}</div>
                          <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace', marginTop: 1 }}>
                            {courier.id.slice(0, 8).toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td style={tdStyle}><StatusBadge status={courier.status} /></td>

                    {/* Zone */}
                    <td style={tdStyle}>
                      {courier.home_base_zone
                        ? <span style={{ background: '#F1F5F9', color: '#0F2B4E', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{courier.home_base_zone}</span>
                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>

                    {/* Active batches */}
                    <td style={tdStyle}>
                      {courier.activeBatches > 0
                        ? <span style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{courier.activeBatches}</span>
                        : <span style={{ color: '#CBD5E1', fontSize: 12 }}>0</span>}
                    </td>

                    {/* Max volume */}
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                      {courier.max_volume != null ? `${courier.max_volume} وحدة` : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>

                    {/* Hours today */}
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                      {courier.hours_driven_today != null
                        ? `${courier.hours_driven_today.toFixed(1)} س`
                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>

                    {/* Location — shows address in words, links to Google Maps */}
                    <td style={tdStyle}>
                      {!hasLoc ? (
                        <span style={{ color: '#CBD5E1', fontSize: 12 }}>غير معروف</span>
                      ) : (
                        <a href={mapsUrl} target="_blank" rel="noreferrer"
                          style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                          <span style={{ fontSize: 12, lineHeight: 1.4 }}>
                            {addr === ''
                              ? <span style={{ color: '#94A3B8' }}>جاري التحديد...</span>
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
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ position: 'relative', display: 'inline-block' }}
                        ref={openMenuId === courier.id ? menuRef : null}>

                        {/* Trigger */}
                        <button
                          onClick={() => setOpenMenuId(prev => prev === courier.id ? null : courier.id)}
                          title="المزيد من الإجراءات"
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

                        {/* Dropdown */}
                        {openMenuId === courier.id && (
                          <div style={{
                            position: 'absolute',
                            top: 36, left: 0,
                            background: '#fff',
                            border: '1.5px solid #E2E8F0',
                            borderRadius: 10,
                            boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
                            zIndex: 100,
                            minWidth: 148,
                            overflow: 'hidden',
                          }}>
                            <button
                              onClick={() => { setOpenMenuId(null); openMessageModal(courier); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                width: '100%', padding: '10px 14px',
                                border: 'none', background: 'none',
                                color: '#2563eb', cursor: 'pointer',
                                fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                                textAlign: 'right',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#EFF6FF')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                              </svg>
                              إرسال رسالة
                            </button>

                            <div style={{ height: 1, background: '#F1F5F9', margin: '2px 0' }} />

                            <button
                              onClick={() => { setOpenMenuId(null); setDeleteTarget(courier); setDeleteError(''); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                width: '100%', padding: '10px 14px',
                                border: 'none', background: 'none',
                                color: '#DC2626', cursor: 'pointer',
                                fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                                textAlign: 'right',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#FEF2F2')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                              </svg>
                              حذف
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
