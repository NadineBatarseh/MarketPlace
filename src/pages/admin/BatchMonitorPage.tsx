import React, { useState, useEffect, useCallback } from 'react';
import supabase from '../../lib/supabase';
import {
  fetchAdminBatches, fetchAdminBatchDetail, fetchBreakdownCases,
  type AdminBatchListRow, type AdminBatchDetail, type AdminShipmentDetail, type AuditLogEntry,
  type AdminBatchFilters, type BreakdownCase,
} from '../../lib/adminBatches';
import {
  RemoveShipmentsModal, AddNoteModal, ResolveBreakdownModal, ChangeDriverModal, ModalShell,
  CustomerDetailsModal,
} from './batchManagement/components';
import { RedistributeShipmentsModal } from './batchManagement/redistributeModal';

type BatchStatus = 'pending_assignment' | 'assigned' | 'in_transit' | 'completed' | 'cancelled';

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
  pending: 'قيد التحضير',
  available: 'متاحة',
  delayed: 'مؤجلة للدورة القادمة',
  batched: 'مجمّعة (بانتظار الاستلام)',
  reserved: 'محجوزة (بانتظار الاستلام)',
  picked_up: 'مع السائق',
  delivered: 'تم التوصيل',
  stranded: 'تتطلب معالجة يدوية',
  claimed: 'محجوزة',
  in_transit: 'في الطريق',
  cancelled: 'ملغية',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  move_shipment: 'نقل شحنة',
  move_shipments_bulk: 'نقل عدة شحنات',
  remove_shipment: 'إزالة شحنة وإعادتها للمتاح',
  update_estimated_time: 'تحديث وقت الإنجاز المتوقع',
  add_note: 'إضافة ملاحظة',
  mark_under_monitoring: 'وضع تحت المراقبة',
  escalate_manual_intervention: 'تصعيد لمعالجة يدوية',
  resolve_breakdown: 'معالجة عطل',
  change_driver: 'تغيير السائق',
  redistribute_shipments: 'إعادة توزيع شحنات',
};

