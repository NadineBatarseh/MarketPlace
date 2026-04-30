import React, { useState, useEffect, useCallback } from 'react';
import supabase from '../../lib/supabase';

type BatchStatus = 'pending_assignment' | 'assigned' | 'in_transit' | 'completed' | 'cancelled';

interface BatchRow {
  id: string;
  route: string[];
  ab_shipment_ids: string[];
  bc_shipment_ids: string[];
  status: BatchStatus;
  total_volume: number;
  reserved_until: string | null;
  created_at: string;
  assigned_to: string | null;
  assigned_at: string | null;
  needs_dispatcher: boolean;
  courier_current_zone: string | null;
  estimated_minutes_to_next_zone: number | null;
  couriers: { name: string } | null;
}

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending_assignment: 'بانتظار السائق',
  assigned: 'تم التعيين',
  in_transit: 'في الطريق',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

const STATUS_STYLE: Record<BatchStatus, { bg: string; text: string; border: string }> = {
  pending_assignment: { bg: '#FFF7ED', text: '#C2410C', border: '#FDBA74' },
  assigned:           { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' },
  in_transit:         { bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
  completed:          { bg: '#F8FAFC', text: '#475569', border: '#CBD5E1' },
  cancelled:          { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
};

const ALL_STATUSES: BatchStatus[] = [
  'pending_assignment', 'assigned', 'in_transit', 'completed', 'cancelled',
];

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#0F2B4E', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

export default function BatchMonitorPage() {
  const [batches, setBatches]   = useState<BatchRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [filter, setFilter]     = useState<BatchStatus | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cycling, setCycling]   = useState(false);
  const [cycleMsg, setCycleMsg] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('batches')
      .select('*, couriers!assigned_to(name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (err) setError('تعذّر تحميل البيانات: ' + err.message);
    else setBatches((data ?? []) as BatchRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadBatches, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, loadBatches]);

  const triggerCycle = async () => {
    setCycling(true);
    setCycleMsg('');
    try {
      const res  = await fetch('/api/logistics/cycle', { method: 'POST' });
      const json = await res.json();
      setCycleMsg(json.success ? '✓ اكتملت الدورة بنجاح' : '✗ ' + (json.error ?? 'فشلت الدورة'));
      await loadBatches();
    } catch {
      setCycleMsg('✗ تعذّر الاتصال بالخادم');
    }
    setCycling(false);
    setTimeout(() => setCycleMsg(''), 5000);
  };

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const counts = Object.fromEntries(
    ALL_STATUSES.map(s => [s, batches.filter(b => b.status === s).length])
  ) as Record<BatchStatus, number>;

  const visible = filter === 'all' ? batches : batches.filter(b => b.status === filter);

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction: 'rtl', color: '#0F2B4E' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>مراقبة التجميعات</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#64748B' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            تحديث كل 15 ث
          </label>
          <button onClick={loadBatches} disabled={loading}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ↻ تحديث
          </button>
          <button onClick={triggerCycle} disabled={cycling}
            style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#F97316,#EA580C)', color: '#fff', cursor: cycling ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', opacity: cycling ? 0.7 : 1 }}>
            {cycling ? '⏳ جاري التشغيل...' : '▶ تشغيل دورة التجميع'}
          </button>
        </div>
      </div>

      {cycleMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: cycleMsg.startsWith('✓') ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${cycleMsg.startsWith('✓') ? '#86EFAC' : '#FCA5A5'}`, color: cycleMsg.startsWith('✓') ? '#15803D' : '#DC2626', fontSize: 13, marginBottom: 16 }}>
          {cycleMsg}
        </div>
      )}

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 18 }}>
        {[
          { label: 'الإجمالي',       value: batches.length,            color: '#0F2B4E', bg: '#F8FAFC', border: '#E2E8F0' },
          { label: 'بانتظار السائق', value: counts.pending_assignment, color: '#C2410C', bg: '#FFF7ED', border: '#FDBA74' },
          { label: 'تم التعيين',     value: counts.assigned,           color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD' },
          { label: 'في الطريق',      value: counts.in_transit,         color: '#15803D', bg: '#F0FDF4', border: '#86EFAC' },
          { label: 'مكتملة',         value: counts.completed,          color: '#475569', bg: '#F8FAFC', border: '#CBD5E1' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 10, padding: '10px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['all', ...ALL_STATUSES] as const).map(s => {
          const active = filter === s;
          const col = s !== 'all' ? STATUS_STYLE[s] : null;
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{
                padding: '5px 13px', borderRadius: 20, border: '1.5px solid',
                borderColor: active ? (col ? col.border : '#0F2B4E') : '#E2E8F0',
                background: active ? (col ? col.bg : '#0F2B4E') : '#fff',
                color: active ? (col ? col.text : '#fff') : '#64748B',
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: active ? 700 : 400,
              }}>
              {s === 'all' ? 'الكل' : STATUS_LABELS[s]}
              <span style={{ marginRight: 5, fontFamily: 'monospace', opacity: 0.8 }}>
                {s === 'all' ? batches.length : counts[s]}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {loading && <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>}
      {!loading && visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا توجد تجميعات</div>
      )}

      {/* Batch cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(batch => {
          const col = STATUS_STYLE[batch.status];
          const isOpen = expanded.has(batch.id);
          const totalShipments = batch.ab_shipment_ids.length + batch.bc_shipment_ids.length;
          const shortId = batch.id.slice(0, 8).toUpperCase();

          return (
            <div key={batch.id}
              style={{ background: '#fff', border: `1.5px solid ${isOpen ? col.border : '#E2E8F0'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>

              {/* Card header */}
              <div onClick={() => toggle(batch.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap' }}>

                <span style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}`, borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {STATUS_LABELS[batch.status]}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {batch.route.length > 0
                      ? batch.route.map((zone, i) => (
                          <React.Fragment key={i}>
                            <span style={{ background: '#F1F5F9', color: '#0F2B4E', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{zone}</span>
                            {i < batch.route.length - 1 && <span style={{ color: '#94A3B8', fontSize: 11 }}>←</span>}
                          </React.Fragment>
                        ))
                      : <span style={{ color: '#94A3B8', fontSize: 11 }}>لا يوجد مسار</span>
                    }
                  </div>
                  <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>#{shortId}</span>
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                  <Chip icon="📦" label={`${totalShipments} شحنة`} />
                  <Chip icon="⚖" label={`${batch.total_volume} وحدة`} />
                  {batch.couriers?.name && <Chip icon="🚗" label={batch.couriers.name} color="blue" />}
                  {batch.needs_dispatcher && <Chip icon="⚠" label="يحتاج مشرف" color="red" />}
                </div>

                <span style={{ color: '#94A3B8', fontSize: 12, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
              </div>

              {/* Expanded details */}
              {isOpen && (
                <div style={{ borderTop: `1px solid ${col.border}`, padding: '14px 16px', background: col.bg }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 14 }}>
                    <Detail label="معرّف الدفعة" value={batch.id} mono />
                    <Detail label="تاريخ الإنشاء" value={new Date(batch.created_at).toLocaleString('ar-EG')} />
                    <Detail label="شحنات أ→ب" value={`${batch.ab_shipment_ids.length} شحنة`} />
                    <Detail label="شحنات ب→ج" value={`${batch.bc_shipment_ids.length} شحنة`} />
                    <Detail label="الحجم الكلي" value={`${batch.total_volume} وحدة`} />
                    {batch.assigned_at && <Detail label="وقت التعيين" value={new Date(batch.assigned_at).toLocaleString('ar-EG')} />}
                    {batch.reserved_until && <Detail label="محجوز حتى" value={new Date(batch.reserved_until).toLocaleString('ar-EG')} />}
                    {batch.courier_current_zone && <Detail label="منطقة السائق الحالية" value={batch.courier_current_zone} />}
                    {batch.estimated_minutes_to_next_zone != null && (
                      <Detail label="دقائق للمنطقة التالية" value={`${batch.estimated_minutes_to_next_zone} د`} />
                    )}
                  </div>
                  {batch.ab_shipment_ids.length > 0 && (
                    <IdPillGroup label="شحنات المنطقة أ→ب" ids={batch.ab_shipment_ids} />
                  )}
                  {batch.bc_shipment_ids.length > 0 && (
                    <IdPillGroup label="شحنات المنطقة ب→ج" ids={batch.bc_shipment_ids} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ icon, label, color }: { icon: string; label: string; color?: 'blue' | 'red' }) {
  const styles = {
    blue: { bg: '#EFF6FF', border: '#93C5FD', text: '#1D4ED8' },
    red:  { bg: '#FEF2F2', border: '#FCA5A5', text: '#DC2626' },
  };
  const s = color ? styles[color] : { bg: '#F8FAFC', border: '#E2E8F0', text: '#475569' };
  return (
    <span style={{ fontSize: 11, color: s.text, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {icon} {label}
    </span>
  );
}

function IdPillGroup({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {ids.map(id => (
          <span key={id} style={{ fontFamily: 'monospace', fontSize: 10, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '2px 6px', color: '#475569' }}>
            {id.slice(0, 8)}…
          </span>
        ))}
      </div>
    </div>
  );
}
