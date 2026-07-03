import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import supabase from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';
import {
  fetchAdminBatches, fetchAdminBatchDetail, fetchBreakdownCases,
  type AdminBatchListRow, type AdminBatchDetail, type AdminShipmentDetail, type AuditLogEntry,
  type AdminBatchFilters, type BreakdownCase,
} from '../../lib/adminBatches';
import {
  MoveShipmentsModal, RemoveShipmentsModal, AddNoteModal, UpdateEstimatedTimeModal, ResolveBreakdownModal, ChangeDriverModal,
} from './batchManagement/components';

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

function getStatusLabels(t: TFunction): Record<BatchStatus, string> {
  return {
    pending_assignment: t('batchMonitor.status.pending_assignment'),
    assigned: t('batchMonitor.status.assigned'),
    in_transit: t('batchMonitor.status.in_transit'),
    completed: t('batchMonitor.status.completed'),
    cancelled: t('batchMonitor.status.cancelled'),
  };
}

function getShipmentStatusLabels(t: TFunction): Record<string, string> {
  return {
    pending: t('batchMonitor.shipmentStatus.pending'),
    available: t('batchMonitor.shipmentStatus.available'),
    delayed: t('batchMonitor.shipmentStatus.delayed'),
    batched: t('batchMonitor.shipmentStatus.batched'),
    reserved: t('batchMonitor.shipmentStatus.reserved'),
    picked_up: t('batchMonitor.shipmentStatus.picked_up'),
    delivered: t('batchMonitor.shipmentStatus.delivered'),
    stranded: t('batchMonitor.shipmentStatus.stranded'),
    claimed: t('batchMonitor.shipmentStatus.claimed'),
    in_transit: t('batchMonitor.shipmentStatus.in_transit'),
    cancelled: t('batchMonitor.shipmentStatus.cancelled'),
  };
}

function getActionTypeLabels(t: TFunction): Record<string, string> {
  return {
    move_shipment: t('batchMonitor.actionType.move_shipment'),
    move_shipments_bulk: t('batchMonitor.actionType.move_shipments_bulk'),
    remove_shipment: t('batchMonitor.actionType.remove_shipment'),
    update_estimated_time: t('batchMonitor.actionType.update_estimated_time'),
    add_note: t('batchMonitor.actionType.add_note'),
    mark_under_monitoring: t('batchMonitor.actionType.mark_under_monitoring'),
    escalate_manual_intervention: t('batchMonitor.actionType.escalate_manual_intervention'),
    resolve_breakdown: t('batchMonitor.actionType.resolve_breakdown'),
    change_driver: t('batchMonitor.actionType.change_driver'),
  };
}

