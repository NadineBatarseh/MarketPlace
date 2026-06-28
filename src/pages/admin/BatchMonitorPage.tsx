import React, { useState, useEffect, useCallback } from 'react';
import supabase from '../../lib/supabase';

type BatchStatus = 'pending_assignment' | 'assigned' | 'in_transit' | 'completed' | 'cancelled';

interface BatchRow {
  id: string;
  batch_number: string;
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
  estimated_minutes_to_next_zone: number | null;
  couriers: { name: string } | null;
}

interface ShipmentDetail {
  id: string;
  status: string;
  pickup_zone: string;
  dropoff_zone: string;
  direction: 'ab' | 'bc';
  order_details: {
    order_id: number;
    qty: number;
    unit_price: number;
    products: { title: string } | null;
    shops: { name: string } | null;
  } | null;
}

interface UnbatchedShipment {
  id: string;
  shipment_number: string;
  status: string;
  pickup_zone: string;
  dropoff_zone: string;
  created_at: string;
  delayed_reason: string | null;
  urgency_score: number;
}

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending_assignment: 'بانتظار السائق',
  assigned: 'تم التعيين',
  in_transit: 'في الطريق',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  available:          'متاحة',
  delayed:            'متأخرة',
  claimed:            'محجوزة',
  in_transit:         'في الطريق',
  delivered:          'تم التوصيل',
  cancelled:          'ملغية',
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

interface CourierOption {
  id: string;
  name: string;
  status: string;
}