const STATUS_STYLE: Record<BatchStatus, { bg: string; text: string; border: string }> = {
  pending_assignment: { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' },
  assigned: { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' },
  in_transit: { bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
  completed: { bg: '#F8FAFC', text: '#475569', border: '#CBD5E1' },
  cancelled: { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
};

const ALL_STATUSES: BatchStatus[] = ['pending_assignment', 'assigned', 'in_transit', 'completed', 'cancelled'];
const ACTIVE_STATUSES: BatchStatus[] = ['pending_assignment', 'assigned', 'in_transit'];
const ARCHIVE_STATUSES: BatchStatus[] = ['completed', 'cancelled'];

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-EG-u-nu-latn');
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#0F2B4E', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

interface CourierOption { id: string; name: string; status: string; }

function Chip({ icon, label, color }: { icon: string; label: string; color?: 'blue' | 'red' | 'green' | 'orange' | 'gray' }) {
  const styles = {
    blue: { bg: '#EFF6FF', border: '#93C5FD', text: '#1D4ED8' },
    red: { bg: '#FEF2F2', border: '#FCA5A5', text: '#DC2626' },
    green: { bg: '#F0FDF4', border: '#86EFAC', text: '#15803D' },
    orange: { bg: '#FFF7ED', border: '#FDBA74', text: '#C2410C' },
    gray: { bg: '#F8FAFC', border: '#E2E8F0', text: '#475569' },
  };
  const s = color ? styles[color] : styles.gray;
  return (
    <span style={{ fontSize: 11, color: s.text, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {icon} {label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: '7px 10px', textAlign: 'right', color: '#64748B', fontWeight: 700, fontSize: 11,
  borderBottom: '1.5px solid #E2E8F0', whiteSpace: 'nowrap', background: '#F8FAFC',
};
const tdStyle: React.CSSProperties = {
  padding: '7px 10px', color: '#0F2B4E', fontSize: 12, verticalAlign: 'middle', textAlign: 'right', borderBottom: '1px solid #F1F5F9',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 9px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff',
  fontSize: 12, fontFamily: 'inherit', color: '#0F2B4E', direction: 'rtl',
};
const actionBtnStyle = (color: string): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${color}55`, background: `${color}14`,
  color, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
});

export default function BatchMonitorPage() {
  const [tab, setTab] = useState<'batches' | 'archive' | 'breakdowns'>('batches');

  // ── Filters ──
  const [filters, setFilters] = useState<AdminBatchFilters>({});
  const [searchInput, setSearchInput] = useState('');

  const [batches, setBatches] = useState<AdminBatchListRow[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cycling, setCycling] = useState(false);
  const [cycleMsg, setCycleMsg] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [detailCache, setDetailCache] = useState<Record<string, { batch: AdminBatchDetail; shipments: AdminShipmentDetail[]; audit_log: AuditLogEntry[] }>>({});
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());

  const [couriers, setCouriers] = useState<CourierOption[]>([]);

  // Manual dispatcher assignment
  const [selectedCourier, setSelectedCourier] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<Set<string>>(new Set());
  const [assignMsg, setAssignMsg] = useState<Record<string, string>>({});

  // Unbatched individual shipments (existing feature, unchanged)
  const [unbatchedShipments, setUnbatchedShipments] = useState<UnbatchedShipment[]>([]);

  // In-transit shipment additions (Phase 8, existing feature, unchanged)
  interface CompatibleShipment { id: string; shipment_number: string; pickup_zone: string; dropoff_zone: string; status: string; }
  const [compatibleShipments, setCompatibleShipments] = useState<Record<string, CompatibleShipment[]>>({});
  const [loadingCompatible, setLoadingCompatible] = useState<Set<string>>(new Set());
  const [phase8Selected, setPhase8Selected] = useState<Record<string, Set<string>>>({});
  const [addingShipments, setAddingShipments] = useState<Set<string>>(new Set());
  const [addShipmentMsg, setAddShipmentMsg] = useState<Record<string, string>>({});

  // Shipment selection for remove action
  const [moveSelection, setMoveSelection] = useState<Record<string, Set<string>>>({});

  // Modals
  const [removeModal, setRemoveModal] = useState<{ batchId: string; shipmentIds: string[] } | null>(null);
  const [noteModal, setNoteModal] = useState<{ batchId: string } | null>(null);
  const [resolveModal, setResolveModal] = useState<BreakdownCase | null>(null);
  const [driverModal, setDriverModal] = useState<{ batchId: string } | null>(null);
  const [redistributeModal, setRedistributeModal] = useState<{ batchId: string } | null>(null);
  const [auditLogModal, setAuditLogModal] = useState<{ batchId: string } | null>(null);
  const [customerModal, setCustomerModal] = useState<AdminShipmentDetail | null>(null);
  const [addShipmentsModal, setAddShipmentsModal] = useState<{ batchId: string } | null>(null);

  // Breakdowns tab
  const [breakdownCases, setBreakdownCases] = useState<BreakdownCase[]>([]);
  const [loadingBreakdowns, setLoadingBreakdowns] = useState(false);

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

  const loadArchivedCount = useCallback(async () => {
    const { count } = await supabase.from('batches').select('id', { count: 'exact', head: true }).in('status', ['completed', 'cancelled']);
    setArchivedCount(count ?? 0);
  }, []);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    const scopedFilters = tab === 'archive' ? { ...filters, archived: 'true' as const } : filters;
    const [res] = await Promise.all([fetchAdminBatches(scopedFilters), loadUnbatched(), loadArchivedCount()]);
    if (!res.ok) setError('تعذّر تحميل البيانات: ' + (res.error ?? ''));
    else setBatches(res.batches ?? []);
    setLoading(false);
  }, [filters, tab, loadUnbatched, loadArchivedCount]);

  const loadBreakdowns = useCallback(async () => {
    setLoadingBreakdowns(true);
    const res = await fetchBreakdownCases();
    if (res.ok) setBreakdownCases(res.cases ?? []);
    setLoadingBreakdowns(false);
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { if (tab === 'breakdowns') loadBreakdowns(); }, [tab, loadBreakdowns]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { loadBatches(); if (tab === 'breakdowns') loadBreakdowns(); }, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, loadBatches, loadBreakdowns, tab]);

  useEffect(() => {
    supabase.from('couriers').select('id, name, status').then(({ data }) => {
      if (data) setCouriers(data as CourierOption[]);
    });
  }, []);

  const loadDetail = useCallback(async (batchId: string) => {
    setLoadingDetails(prev => new Set(prev).add(batchId));
    const res = await fetchAdminBatchDetail(batchId);
    if (res.ok) setDetailCache(prev => ({ ...prev, [batchId]: { batch: res.batch, shipments: res.shipments, audit_log: res.audit_log } }));
    setLoadingDetails(prev => { const next = new Set(prev); next.delete(batchId); return next; });
  }, []);

  const refreshDetail = useCallback((batchId: string) => { loadDetail(batchId); loadBatches(); }, [loadDetail, loadBatches]);

  const loadCompatibleShipments = useCallback(async (batch: AdminBatchListRow) => {
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

  const toggle = (batch: AdminBatchListRow) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(batch.id)) {
        next.delete(batch.id);
      } else {
        next.add(batch.id);
        if (!detailCache[batch.id]) loadDetail(batch.id);
        if (!compatibleShipments[batch.id]) loadCompatibleShipments(batch);
      }
      return next;
    });
  };

  const togglePhase8Selection = (batchId: string, shipmentId: string) => {
    setPhase8Selected(prev => {
      const current = new Set(prev[batchId] ?? []);
      current.has(shipmentId) ? current.delete(shipmentId) : current.add(shipmentId);
      return { ...prev, [batchId]: current };
    });
  };

  const toggleMoveSelection = (batchId: string, shipmentId: string) => {
    setMoveSelection(prev => {
      const current = new Set(prev[batchId] ?? []);
      current.has(shipmentId) ? current.delete(shipmentId) : current.add(shipmentId);
      return { ...prev, [batchId]: current };
    });
  };

  const toggleAllMoveSelection = (batchId: string, eligibleIds: string[]) => {
    setMoveSelection(prev => {
      const current = prev[batchId] ?? new Set<string>();
      const allSelected = eligibleIds.length > 0 && eligibleIds.every(id => current.has(id));
      return { ...prev, [batchId]: allSelected ? new Set<string>() : new Set(eligibleIds) };
    });
  };

  const addShipmentsToBatch = async (batch: AdminBatchListRow) => {
    const selected = Array.from(phase8Selected[batch.id] ?? []);
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
        setPhase8Selected(prev => ({ ...prev, [batch.id]: new Set() }));
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
      const res = await fetch('/api/logistics/cycle', { method: 'POST' });
      const json = await res.json();
      setCycleMsg(json.success ? '✓ اكتملت الدورة بنجاح' : '✗ ' + (json.error ?? 'فشلت الدورة'));
      await loadBatches();
    } catch {
      setCycleMsg('✗ تعذّر الاتصال بالخادم');
    }
    setCycling(false);
    setTimeout(() => setCycleMsg(''), 5000);
  };

  const zones = [...new Set(batches.map(b => b.zone).filter(Boolean))] as string[];
  const counts = Object.fromEntries(ALL_STATUSES.map(s => [s, batches.filter(b => b.status === s).length])) as Record<BatchStatus, number>;
  const delayedCount = batches.filter(b => b.is_delayed).length;
  const breakdownCount = batches.filter(b => b.has_active_breakdown).length;
  const manualCount = batches.filter(b => b.creation_source === 'admin').length;

  const statTiles = tab === 'archive'
    ? [
        { label: 'الإجمالي', value: batches.length, color: '#0F2B4E', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'مكتملة', value: counts.completed, color: '#475569', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'ملغاة', value: counts.cancelled, color: '#DC2626', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'بها عطل', value: breakdownCount, color: '#DC2626', bg: '#FFFFFF', border: '#E2E8F0' },
      ]
    : [
        { label: 'الإجمالي', value: batches.length, color: '#0F2B4E', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'بانتظار السائق', value: counts.pending_assignment, color: '#334155', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'تم التعيين', value: counts.assigned, color: '#1D4ED8', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'في الطريق', value: counts.in_transit, color: '#15803D', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'متأخرة', value: delayedCount, color: '#B45309', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'بها عطل', value: breakdownCount, color: '#DC2626', bg: '#FFFFFF', border: '#E2E8F0' },
        { label: 'أُنشئت يدوياً', value: manualCount, color: '#7C3AED', bg: '#FFFFFF', border: '#E2E8F0' },
      ];

  function applySearch() {
    setFilters(prev => ({ ...prev, q: searchInput.trim() || undefined }));
  }

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction: 'rtl', color: '#0F2B4E' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');`}</style>

      {/* Modals */}
      {removeModal && (
        <RemoveShipmentsModal batchId={removeModal.batchId} shipmentIds={removeModal.shipmentIds}
          onClose={() => setRemoveModal(null)}
          onSuccess={() => { setRemoveModal(null); setMoveSelection(prev => ({ ...prev, [removeModal.batchId]: new Set() })); refreshDetail(removeModal.batchId); }} />
      )}
      {noteModal && (
        <AddNoteModal batchId={noteModal.batchId} onClose={() => setNoteModal(null)} onSuccess={() => { setNoteModal(null); refreshDetail(noteModal.batchId); }} />
      )}
      {resolveModal && (
        <ResolveBreakdownModal caseRow={resolveModal} onClose={() => setResolveModal(null)}
          onSuccess={() => { setResolveModal(null); loadBreakdowns(); loadBatches(); }} />
      )}
      {driverModal && (() => {
        const target = batches.find(b => b.id === driverModal.batchId);
        return (
          <ChangeDriverModal
            batchId={driverModal.batchId}
            batchStatus={target?.status ?? ''}
            currentCourier={target?.courier ? { id: target.courier.id, name: target.courier.name } : null}
            couriers={couriers}
            onClose={() => setDriverModal(null)}
            onSuccess={() => { setDriverModal(null); refreshDetail(driverModal.batchId); }}
          />
        );
      })()}
      {redistributeModal && (
        <RedistributeShipmentsModal batchId={redistributeModal.batchId}
          onClose={() => setRedistributeModal(null)}
          onSuccess={() => { setRedistributeModal(null); refreshDetail(redistributeModal.batchId); loadBatches(); }} />
      )}
      {auditLogModal && (
        <ModalShell title="السجلات الإدارية" icon="📋" onClose={() => setAuditLogModal(null)} width={520}>
          <AuditLogPanel entries={detailCache[auditLogModal.batchId]?.audit_log ?? []} />
        </ModalShell>
      )}
      {customerModal && (
        <CustomerDetailsModal shipment={customerModal} onClose={() => setCustomerModal(null)} />
      )}
      {addShipmentsModal && (() => {
        const target = batches.find(b => b.id === addShipmentsModal.batchId);
        if (!target) return null;
        return (
          <ModalShell title={`إضافة شحنات من ${target.route[1] ?? ''} للتجميعة`} icon="➕" onClose={() => setAddShipmentsModal(null)} width={480}>
            {target.estimated_minutes_to_next_zone != null && (
              <div style={{ marginBottom: 10, fontSize: 11, color: '#15803D', background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 5, padding: '2px 8px', display: 'inline-block' }}>
                ⏱ {target.estimated_minutes_to_next_zone} د حتى الوصول
              </div>
            )}
            {loadingCompatible.has(target.id) && <div style={{ color: '#94A3B8', fontSize: 12 }}>جاري البحث عن شحنات متوافقة...</div>}
            {!loadingCompatible.has(target.id) && (compatibleShipments[target.id]?.length ?? 0) === 0 && (
              <div style={{ color: '#94A3B8', fontSize: 12 }}>لا توجد شحنات متاحة من {target.route[1]}</div>
            )}
            {!loadingCompatible.has(target.id) && (compatibleShipments[target.id]?.length ?? 0) > 0 && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', marginBottom: 10 }}>
                  {compatibleShipments[target.id].map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#0F2B4E' }}>
                      <input type="checkbox" checked={phase8Selected[target.id]?.has(s.id) ?? false} onChange={() => togglePhase8Selection(target.id, s.id)} style={{ accentColor: '#15803D' }} />
                      <span style={{ fontFamily: 'monospace', color: '#64748B' }}>{s.shipment_number}</span>
                      <span>{s.pickup_zone} ← {s.dropoff_zone}</span>
                      <span style={{ fontSize: 10, color: s.status === 'delayed' ? '#1D4ED8' : '#15803D' }}>{SHIPMENT_STATUS_LABELS[s.status] ?? s.status}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button disabled={!(phase8Selected[target.id]?.size) || addingShipments.has(target.id)} onClick={() => addShipmentsToBatch(target)}
                    style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: (phase8Selected[target.id]?.size) ? '#15803D' : '#CBD5E1', color: '#fff', cursor: (phase8Selected[target.id]?.size) ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', opacity: addingShipments.has(target.id) ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                    {addingShipments.has(target.id) ? '⏳ جاري...' : `أضف للتجميعة${(phase8Selected[target.id]?.size) ? ` (${phase8Selected[target.id].size})` : ''}`}
                  </button>
                  {addShipmentMsg[target.id] && (
                    <span style={{ fontSize: 12, color: addShipmentMsg[target.id].startsWith('✓') ? '#15803D' : '#DC2626', fontWeight: 600 }}>{addShipmentMsg[target.id]}</span>
                  )}
                </div>
              </>
            )}
          </ModalShell>
        );
      })()}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>إدارة التجميعات</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#64748B' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            تحديث كل 15 ث
          </label>
          <button onClick={() => { loadBatches(); if (tab === 'breakdowns') loadBreakdowns(); }} disabled={loading}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ↻ تحديث
          </button>
          <button onClick={triggerCycle} disabled={cycling}
            style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#F97316,#EA580C)', color: '#fff', cursor: cycling ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', opacity: cycling ? 0.7 : 1 }}>
            {cycling ? '⏳ جاري التشغيل...' : '▶ تشغيل دورة التجميع'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button onClick={() => { setTab('batches'); setFilters(prev => ({ ...prev, status: undefined })); }} style={{
          padding: '6px 16px', borderRadius: 20, border: '1.5px solid', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          borderColor: tab === 'batches' ? '#0F2B4E' : '#E2E8F0', background: tab === 'batches' ? '#0F2B4E' : '#fff',
          color: tab === 'batches' ? '#fff' : '#64748B', fontWeight: tab === 'batches' ? 700 : 400,
        }}>التجميعات</button>
        <button onClick={() => { setTab('archive'); setFilters(prev => ({ ...prev, status: undefined })); }} style={{
          padding: '6px 16px', borderRadius: 20, border: '1.5px solid', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          borderColor: tab === 'archive' ? '#0F2B4E' : '#E2E8F0', background: tab === 'archive' ? '#0F2B4E' : '#fff',
          color: tab === 'archive' ? '#fff' : '#64748B', fontWeight: tab === 'archive' ? 700 : 400,
        }}>
          الأرشيف {archivedCount > 0 && <span style={{ fontFamily: 'monospace' }}>({archivedCount})</span>}
        </button>
        <button onClick={() => setTab('breakdowns')} style={{
          padding: '6px 16px', borderRadius: 20, border: '1.5px solid', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          borderColor: tab === 'breakdowns' ? '#DC2626' : '#E2E8F0', background: tab === 'breakdowns' ? '#FEF2F2' : '#fff',
          color: tab === 'breakdowns' ? '#DC2626' : '#64748B', fontWeight: tab === 'breakdowns' ? 700 : 400,
        }}>
          الأعطال والتدخلات المطلوبة {breakdownCount > 0 && <span style={{ fontFamily: 'monospace' }}>({breakdownCount})</span>}
        </button>
      </div>

      {tab === 'breakdowns' ? (
        <BreakdownsPanel cases={breakdownCases} loading={loadingBreakdowns} onResolve={setResolveModal} />
      ) : (
        <>
          {cycleMsg && (
            <div style={{ padding: '10px 16px', borderRadius: 8, background: cycleMsg.startsWith('✓') ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${cycleMsg.startsWith('✓') ? '#86EFAC' : '#FCA5A5'}`, color: cycleMsg.startsWith('✓') ? '#15803D' : '#DC2626', fontSize: 13, marginBottom: 16 }}>
              {cycleMsg}
            </div>
          )}

          {/* Stats strip */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statTiles.length}, 1fr)`, gap: 8, marginBottom: 18 }}>
            {statTiles.map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 10, padding: '10px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: '12px 14px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 10 }}>
            <select style={inputStyle} value={filters.breakdown === 'true' ? 'breakdown' : (filters.created_manually === 'true' ? 'created_manually' : (filters.status ?? ''))} onChange={e => {
              const v = e.target.value;
              setFilters(prev => ({
                ...prev,
                status: (v !== 'breakdown' && v !== 'created_manually' && v) ? v : undefined,
                breakdown: v === 'breakdown' ? 'true' : undefined,
                created_manually: v === 'created_manually' ? 'true' : undefined,
              }));
            }}>
              <option value="">كل الحالات</option>
              {(tab === 'archive' ? ARCHIVE_STATUSES : ACTIVE_STATUSES).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              <option value="breakdown">بها عطل</option>
              <option value="created_manually">أُنشئت يدوياً</option>
            </select>
            <select style={inputStyle} value={filters.driver_id ?? ''} onChange={e => setFilters(prev => ({ ...prev, driver_id: e.target.value || undefined }))}>
              <option value="">كل السائقين</option>
              {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select style={inputStyle} value={filters.zone ?? ''} onChange={e => setFilters(prev => ({ ...prev, zone: e.target.value || undefined }))}>
              <option value="">كل المناطق</option>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
            <select style={inputStyle} value={filters.delayed ?? ''} onChange={e => setFilters(prev => ({ ...prev, delayed: (e.target.value || undefined) as any }))}>
              <option value="">كل حالات التأخير</option>
              <option value="true">متأخرة فقط</option>
              <option value="lt1h">متأخرة أقل من ساعة</option>
              <option value="gt1h">متأخرة أكثر من ساعة</option>
              <option value="severe">تأخير شديد (+4 ساعات)</option>
              <option value="with_reason">تأخير بسبب مذكور</option>
              <option value="without_reason">تأخير بدون سبب</option>
            </select>
            <input type="date" style={inputStyle} value={filters.date_from ?? ''} onChange={e => setFilters(prev => ({ ...prev, date_from: e.target.value || undefined }))} title="من تاريخ" />
            <input type="date" style={inputStyle} value={filters.date_to ?? ''} onChange={e => setFilters(prev => ({ ...prev, date_to: e.target.value || undefined }))} title="إلى تاريخ" />
            <input type="text" style={{ ...inputStyle, minWidth: 180 }} placeholder="رقم التجميعة أو الشحنة..." value={searchInput}
              onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && applySearch()} />
            <button onClick={applySearch} style={{ ...inputStyle, cursor: 'pointer', background: '#0F2B4E', color: '#fff', border: 'none' }}>بحث</button>
            {(filters.status || filters.driver_id || filters.zone || filters.delayed || filters.breakdown || filters.created_manually || filters.date_from || filters.date_to || filters.q) && (
              <button onClick={() => { setFilters({}); setSearchInput(''); }} style={{ ...inputStyle, cursor: 'pointer', color: '#DC2626' }}>إعادة ضبط</button>
            )}
          </div>

          {error && (
            <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>{error}</div>
          )}
          {loading && <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>}

          {/* Unbatched individual shipment cards — not relevant in the archive view */}
          {!loading && tab !== 'archive' && unbatchedShipments.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 8, letterSpacing: '0.05em' }}>
                طرود غير مجمّعة ({unbatchedShipments.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {unbatchedShipments.map(s => (
                  <div key={s.id} style={{ background: '#fff', border: '1.5px solid #FDE68A', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, padding: '20px 230px 20px 20px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginRight: 'auto' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                          <span style={{
                            background: s.status === 'delayed' ? '#EFF6FF' : '#FFFBEB', color: s.status === 'delayed' ? '#1D4ED8' : '#92400E',
                            border: `1px solid ${s.status === 'delayed' ? '#BFDBFE' : '#FDE68A'}`, borderRadius: 6, padding: '3px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                          }}>
                            {SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
                          </span>
                          <Chip icon="📦" label="طرد مفرد" />
                          {s.delayed_reason && <Chip icon="⚠" label={s.delayed_reason} color="red" />}
                        </div>
                      </div>

                      <div style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', textAlign: 'right', maxWidth: 210 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F2B4E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.pickup_zone}  ←  {s.dropoff_zone}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>{s.shipment_number}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8' }}>{formatDate(s.created_at)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && batches.length === 0 && (tab === 'archive' || unbatchedShipments.length === 0) && (
            <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا توجد تجميعات مطابقة للفلاتر الحالية</div>
          )}

          {/* Batch cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {batches.map(batch => {
              const col = STATUS_STYLE[batch.status as BatchStatus] ?? STATUS_STYLE.pending_assignment;
              const isOpen = expanded.has(batch.id);
              const detail = detailCache[batch.id];
              const isDetailLoading = loadingDetails.has(batch.id);
              const selectedForMove = moveSelection[batch.id] ?? new Set<string>();
              const eligibleSelected = (detail?.shipments ?? []).filter(s => selectedForMove.has(s.id) && s.not_picked_up);

              return (
                <div key={batch.id} style={{ background: '#fff', border: `1.5px solid ${isOpen ? col.border : '#E2E8F0'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                  {/* Card header — route+batch number pinned to the physical right edge via
                      position:absolute + right:16px (a physical offset, immune to any
                      direction:rtl flex-ordering quirks); everything else flows normally
                      on the left, with paddingRight reserving room so it never overlaps. */}
                  <div onClick={() => toggle(batch)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, padding: '20px 230px 20px 20px', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginRight: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                        <span style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}`, borderRadius: 6, padding: '3px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {STATUS_LABELS[batch.status as BatchStatus] ?? batch.status}
                        </span>
                        {batch.courier?.name && <Chip icon="🚗" label={batch.courier.name} color="blue" />}
                        {batch.is_delayed && <Chip icon="⏰" label={`متأخرة ${batch.delay_minutes} د`} color="orange" />}
                        {batch.has_active_breakdown && <Chip icon="🛑" label="عطل نشط" color="red" />}
                        {batch.requires_manual_intervention && <Chip icon="⚠" label="تتطلب تدخل يدوي" color="red" />}
                        {batch.needs_dispatcher && <Chip icon="⚠" label="يحتاج مشرف" color="red" />}
                      </div>

                      <span style={{ color: '#94A3B8', fontSize: 13, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                    </div>

                    <div style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', textAlign: 'right', maxWidth: 210 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F2B4E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {batch.route.length > 0 ? batch.route.join('  ←  ') : 'لا يوجد مسار'}
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>{batch.batch_number}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>{formatDate(batch.created_at)}</div>
                    </div>
                  </div>

                  {/* Expanded details — everything shown at once */}
                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${col.border}`, padding: '14px 16px', background: col.bg }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                        <Chip icon="📦" label={`${batch.shipment_count} شحنة`} />
                        <Chip icon="⚖" label={`${batch.total_volume}/${batch.max_volume}`} />
                        <Chip icon="✅" label={`${batch.delivered_count} تم التوصيل`} color="green" />
                        <Chip icon="🚚" label={`${batch.picked_up_count} مع السائق`} color="blue" />
                        <Chip icon="🏬" label={`${batch.not_picked_up_count} لم يُستلم`} color="gray" />
                        {batch.creation_source === 'admin' && <Chip icon="🖐" label="أُنشئت يدوياً" color="gray" />}
                        {batch.under_monitoring && <Chip icon="👁" label="تحت المراقبة" color="orange" />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                        {tab !== 'archive' && (
                          <>
                            <button onClick={() => setNoteModal({ batchId: batch.id })} style={actionBtnStyle('#1D4ED8')}>📝 إضافة ملاحظة</button>
                            <button onClick={() => setRedistributeModal({ batchId: batch.id })} style={actionBtnStyle('#7C3AED')}>🔀 إعادة توزيع الشحنات</button>
                          </>
                        )}
                        <button onClick={() => setAuditLogModal({ batchId: batch.id })} style={actionBtnStyle('#64748B')}>📋 السجلات الإدارية</button>
                        {tab !== 'archive' && !['completed', 'cancelled'].includes(batch.status) && (
                          <button onClick={() => setDriverModal({ batchId: batch.id })} style={actionBtnStyle('#EA580C')}>
                            🚗 {batch.courier ? 'تغيير السائق' : 'تعيين سائق'}
                          </button>
                        )}
                        {tab !== 'archive' && batch.status === 'in_transit' && batch.route.length >= 2 && (
                          <button onClick={() => setAddShipmentsModal({ batchId: batch.id })} style={actionBtnStyle('#15803D')}>
                            ➕ إضافة شحنات من {batch.route[1]}
                          </button>
                        )}
                      </div>

                      {isDetailLoading && <div style={{ color: '#94A3B8', fontSize: 12, padding: '10px 0', textAlign: 'center' }}>جاري تحميل تفاصيل الشحنات...</div>}

                      {detail && (
                        <ShipmentsTable
                          shipments={detail.shipments}
                          selected={selectedForMove}
                          onToggle={id => toggleMoveSelection(batch.id, id)}
                          onToggleAll={() => toggleAllMoveSelection(batch.id, detail.shipments.filter(s => s.not_picked_up).map(s => s.id))}
                          readOnly={tab === 'archive'}
                          onShowCustomer={setCustomerModal}
                        />
                      )}

                      {tab !== 'archive' && eligibleSelected.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
                          <button onClick={() => setRemoveModal({ batchId: batch.id, shipmentIds: eligibleSelected.map(s => s.id) })} style={actionBtnStyle('#DC2626')}>
                            ↩️ إزالة {eligibleSelected.length} شحنة وإعادتها للمتاح
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ShipmentsTable({ shipments, selected, onToggle, onToggleAll, readOnly, onShowCustomer }: {
  shipments: AdminShipmentDetail[]; selected: Set<string>; onToggle: (id: string) => void; onToggleAll: () => void; readOnly?: boolean;
  onShowCustomer: (s: AdminShipmentDetail) => void;
}) {
  if (!shipments.length) return null;

  const eligible = shipments.filter(s => s.not_picked_up);
  const allSelected = eligible.length > 0 && eligible.every(s => selected.has(s.id));

  function custodyChip(s: AdminShipmentDetail) {
    if (s.delivered) return <Chip icon="✅" label="تم التوصيل" color="green" />;
    if (s.requires_manual_handling) return <Chip icon="⚠" label="تتطلب معالجة يدوية" color="red" />;
    if (s.in_driver_custody) return <Chip icon="🚚" label="مع السائق" color="blue" />;
    return <Chip icon="🏬" label="لم يُستلم من المتجر" color="gray" />;
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, marginBottom: 8 }}>تفاصيل الشحنات ({shipments.length})</div>
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {!readOnly && (
                <th style={{ ...thStyle, width: 30 }}>
                  <input type="checkbox" disabled={eligible.length === 0} checked={allSelected} onChange={onToggleAll}
                    title={allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'} />
                </th>
              )}
              <th style={thStyle}>الشحنة</th>
              <th style={thStyle}>الطلب</th>
              <th style={thStyle}>التاجر</th>
              <th style={thStyle}>العميل</th>
              <th style={thStyle}>من ← إلى</th>
              <th style={thStyle}>رحلة</th>
              <th style={thStyle}>الحجم</th>
              <th style={thStyle}>الحالة الفعلية (الحيازة)</th>
              <th style={thStyle}>الدفعة السابقة</th>
              <th style={thStyle}>الترتيب</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s, idx) => (
              <tr key={s.id} style={{ background: '#fff' }}>
                {!readOnly && (
                  <td style={tdStyle}>
                    <input type="checkbox" disabled={!s.not_picked_up} checked={selected.has(s.id)} onChange={() => onToggle(s.id)}
                      title={s.not_picked_up ? 'تحديد للنقل/الإزالة' : 'لا يمكن تحديدها — تم استلامها أو تسليمها أو تتطلب معالجة يدوية'} />
                  </td>
                )}
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{s.shipment_number}</td>
                <td style={tdStyle}>{s.order_id ? `#${s.order_id}` : '—'}</td>
                <td style={tdStyle}>{s.merchant_name ?? '—'}</td>
                <td style={tdStyle}>
                  {s.customer_name ? (
                    <button onClick={() => onShowCustomer(s)} title="عرض تفاصيل العميل"
                      style={{ background: 'none', border: 'none', padding: 0, color: '#2563EB', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit' }}>
                      {s.customer_name}
                    </button>
                  ) : '—'}
                </td>
                <td style={tdStyle}>{s.pickup_zone} ← {s.dropoff_zone}</td>
                <td style={tdStyle}>{s.leg === 'ab' ? <Chip icon="①" label="أ←ب" color="blue" /> : <Chip icon="②" label="ب←ج" color="orange" />}</td>
                <td style={tdStyle}>{s.volume}</td>
                <td style={tdStyle}>{custodyChip(s)}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>
                  {s.previous_batch ? (s.previous_batch.batch_number ?? s.previous_batch.id) : '—'}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{idx + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLogPanel({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, marginBottom: 8 }}>سجل الإجراءات الإدارية ({entries.length})</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94A3B8' }}>لا توجد إجراءات إدارية مسجّلة على هذه التجميعة</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {entries.map(e => (
            <div key={e.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <strong style={{ color: '#0F2B4E' }}>{ACTION_TYPE_LABELS[e.action_type] ?? e.action_type}</strong>
                <span style={{ color: '#94A3B8', fontSize: 11 }}>{formatDate(e.created_at)}</span>
              </div>
              <div style={{ color: '#64748B', marginTop: 3 }}>
                بواسطة: {e.performed_by_name ?? e.performed_by}
                {e.reason && <> · السبب: {e.reason}</>}
              </div>
              {e.action_type === 'change_driver' && e.metadata && (
                <div style={{ color: '#64748B', marginTop: 3 }}>
                  {String((e.metadata as any).previous_courier_name ?? '—')} ← {String((e.metadata as any).new_courier_name ?? '—')}
                  {(e.metadata as any).driver_already_departed && <span style={{ color: '#DC2626', fontWeight: 700 }}> (تم التغيير بعد خروج السائق للمهمة)</span>}
                </div>
              )}
              {e.notes && <div style={{ color: '#94A3B8', marginTop: 3 }}>ملاحظات: {e.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BreakdownsPanel({ cases, loading, onResolve }: { cases: BreakdownCase[]; loading: boolean; onResolve: (c: BreakdownCase) => void }) {
  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>;
  if (cases.length === 0) return <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا توجد أعطال مسجّلة 🎉</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {cases.map(c => (
        <div key={c.id} style={{ background: '#fff', border: `1.5px solid ${c.is_active ? '#FCA5A5' : '#E2E8F0'}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Chip icon={c.is_active ? '🛑' : '✅'} label={c.is_active ? 'عطل نشط' : 'تمت المعالجة'} color={c.is_active ? 'red' : 'green'} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8' }}>{c.batch_number}</span>
              <span style={{ fontSize: 12 }}>{c.route.join(' ← ')}</span>
              {c.courier?.name && <Chip icon="🚗" label={c.courier.name} color="blue" />}
            </div>
            {c.is_active && <button onClick={() => onResolve(c)} style={actionBtnStyle('#15803D')}>🛠 معالجة العطل</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, fontSize: 12, color: '#475569' }}>
            <Detail label="وقت الإبلاغ" value={formatDate(c.breakdown_reported_at)} />
            <Detail label="سبب العطل" value={c.breakdown_reason ?? 'لم يُذكر سبب'} />
            <Detail label="موقع السائق وقت الإبلاغ" value={c.breakdown_location ? `${c.breakdown_location.lat.toFixed(4)}, ${c.breakdown_location.lng.toFixed(4)}` : '—'} />
            <Detail label="شحنات لم تُستلم (أُعيدت للمتاح)" value={String(c.not_picked_up)} />
            <Detail label="شحنات تتطلب معالجة يدوية" value={c.stranded.length ? c.stranded.map(s => s.shipment_number).join('، ') : 'لا توجد'} />
            {!c.is_active && <Detail label="نتيجة المعالجة" value={c.breakdown_resolution ?? '—'} />}
          </div>
        </div>
      ))}
    </div>
  );
}