const STATUS_STYLE: Record<BatchStatus, { bg: string; text: string; border: string }> = {
  pending_assignment: { bg: '#FFF7ED', text: '#C2410C', border: '#FDBA74' },
  assigned: { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' },
  in_transit: { bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
  completed: { bg: '#F8FAFC', text: '#475569', border: '#CBD5E1' },
  cancelled: { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
};

const ALL_STATUSES: BatchStatus[] = ['pending_assignment', 'assigned', 'in_transit', 'completed', 'cancelled'];

function formatDate(iso: string | null, numLocale: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(numLocale);
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
// direction is inherited from the page root, which sets it dynamically per language.
const inputStyle: React.CSSProperties = {
  padding: '6px 9px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff',
  fontSize: 12, fontFamily: 'inherit', color: '#0F2B4E',
};
const actionBtnStyle = (color: string): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${color}55`, background: `${color}14`,
  color, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
});

export default function BatchMonitorPage() {
  const { t } = useTranslation('admin');
  const { direction, lang } = useLanguage();
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const STATUS_LABELS = getStatusLabels(t);
  const SHIPMENT_STATUS_LABELS = getShipmentStatusLabels(t);
  const [tab, setTab] = useState<'batches' | 'breakdowns'>('batches');

  // ── Filters ──
  const [filters, setFilters] = useState<AdminBatchFilters>({});
  const [searchInput, setSearchInput] = useState('');

  const [batches, setBatches] = useState<AdminBatchListRow[]>([]);
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

  // Shipment selection for move/remove actions
  const [moveSelection, setMoveSelection] = useState<Record<string, Set<string>>>({});

  // Modals
  const [moveModal, setMoveModal] = useState<{ batchId: string; shipmentIds: string[] } | null>(null);
  const [removeModal, setRemoveModal] = useState<{ batchId: string; shipmentIds: string[] } | null>(null);
  const [noteModal, setNoteModal] = useState<{ batchId: string } | null>(null);
  const [timeModal, setTimeModal] = useState<{ batchId: string; current: string | null } | null>(null);
  const [resolveModal, setResolveModal] = useState<BreakdownCase | null>(null);
  const [driverModal, setDriverModal] = useState<{ batchId: string } | null>(null);

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

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    const [res] = await Promise.all([fetchAdminBatches(filters), loadUnbatched()]);
    if (!res.ok) setError(t('batchMonitor.loadDataError', { error: res.error ?? '' }));
    else setBatches(res.batches ?? []);
    setLoading(false);
  }, [filters, loadUnbatched, t]);

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
        setAddShipmentMsg(prev => ({ ...prev, [batch.id]: `✓ ${t('batchMonitor.shipmentsAdded', { count: selected.length })}` }));
        setPhase8Selected(prev => ({ ...prev, [batch.id]: new Set() }));
        await loadBatches();
        await loadCompatibleShipments(batch);
      } else {
        setAddShipmentMsg(prev => ({ ...prev, [batch.id]: `✗ ${t('batchMonitor.addShipmentsFailed')}` }));
      }
    } catch {
      setAddShipmentMsg(prev => ({ ...prev, [batch.id]: `✗ ${t('batchMonitor.connectionError')}` }));
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
      setAssignMsg(prev => ({ ...prev, [batchId]: `✗ ${t('batchMonitor.driverUnavailable')}` }));
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
      setAssignMsg(prev => ({ ...prev, [batchId]: `✗ ${t('batchMonitor.assignmentFailed')}` }));
    } else {
      await supabase.from('driver_notifications').insert({
        courier_id: courierId,
        batch_id: batchId,
        is_accepted: true,
      });
      setAssignMsg(prev => ({ ...prev, [batchId]: `✓ ${t('batchMonitor.assignmentSucceeded')}` }));
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
      setCycleMsg(json.success ? `✓ ${t('batchMonitor.cycleSucceeded')}` : `✗ ${json.error ?? t('batchMonitor.cycleFailed')}`);
      await loadBatches();
    } catch {
      setCycleMsg(`✗ ${t('batchMonitor.connectionError')}`);
    }
    setCycling(false);
    setTimeout(() => setCycleMsg(''), 5000);
  };

  const zones = [...new Set(batches.map(b => b.zone).filter(Boolean))] as string[];
  const counts = Object.fromEntries(ALL_STATUSES.map(s => [s, batches.filter(b => b.status === s).length])) as Record<BatchStatus, number>;
  const delayedCount = batches.filter(b => b.is_delayed).length;
  const breakdownCount = batches.filter(b => b.has_active_breakdown).length;

  function applySearch() {
    setFilters(prev => ({ ...prev, q: searchInput.trim() || undefined }));
  }

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction, color: '#0F2B4E' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');`}</style>

      {/* Modals */}
      {moveModal && (
        <MoveShipmentsModal batchId={moveModal.batchId} shipmentIds={moveModal.shipmentIds}
          onClose={() => setMoveModal(null)}
          onSuccess={() => { setMoveModal(null); setMoveSelection(prev => ({ ...prev, [moveModal.batchId]: new Set() })); refreshDetail(moveModal.batchId); }} />
      )}
      {removeModal && (
        <RemoveShipmentsModal batchId={removeModal.batchId} shipmentIds={removeModal.shipmentIds}
          onClose={() => setRemoveModal(null)}
          onSuccess={() => { setRemoveModal(null); setMoveSelection(prev => ({ ...prev, [removeModal.batchId]: new Set() })); refreshDetail(removeModal.batchId); }} />
      )}
      {noteModal && (
        <AddNoteModal batchId={noteModal.batchId} onClose={() => setNoteModal(null)} onSuccess={() => { setNoteModal(null); refreshDetail(noteModal.batchId); }} />
      )}
      {timeModal && (
        <UpdateEstimatedTimeModal batchId={timeModal.batchId} currentValue={timeModal.current}
          onClose={() => setTimeModal(null)} onSuccess={() => { setTimeModal(null); refreshDetail(timeModal.batchId); }} />
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

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t('batchMonitor.title')}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#64748B' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            {t('batchMonitor.refreshEvery15s')}
          </label>
          <button onClick={() => { loadBatches(); if (tab === 'breakdowns') loadBreakdowns(); }} disabled={loading}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ↻ {t('batchMonitor.refresh')}
          </button>
          <button onClick={triggerCycle} disabled={cycling}
            style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#F97316,#EA580C)', color: '#fff', cursor: cycling ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', opacity: cycling ? 0.7 : 1 }}>
            {cycling ? `⏳ ${t('batchMonitor.running')}` : `▶ ${t('batchMonitor.runCycle')}`}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button onClick={() => setTab('batches')} style={{
          padding: '6px 16px', borderRadius: 20, border: '1.5px solid', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          borderColor: tab === 'batches' ? '#0F2B4E' : '#E2E8F0', background: tab === 'batches' ? '#0F2B4E' : '#fff',
          color: tab === 'batches' ? '#fff' : '#64748B', fontWeight: tab === 'batches' ? 700 : 400,
        }}>{t('batchMonitor.batchesTab')}</button>
        <button onClick={() => setTab('breakdowns')} style={{
          padding: '6px 16px', borderRadius: 20, border: '1.5px solid', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          borderColor: tab === 'breakdowns' ? '#DC2626' : '#E2E8F0', background: tab === 'breakdowns' ? '#FEF2F2' : '#fff',
          color: tab === 'breakdowns' ? '#DC2626' : '#64748B', fontWeight: tab === 'breakdowns' ? 700 : 400,
        }}>
          {t('batchMonitor.breakdownsTab')} {breakdownCount > 0 && <span style={{ fontFamily: 'monospace' }}>({breakdownCount})</span>}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 18 }}>
            {[
              { label: t('batchMonitor.stats.total'), value: batches.length, color: '#0F2B4E', bg: '#F8FAFC', border: '#E2E8F0' },
              { label: t('batchMonitor.status.pending_assignment'), value: counts.pending_assignment, color: '#C2410C', bg: '#FFF7ED', border: '#FDBA74' },
              { label: t('batchMonitor.status.assigned'), value: counts.assigned, color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD' },
              { label: t('batchMonitor.status.in_transit'), value: counts.in_transit, color: '#15803D', bg: '#F0FDF4', border: '#86EFAC' },
              { label: t('batchMonitor.stats.completed'), value: counts.completed, color: '#475569', bg: '#F8FAFC', border: '#CBD5E1' },
              { label: t('batchMonitor.stats.delayed'), value: delayedCount, color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
              { label: t('batchMonitor.stats.hasBreakdown'), value: breakdownCount, color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 10, padding: '10px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: '12px 14px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 10 }}>
            <select style={inputStyle} value={filters.status ?? ''} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value || undefined }))}>
              <option value="">{t('batchMonitor.filters.allStatuses')}</option>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select style={inputStyle} value={filters.driver_id ?? ''} onChange={e => setFilters(prev => ({ ...prev, driver_id: e.target.value || undefined }))}>
              <option value="">{t('batchMonitor.filters.allDrivers')}</option>
              {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select style={inputStyle} value={filters.zone ?? ''} onChange={e => setFilters(prev => ({ ...prev, zone: e.target.value || undefined }))}>
              <option value="">{t('batchMonitor.filters.allZones')}</option>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
            <select style={inputStyle} value={filters.delayed ?? ''} onChange={e => setFilters(prev => ({ ...prev, delayed: (e.target.value || undefined) as any }))}>
              <option value="">{t('batchMonitor.filters.allDelayStates')}</option>
              <option value="true">{t('batchMonitor.filters.delayedOnly')}</option>
              <option value="lt1h">{t('batchMonitor.filters.delayedLt1h')}</option>
              <option value="gt1h">{t('batchMonitor.filters.delayedGt1h')}</option>
              <option value="severe">{t('batchMonitor.filters.delayedSevere')}</option>
              <option value="with_reason">{t('batchMonitor.filters.delayedWithReason')}</option>
              <option value="without_reason">{t('batchMonitor.filters.delayedWithoutReason')}</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B', cursor: 'pointer' }}>
              <input type="checkbox" checked={filters.breakdown === 'true'} onChange={e => setFilters(prev => ({ ...prev, breakdown: e.target.checked ? 'true' : undefined }))} />
              {t('batchMonitor.filters.breakdownOnly')}
            </label>
            <input type="date" style={inputStyle} value={filters.date_from ?? ''} onChange={e => setFilters(prev => ({ ...prev, date_from: e.target.value || undefined }))} title={t('batchMonitor.filters.fromDate')} />
            <input type="date" style={inputStyle} value={filters.date_to ?? ''} onChange={e => setFilters(prev => ({ ...prev, date_to: e.target.value || undefined }))} title={t('batchMonitor.filters.toDate')} />
            <input type="text" style={{ ...inputStyle, minWidth: 180 }} placeholder={t('batchMonitor.filters.searchPlaceholder')} value={searchInput}
              onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && applySearch()} />
            <button onClick={applySearch} style={{ ...inputStyle, cursor: 'pointer', background: '#0F2B4E', color: '#fff', border: 'none' }}>{t('batchMonitor.filters.search')}</button>
            {(filters.status || filters.driver_id || filters.zone || filters.delayed || filters.breakdown || filters.date_from || filters.date_to || filters.q) && (
              <button onClick={() => { setFilters({}); setSearchInput(''); }} style={{ ...inputStyle, cursor: 'pointer', color: '#DC2626' }}>{t('batchMonitor.filters.reset')}</button>
            )}
          </div>

          {error && (
            <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>{error}</div>
          )}
          {loading && <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('batchMonitor.loading')}</div>}

          {/* Unbatched individual shipment cards */}
          {!loading && unbatchedShipments.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 8, letterSpacing: '0.05em' }}>
                {t('batchMonitor.unbatchedShipments', { count: unbatchedShipments.length })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {unbatchedShipments.map(s => (
                  <div key={s.id} style={{ background: '#fff', border: '1.5px solid #FDE68A', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{
                      background: s.status === 'delayed' ? '#FEF2F2' : '#FFFBEB', color: s.status === 'delayed' ? '#DC2626' : '#92400E',
                      border: `1px solid ${s.status === 'delayed' ? '#FCA5A5' : '#FDE68A'}`, borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
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
                      <Chip icon="📦" label={t('batchMonitor.singleParcel')} />
                      {s.delayed_reason && <Chip icon="⚠" label={s.delayed_reason} color="red" />}
                      <span style={{ fontSize: 10, color: '#94A3B8' }}>{formatDate(s.created_at, numLocale)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && batches.length === 0 && unbatchedShipments.length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('batchMonitor.noMatchingBatches')}</div>
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
                  {/* Card header */}
                  <div onClick={() => toggle(batch)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap' }}>
                    <span style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}`, borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {STATUS_LABELS[batch.status as BatchStatus] ?? batch.status}
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
                          : <span style={{ color: '#94A3B8', fontSize: 11 }}>{t('batchMonitor.noRoute')}</span>}
                      </div>
                      <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>{batch.batch_number}</span>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                      <Chip icon="📦" label={t('batchMonitor.shipmentCount', { count: batch.shipment_count })} />
                      <Chip icon="⚖" label={`${batch.total_volume}/${batch.max_volume}`} />
                      <Chip icon="✅" label={t('batchMonitor.deliveredCount', { count: batch.delivered_count })} color="green" />
                      <Chip icon="🚚" label={t('batchMonitor.pickedUpCount', { count: batch.picked_up_count })} color="blue" />
                      <Chip icon="🏬" label={t('batchMonitor.notPickedUpCount', { count: batch.not_picked_up_count })} color="gray" />
                      {batch.courier?.name && <Chip icon="🚗" label={batch.courier.name} color="blue" />}
                      {batch.is_delayed && <Chip icon="⏰" label={t('batchMonitor.delayedMinutes', { minutes: batch.delay_minutes })} color="orange" />}
                      {batch.has_active_breakdown && <Chip icon="🛑" label={t('batchMonitor.activeBreakdown')} color="red" />}
                      {batch.requires_manual_intervention && <Chip icon="⚠" label={t('batchMonitor.requiresManualIntervention')} color="red" />}
                      {batch.under_monitoring && <Chip icon="👁" label={t('batchMonitor.underMonitoring')} color="orange" />}
                      {batch.needs_dispatcher && <Chip icon="⚠" label={t('batchMonitor.needsDispatcher')} color="red" />}
                    </div>

                    <span style={{ color: '#94A3B8', fontSize: 12, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {/* Expanded details */}
                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${col.border}`, padding: '14px 16px', background: col.bg }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
                        <Detail label={t('batchMonitor.detail.zone')} value={batch.zone ?? '—'} />
                        <Detail label={t('batchMonitor.detail.createdAt')} value={formatDate(batch.created_at, numLocale)} />
                        <Detail label={t('batchMonitor.detail.startedAt')} value={formatDate(batch.started_at, numLocale)} />
                        <Detail label={t('batchMonitor.detail.actualCompletion')} value={formatDate(batch.completed_at, numLocale)} />
                        <Detail label={t('batchMonitor.detail.expectedCompletion')} value={formatDate(batch.expected_completion_at, numLocale)} />
                        <Detail label={t('batchMonitor.detail.capacityUsed')} value={`${batch.total_volume} / ${batch.max_volume}`} />
                        <Detail label={t('batchMonitor.detail.stops')} value={`${batch.stops_used} / ${batch.max_stops}`} />
                        {detail?.batch.courier && (
                          <Detail label={t('batchMonitor.detail.vehicleInfo')} value={t('batchMonitor.detail.driverCapacity', { volume: detail.batch.courier.max_volume })} />
                        )}
                        {batch.delay_reason && <Detail label={t('batchMonitor.detail.delayReason')} value={batch.delay_reason} />}
                        {batch.breakdown_reason && <Detail label={t('batchMonitor.detail.breakdownReason')} value={batch.breakdown_reason} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                        <button onClick={() => setNoteModal({ batchId: batch.id })} style={actionBtnStyle('#1D4ED8')}>📝 {t('batchMonitor.addNote')}</button>
                        <button onClick={() => setTimeModal({ batchId: batch.id, current: detail?.batch.expected_completion_at ?? null })} style={actionBtnStyle('#1D4ED8')}>⏱ {t('batchMonitor.updateEta')}</button>
                        {eligibleSelected.length > 0 && (
                          <>
                            <button onClick={() => setMoveModal({ batchId: batch.id, shipmentIds: eligibleSelected.map(s => s.id) })} style={actionBtnStyle('#15803D')}>
                              🔁 {t('batchMonitor.moveToAnotherBatch', { count: eligibleSelected.length })}
                            </button>
                            <button onClick={() => setRemoveModal({ batchId: batch.id, shipmentIds: eligibleSelected.map(s => s.id) })} style={actionBtnStyle('#DC2626')}>
                              ↩️ {t('batchMonitor.removeAndReturn', { count: eligibleSelected.length })}
                            </button>
                          </>
                        )}
                      </div>

                      {isDetailLoading && <div style={{ color: '#94A3B8', fontSize: 12, padding: '10px 0', textAlign: 'center' }}>{t('batchMonitor.loadingShipmentDetails')}</div>}

                      {detail && (
                        <ShipmentsTable
                          shipments={detail.shipments}
                          selected={selectedForMove}
                          onToggle={id => toggleMoveSelection(batch.id, id)}
                        />
                      )}

                      {batch.status === 'in_transit' && batch.route.length >= 2 && (
                        <div style={{ marginTop: 16, padding: '14px 16px', background: '#F0FDF4', border: '1.5px solid #86EFAC', borderRadius: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#15803D' }}>{t('batchMonitor.addShipmentsFromZone', { zone: batch.route[1] })}</div>
                            {batch.estimated_minutes_to_next_zone != null && (
                              <span style={{ fontSize: 11, color: '#15803D', background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 5, padding: '2px 8px' }}>
                                ⏱ {t('batchMonitor.minutesToArrival', { minutes: batch.estimated_minutes_to_next_zone })}
                              </span>
                            )}
                          </div>

                          {loadingCompatible.has(batch.id) && <div style={{ color: '#94A3B8', fontSize: 12 }}>{t('batchMonitor.searchingCompatible')}</div>}
                          {!loadingCompatible.has(batch.id) && (compatibleShipments[batch.id]?.length ?? 0) === 0 && (
                            <div style={{ color: '#94A3B8', fontSize: 12 }}>{t('batchMonitor.noAvailableFromZone', { zone: batch.route[1] })}</div>
                          )}
                          {!loadingCompatible.has(batch.id) && (compatibleShipments[batch.id]?.length ?? 0) > 0 && (
                            <>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto', marginBottom: 10 }}>
                                {compatibleShipments[batch.id].map(s => (
                                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#0F2B4E' }}>
                                    <input type="checkbox" checked={phase8Selected[batch.id]?.has(s.id) ?? false} onChange={() => togglePhase8Selection(batch.id, s.id)} style={{ accentColor: '#15803D' }} />
                                    <span style={{ fontFamily: 'monospace', color: '#64748B' }}>{s.shipment_number}</span>
                                    <span>{s.pickup_zone} ← {s.dropoff_zone}</span>
                                    <span style={{ fontSize: 10, color: s.status === 'delayed' ? '#C2410C' : '#15803D' }}>{SHIPMENT_STATUS_LABELS[s.status] ?? s.status}</span>
                                  </label>
                                ))}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <button disabled={!(phase8Selected[batch.id]?.size) || addingShipments.has(batch.id)} onClick={() => addShipmentsToBatch(batch)}
                                  style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: (phase8Selected[batch.id]?.size) ? '#15803D' : '#CBD5E1', color: '#fff', cursor: (phase8Selected[batch.id]?.size) ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', opacity: addingShipments.has(batch.id) ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                                  {addingShipments.has(batch.id) ? `⏳ ${t('batchMonitor.processing')}` : `${t('batchMonitor.addToBatch')}${(phase8Selected[batch.id]?.size) ? ` (${phase8Selected[batch.id].size})` : ''}`}
                                </button>
                                {addShipmentMsg[batch.id] && (
                                  <span style={{ fontSize: 12, color: addShipmentMsg[batch.id].startsWith('✓') ? '#15803D' : '#DC2626', fontWeight: 600 }}>{addShipmentMsg[batch.id]}</span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Driver assignment/change — hidden entirely for completed/cancelled batches.
                          If the batch is in_transit, ChangeDriverModal itself shows the
                          "driver already departed — are you sure?" confirmation. */}
                      {!['completed', 'cancelled'].includes(batch.status) && (
                        <div style={{ marginTop: 16, padding: '14px 16px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ fontSize: 12, color: '#64748B' }}>
                              {t('batchMonitor.assignedDriver')}: <strong style={{ color: '#0F2B4E' }}>{batch.courier?.name ?? t('batchMonitor.noAssignedDriver')}</strong>
                            </div>
                            <button onClick={() => setDriverModal({ batchId: batch.id })} style={actionBtnStyle('#EA580C')}>
                              🚗 {batch.courier ? t('batchManagement.changeDriverTitle') : t('batchManagement.assignDriverTitle')}
                            </button>
                          </div>
                        </div>
                      )}

                      {detail && <AuditLogPanel entries={detail.audit_log} />}
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

function ShipmentsTable({ shipments, selected, onToggle }: {
  shipments: AdminShipmentDetail[]; selected: Set<string>; onToggle: (id: string) => void;
}) {
  const { t } = useTranslation('admin');
  if (!shipments.length) return null;

  function custodyChip(s: AdminShipmentDetail) {
    if (s.delivered) return <Chip icon="✅" label={t('batchMonitor.custody.delivered')} color="green" />;
    if (s.requires_manual_handling) return <Chip icon="⚠" label={t('batchMonitor.custody.requiresManualHandling')} color="red" />;
    if (s.in_driver_custody) return <Chip icon="🚚" label={t('batchMonitor.custody.withDriver')} color="blue" />;
    return <Chip icon="🏬" label={t('batchMonitor.custody.notPickedUpFromStore')} color="gray" />;
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, marginBottom: 8 }}>{t('batchMonitor.shipmentDetails', { count: shipments.length })}</div>
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 30 }}></th>
              <th style={thStyle}>{t('batchMonitor.table.shipment')}</th>
              <th style={thStyle}>{t('batchMonitor.table.order')}</th>
              <th style={thStyle}>{t('batchMonitor.table.merchant')}</th>
              <th style={thStyle}>{t('batchMonitor.table.customer')}</th>
              <th style={thStyle}>{t('batchMonitor.table.fromTo')}</th>
              <th style={thStyle}>{t('batchMonitor.table.leg')}</th>
              <th style={thStyle}>{t('batchMonitor.table.volume')}</th>
              <th style={thStyle}>{t('batchMonitor.table.custodyStatus')}</th>
              <th style={thStyle}>{t('batchMonitor.table.sequence')}</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s, idx) => (
              <tr key={s.id} style={{ background: '#fff' }}>
                <td style={tdStyle}>
                  <input type="checkbox" disabled={!s.not_picked_up} checked={selected.has(s.id)} onChange={() => onToggle(s.id)}
                    title={s.not_picked_up ? t('batchMonitor.selectForMoveRemove') : t('batchMonitor.cannotSelect')} />
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{s.shipment_number}</td>
                <td style={tdStyle}>{s.order_id ? `#${s.order_id}` : '—'}</td>
                <td style={tdStyle}>{s.merchant_name ?? '—'}</td>
                <td style={tdStyle}>{s.customer_name ?? '—'}</td>
                <td style={tdStyle}>{s.pickup_zone} ← {s.dropoff_zone}</td>
                <td style={tdStyle}>{s.leg === 'ab' ? <Chip icon="①" label={t('batchMonitor.legAB')} color="blue" /> : <Chip icon="②" label={t('batchMonitor.legBC')} color="orange" />}</td>
                <td style={tdStyle}>{s.volume}</td>
                <td style={tdStyle}>{custodyChip(s)}</td>
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
  const { t } = useTranslation('admin');
  const { lang } = useLanguage();
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const ACTION_TYPE_LABELS = getActionTypeLabels(t);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, marginBottom: 8 }}>{t('batchMonitor.auditLog', { count: entries.length })}</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94A3B8' }}>{t('batchMonitor.noAuditEntries')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {entries.map(e => (
            <div key={e.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <strong style={{ color: '#0F2B4E' }}>{ACTION_TYPE_LABELS[e.action_type] ?? e.action_type}</strong>
                <span style={{ color: '#94A3B8', fontSize: 11 }}>{formatDate(e.created_at, numLocale)}</span>
              </div>
              <div style={{ color: '#64748B', marginTop: 3 }}>
                {t('batchMonitor.performedBy')}: {e.performed_by_name ?? e.performed_by}
                {e.reason && <> · {t('batchMonitor.reasonLabel')}: {e.reason}</>}
              </div>
              {e.action_type === 'change_driver' && e.metadata && (
                <div style={{ color: '#64748B', marginTop: 3 }}>
                  {String((e.metadata as any).previous_courier_name ?? '—')} ← {String((e.metadata as any).new_courier_name ?? '—')}
                  {(e.metadata as any).driver_already_departed && <span style={{ color: '#DC2626', fontWeight: 700 }}> ({t('batchMonitor.changedAfterDeparture')})</span>}
                </div>
              )}
              {e.notes && <div style={{ color: '#94A3B8', marginTop: 3 }}>{t('batchMonitor.notesLabel')}: {e.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BreakdownsPanel({ cases, loading, onResolve }: { cases: BreakdownCase[]; loading: boolean; onResolve: (c: BreakdownCase) => void }) {
  const { t } = useTranslation('admin');
  const { lang } = useLanguage();
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('batchMonitor.loading')}</div>;
  if (cases.length === 0) return <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('batchMonitor.noBreakdowns')} 🎉</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {cases.map(c => (
        <div key={c.id} style={{ background: '#fff', border: `1.5px solid ${c.is_active ? '#FCA5A5' : '#E2E8F0'}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Chip icon={c.is_active ? '🛑' : '✅'} label={c.is_active ? t('batchMonitor.activeBreakdown') : t('batchMonitor.resolved')} color={c.is_active ? 'red' : 'green'} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8' }}>{c.batch_number}</span>
              <span style={{ fontSize: 12 }}>{c.route.join(' ← ')}</span>
              {c.courier?.name && <Chip icon="🚗" label={c.courier.name} color="blue" />}
            </div>
            {c.is_active && <button onClick={() => onResolve(c)} style={actionBtnStyle('#15803D')}>🛠 {t('batchMonitor.resolveBreakdown')}</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, fontSize: 12, color: '#475569' }}>
            <Detail label={t('batchMonitor.detail.reportedAt')} value={formatDate(c.breakdown_reported_at, numLocale)} />
            <Detail label={t('batchMonitor.detail.breakdownReason')} value={c.breakdown_reason ?? t('batchMonitor.noReasonGiven')} />
            <Detail label={t('batchMonitor.detail.driverLocationAtReport')} value={c.breakdown_location ? `${c.breakdown_location.lat.toFixed(4)}, ${c.breakdown_location.lng.toFixed(4)}` : '—'} />
            <Detail label={t('batchMonitor.detail.notPickedUpReturned')} value={String(c.not_picked_up)} />
            <Detail label={t('batchMonitor.detail.requiresManualHandling')} value={c.stranded.length ? c.stranded.map(s => s.shipment_number).join(', ') : t('batchMonitor.none')} />
            {!c.is_active && <Detail label={t('batchMonitor.detail.resolutionOutcome')} value={c.breakdown_resolution ?? '—'} />}
          </div>
        </div>
      ))}
    </div>
  );
}