export default function BatchMonitorPage() {
  const [batches, setBatches]   = useState<BatchRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [filter, setFilter]     = useState<BatchStatus | 'all' | 'unbatched'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cycling, setCycling]   = useState(false);
  const [cycleMsg, setCycleMsg] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [shipmentDetails, setShipmentDetails] = useState<Record<string, ShipmentDetail[]>>({});
  const [loadingDetails, setLoadingDetails]   = useState<Set<string>>(new Set());

  // Manual dispatcher assignment
  const [couriers, setCouriers]               = useState<CourierOption[]>([]);
  const [selectedCourier, setSelectedCourier] = useState<Record<string, string>>({});
  const [assigning, setAssigning]             = useState<Set<string>>(new Set());
  const [assignMsg, setAssignMsg]             = useState<Record<string, string>>({});

  // Unbatched individual shipments
  const [unbatchedShipments, setUnbatchedShipments] = useState<UnbatchedShipment[]>([]);

  // In-transit shipment additions (Phase 8)
  interface CompatibleShipment { id: string; shipment_number: string; pickup_zone: string; dropoff_zone: string; status: string; }
  const [compatibleShipments, setCompatibleShipments] = useState<Record<string, CompatibleShipment[]>>({});
  const [loadingCompatible, setLoadingCompatible]     = useState<Set<string>>(new Set());
  const [selectedShipments, setSelectedShipments]     = useState<Record<string, Set<string>>>({});
  const [addingShipments, setAddingShipments]         = useState<Set<string>>(new Set());
  const [addShipmentMsg, setAddShipmentMsg]           = useState<Record<string, string>>({});

  const loadUnbatched = useCallback(async () => {
    const { data } = await supabase
      .from('shipments')
      .select('id, shipment_number, status, pickup_zone, dropoff_zone, created_at, delayed_reason, urgency_score')
      .is('batch_id', null)
      .in('status', ['available', 'delayed'])
      .order('created_at', { ascending: false })
      .limit(200);
    setUnbatchedShipments((data ?? []) as UnbatchedShipment[]);
  }, []);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    const [{ data, error: err }] = await Promise.all([
      supabase
        .from('batches')
        .select('*, couriers!assigned_to(name)')
        .order('created_at', { ascending: false })
        .limit(200),
      loadUnbatched(),
    ]);
    if (err) setError('تعذّر تحميل البيانات: ' + err.message);
    else setBatches((data ?? []) as BatchRow[]);
    setLoading(false);
  }, [loadUnbatched]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadBatches, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, loadBatches]);

  useEffect(() => {
    supabase.from('couriers').select('id, name, status').then(({ data }) => {
      if (data) setCouriers(data as CourierOption[]);
    });
  }, []);

  const loadCompatibleShipments = useCallback(async (batch: BatchRow) => {
    if (batch.status !== 'in_transit' || batch.route.length < 2) return;
    const zoneB = batch.route[1];
    setLoadingCompatible(prev => new Set(prev).add(batch.id));
    const { data } = await supabase
      .from('shipments')
      .select('id, shipment_number, pickup_zone, dropoff_zone, status')
      .eq('pickup_zone', zoneB)
      .in('status', ['available', 'delayed'])
      .is('batch_id', null)
      .limit(50);
    if (data) setCompatibleShipments(prev => ({ ...prev, [batch.id]: data as CompatibleShipment[] }));
    setLoadingCompatible(prev => { const next = new Set(prev); next.delete(batch.id); return next; });
  }, []);

  const loadShipmentDetails = useCallback(async (batch: BatchRow) => {
    const allIds = [...batch.ab_shipment_ids, ...batch.bc_shipment_ids];
    if (allIds.length === 0) return;

    setLoadingDetails(prev => new Set(prev).add(batch.id));

    const { data } = await supabase
      .from('shipments')
      .select(`
        id, status, pickup_zone, dropoff_zone,
        order_details!order_detail_id(
          order_id, qty, unit_price,
          products!product_id(title),
          shops!shop_id(name)
        )
      `)
      .in('id', allIds);

    if (data) {
      const withDirection: ShipmentDetail[] = (data as any[]).map(s => ({
        ...s,
        direction: batch.ab_shipment_ids.includes(s.id) ? 'ab' : 'bc',
      }));
      setShipmentDetails(prev => ({ ...prev, [batch.id]: withDirection }));
    }

    setLoadingDetails(prev => {
      const next = new Set(prev);
      next.delete(batch.id);
      return next;
    });
  }, []);

  const toggleShipmentSelection = (batchId: string, shipmentId: string) => {
    setSelectedShipments(prev => {
      const current = new Set(prev[batchId] ?? []);
      current.has(shipmentId) ? current.delete(shipmentId) : current.add(shipmentId);
      return { ...prev, [batchId]: current };
    });
  };

  const addShipmentsToBatch = async (batch: BatchRow) => {
    const selected = Array.from(selectedShipments[batch.id] ?? []);
    if (!selected.length || batch.route.length < 2) return;

    setAddingShipments(prev => new Set(prev).add(batch.id));
    setAddShipmentMsg(prev => ({ ...prev, [batch.id]: '' }));

    try {
      const res = await fetch('/api/logistics/add-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batch.id,
          zone_b: batch.route[1],
          new_shipment_ids: selected,
          existing_reserved_until: batch.reserved_until ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAddShipmentMsg(prev => ({ ...prev, [batch.id]: `✓ تمت إضافة ${selected.length} شحنة للتجميعة` }));
        setSelectedShipments(prev => ({ ...prev, [batch.id]: new Set() }));
        await loadBatches();
        await loadCompatibleShipments(batch);
      } else {
        setAddShipmentMsg(prev => ({ ...prev, [batch.id]: '✗ تعذّرت الإضافة — السائق وصل للمنطقة أو لا توجد سعة كافية أو وقت غير كافٍ' }));
      }
    } catch {
      setAddShipmentMsg(prev => ({ ...prev, [batch.id]: '✗ تعذّر الاتصال بالخادم' }));
    }

    setAddingShipments(prev => { const next = new Set(prev); next.delete(batch.id); return next; });
    setTimeout(() => setAddShipmentMsg(prev => { const next = { ...prev }; delete next[batch.id]; return next; }), 5000);
  };

  const manualAssign = async (batchId: string) => {
    const courierId = selectedCourier[batchId];
    if (!courierId) return;

    setAssigning(prev => new Set(prev).add(batchId));
    setAssignMsg(prev => ({ ...prev, [batchId]: '' }));

    // Atomically claim the courier first — guards against double-booking a busy/offline driver.
    const { data: courierLock } = await supabase
      .from('couriers')
      .update({ status: 'on_route' })
      .eq('id', courierId)
      .eq('status', 'available')
      .select('id');

    if (!courierLock?.length) {
      setAssignMsg(prev => ({ ...prev, [batchId]: '✗ السائق غير متاح أو لديه دفعة نشطة' }));
      setAssigning(prev => { const next = new Set(prev); next.delete(batchId); return next; });
      return;
    }

    const { data, error: updateErr } = await supabase
      .from('batches')
      .update({
        status: 'assigned',
        assigned_to: courierId,
        assigned_at: new Date().toISOString(),
        needs_dispatcher: false,
      })
      .eq('id', batchId)
      .eq('needs_dispatcher', true)
      .select('id');

    if (updateErr || !data?.length) {
      await supabase.from('couriers').update({ status: 'available' }).eq('id', courierId).eq('status', 'on_route');
      setAssignMsg(prev => ({ ...prev, [batchId]: '✗ فشل التعيين، ربما تم تعيينه مسبقاً' }));
    } else {
      await supabase.from('driver_notifications').insert({
        courier_id: courierId,
        batch_id: batchId,
        is_accepted: true,
      });
      setAssignMsg(prev => ({ ...prev, [batchId]: '✓ تم التعيين بنجاح' }));
      await loadBatches();
    }

    setAssigning(prev => { const next = new Set(prev); next.delete(batchId); return next; });
    setTimeout(() => setAssignMsg(prev => { const next = { ...prev }; delete next[batchId]; return next; }), 4000);
  };

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

  const toggle = (batch: BatchRow) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(batch.id)) {
        next.delete(batch.id);
      } else {
        next.add(batch.id);
        if (!shipmentDetails[batch.id]) loadShipmentDetails(batch);
        if (!compatibleShipments[batch.id]) loadCompatibleShipments(batch);
      }
      return next;
    });
  };

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
        <button onClick={() => setFilter('unbatched')}
          style={{
            padding: '5px 13px', borderRadius: 20, border: '1.5px solid',
            borderColor: filter === 'unbatched' ? '#FDE68A' : '#E2E8F0',
            background: filter === 'unbatched' ? '#FFFBEB' : '#fff',
            color: filter === 'unbatched' ? '#92400E' : '#64748B',
            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: filter === 'unbatched' ? 700 : 400,
          }}>
          الطرود غير المجمّعة
          <span style={{ marginRight: 5, fontFamily: 'monospace', opacity: 0.8 }}>
            {unbatchedShipments.length}
          </span>
        </button>
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {loading && <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>}

      {/* Unbatched individual shipment cards */}
      {!loading && unbatchedShipments.length > 0 && (filter === 'all' || filter === 'unbatched') && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 8, letterSpacing: '0.05em' }}>
            طرود غير مجمّعة ({unbatchedShipments.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unbatchedShipments.map(s => (
              <div key={s.id}
                style={{ background: '#fff', border: '1.5px solid #FDE68A', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>

                <span style={{
                  background: s.status === 'delayed' ? '#FEF2F2' : '#FFFBEB',
                  color: s.status === 'delayed' ? '#DC2626' : '#92400E',
                  border: `1px solid ${s.status === 'delayed' ? '#FCA5A5' : '#FDE68A'}`,
                  borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ background: '#F1F5F9', color: '#0F2B4E', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{s.pickup_zone}</span>
                    <span style={{ color: '#94A3B8', fontSize: 11 }}>←</span>
                    <span style={{ background: '#F1F5F9', color: '#0F2B4E', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{s.dropoff_zone}</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>{s.shipment_number}</span>
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                  <Chip icon="📦" label="طرد مفرد" />
                  {s.delayed_reason && <Chip icon="⚠" label={s.delayed_reason} color="red" />}
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>{new Date(s.created_at).toLocaleString('ar-EG')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && visible.length === 0 && unbatchedShipments.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا توجد تجميعات</div>
      )}

      {/* Batch cards — hidden when unbatched filter is active */}
      {filter !== 'unbatched' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(batch => {
          const col = STATUS_STYLE[batch.status];
          const isOpen = expanded.has(batch.id);
          const totalShipments = batch.ab_shipment_ids.length + batch.bc_shipment_ids.length;
          const shortId = batch.batch_number;

          return (
            <div key={batch.id}
              style={{ background: '#fff', border: `1.5px solid ${isOpen ? col.border : '#E2E8F0'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>

              {/* Card header */}
              <div onClick={() => toggle(batch)}
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
                  <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>{shortId}</span>
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
                    <Detail label="تاريخ الإنشاء" value={new Date(batch.created_at).toLocaleString('ar-EG')} />
                    <Detail label="شحنات أ→ب" value={`${batch.ab_shipment_ids.length} شحنة`} />
                    <Detail label="شحنات ب→ج" value={`${batch.bc_shipment_ids.length} شحنة`} />
                    <Detail label="الحجم الكلي" value={`${batch.total_volume} وحدة`} />
                    {batch.assigned_at && <Detail label="وقت التعيين" value={new Date(batch.assigned_at).toLocaleString('ar-EG')} />}
                    {batch.reserved_until && <Detail label="محجوز حتى" value={new Date(batch.reserved_until).toLocaleString('ar-EG')} />}
                    {batch.estimated_minutes_to_next_zone != null && (
                      <Detail label="دقائق للمنطقة التالية" value={`${batch.estimated_minutes_to_next_zone} د`} />
                    )}
                  </div>

                  <ShipmentsTable
                    shipments={shipmentDetails[batch.id] ?? []}
                    loading={loadingDetails.has(batch.id)}
                  />

                  {batch.status === 'in_transit' && batch.route.length >= 2 && (
                    <div style={{ marginTop: 16, padding: '14px 16px', background: '#F0FDF4', border: '1.5px solid #86EFAC', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#15803D' }}>
                          إضافة شحنات من {batch.route[1]} للتجميعة
                        </div>
                        {batch.estimated_minutes_to_next_zone != null && (
                          <span style={{ fontSize: 11, color: '#15803D', background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 5, padding: '2px 8px' }}>
                            ⏱ {batch.estimated_minutes_to_next_zone} د حتى الوصول
                          </span>
                        )}
                      </div>

                      {loadingCompatible.has(batch.id) && (
                        <div style={{ color: '#94A3B8', fontSize: 12 }}>جاري البحث عن شحنات متوافقة...</div>
                      )}

                      {!loadingCompatible.has(batch.id) && (compatibleShipments[batch.id]?.length ?? 0) === 0 && (
                        <div style={{ color: '#94A3B8', fontSize: 12 }}>لا توجد شحنات متاحة من {batch.route[1]}</div>
                      )}

                      {!loadingCompatible.has(batch.id) && (compatibleShipments[batch.id]?.length ?? 0) > 0 && (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto', marginBottom: 10 }}>
                            {compatibleShipments[batch.id].map(s => (
                              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#0F2B4E' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedShipments[batch.id]?.has(s.id) ?? false}
                                  onChange={() => toggleShipmentSelection(batch.id, s.id)}
                                  style={{ accentColor: '#15803D' }}
                                />
                                <span style={{ fontFamily: 'monospace', color: '#64748B' }}>{s.shipment_number}</span>
                                <span>{s.pickup_zone} ← {s.dropoff_zone}</span>
                                <span style={{ fontSize: 10, color: s.status === 'delayed' ? '#C2410C' : '#15803D' }}>
                                  {SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
                                </span>
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <button
                              disabled={!(selectedShipments[batch.id]?.size) || addingShipments.has(batch.id)}
                              onClick={() => addShipmentsToBatch(batch)}
                              style={{
                                padding: '7px 18px', borderRadius: 7, border: 'none',
                                background: (selectedShipments[batch.id]?.size) ? '#15803D' : '#CBD5E1',
                                color: '#fff',
                                cursor: (selectedShipments[batch.id]?.size) ? 'pointer' : 'not-allowed',
                                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                                opacity: addingShipments.has(batch.id) ? 0.7 : 1,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {addingShipments.has(batch.id)
                                ? '⏳ جاري...'
                                : `أضف للتجميعة${(selectedShipments[batch.id]?.size) ? ` (${selectedShipments[batch.id].size})` : ''}`}
                            </button>
                            {addShipmentMsg[batch.id] && (
                              <span style={{ fontSize: 12, color: addShipmentMsg[batch.id].startsWith('✓') ? '#15803D' : '#DC2626', fontWeight: 600 }}>
                                {addShipmentMsg[batch.id]}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {batch.needs_dispatcher && (
                    <div style={{ marginTop: 16, padding: '14px 16px', background: '#FFF7ED', border: '1.5px solid #FDBA74', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#C2410C', marginBottom: 10 }}>
                        تعيين سائق يدوياً
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={selectedCourier[batch.id] ?? ''}
                          onChange={e => setSelectedCourier(prev => ({ ...prev, [batch.id]: e.target.value }))}
                          style={{ flex: 1, minWidth: 160, padding: '7px 10px', borderRadius: 7, border: '1.5px solid #FDBA74', background: '#fff', fontSize: 13, fontFamily: 'inherit', color: '#0F2B4E', direction: 'rtl' }}
                        >
                          <option value="">اختر سائقاً...</option>
                          {couriers.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.status !== 'available' ? `(${c.status})` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={!selectedCourier[batch.id] || assigning.has(batch.id)}
                          onClick={() => manualAssign(batch.id)}
                          style={{
                            padding: '7px 18px', borderRadius: 7, border: 'none',
                            background: selectedCourier[batch.id] ? '#EA580C' : '#CBD5E1',
                            color: '#fff', cursor: selectedCourier[batch.id] ? 'pointer' : 'not-allowed',
                            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                            opacity: assigning.has(batch.id) ? 0.7 : 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {assigning.has(batch.id) ? '⏳ جاري...' : 'تعيين'}
                        </button>
                      </div>
                      {assignMsg[batch.id] && (
                        <div style={{ marginTop: 8, fontSize: 12, color: assignMsg[batch.id].startsWith('✓') ? '#15803D' : '#DC2626', fontWeight: 600 }}>
                          {assignMsg[batch.id]}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
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

const thStyle: React.CSSProperties = {
  padding: '7px 10px',
  textAlign: 'right',
  color: '#64748B',
  fontWeight: 700,
  fontSize: 11,
  borderBottom: '1.5px solid #E2E8F0',
  whiteSpace: 'nowrap',
  background: '#F8FAFC',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 10px',
  color: '#0F2B4E',
  fontSize: 12,
  verticalAlign: 'middle',
  textAlign: 'right',
  borderBottom: '1px solid #F1F5F9',
};

function ShipmentsTable({ shipments, loading }: { shipments: ShipmentDetail[]; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ color: '#94A3B8', fontSize: 12, padding: '10px 0', textAlign: 'center' }}>
        جاري تحميل تفاصيل الشحنات...
      </div>
    );
  }
  if (!shipments.length) return null;

  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, marginBottom: 8 }}>تفاصيل الشحنات</div>
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '35%' }} />
            <col style={{ width: '35%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle}>من</th>
              <th style={thStyle}>إلى</th>
              <th style={thStyle}>حالة الشحنة</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map(s => (
              <tr key={s.id} style={{ background: '#fff' }}>
                <td style={tdStyle}>{s.pickup_zone}</td>
                <td style={tdStyle}>{s.dropoff_zone}</td>
                <td style={tdStyle}>{SHIPMENT_STATUS_LABELS[s.status] ?? s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
