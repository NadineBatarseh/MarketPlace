import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useLanguage } from '../../../context/LanguageContext';
import {
  BATCH_ADMIN_REASON_CODES,
  fetchEligibleDestinations,
  moveShipments,
  removeShipments,
  addBatchNote,
  updateEstimatedTime,
  resolveBreakdown,
  changeDriver,
  type BatchAdminReasonCode,
  type EligibleDestination,
  type BreakdownCase,
} from '../../../lib/adminBatches';

function ModalShell({ title, icon, onClose, children, width = 480 }: {
  title: string; icon?: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  const { direction } = useLanguage();
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,43,78,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        fontFamily: "'Tajawal', sans-serif", direction, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: '22px 26px', maxWidth: width, width: '100%',
          maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0F2B4E' }}>{icon} {title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// direction is inherited from ModalShell's root, which sets it dynamically per language.
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #E2E8F0',
  fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box', color: '#0F2B4E',
};

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 5, display: 'block' };

function ReasonFields({ reasonCode, setReasonCode, reason, setReason, notes, setNotes }: {
  reasonCode: BatchAdminReasonCode | ''; setReasonCode: (v: BatchAdminReasonCode | '') => void;
  reason: string; setReason: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t('batchManagement.reasonType')} *</label>
        <select value={reasonCode} onChange={e => setReasonCode(e.target.value as BatchAdminReasonCode)} style={inputStyle}>
          <option value="">{t('batchManagement.chooseReason')}</option>
          {BATCH_ADMIN_REASON_CODES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t('batchManagement.reasonDetails')} *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder={t('batchManagement.reasonDetailsPlaceholder')} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{t('batchManagement.additionalNotes')}</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
    </>
  );
}

function ErrorBox({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 7, color: '#DC2626', fontSize: 12, marginBottom: 12 }}>
      {error}
    </div>
  );
}

function ActionButtons({ onCancel, onConfirm, loading, confirmLabel, disabled }: {
  onCancel: () => void; onConfirm: () => void; loading: boolean; confirmLabel: string; disabled?: boolean;
}) {
  const { t } = useTranslation('admin');
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
      <button onClick={onCancel} disabled={loading} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 700 }}>
        {t('batchManagement.cancel')}
      </button>
      <button onClick={onConfirm} disabled={loading || disabled} style={{
        padding: '8px 18px', borderRadius: 8, border: 'none',
        background: (loading || disabled) ? '#CBD5E1' : '#15803D', color: '#fff',
        cursor: (loading || disabled) ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
      }}>
        {loading ? t('batchManagement.executing') : confirmLabel}
      </button>
    </div>
  );
}

/* ───────────────────────────── Move Shipments Modal ───────────────────────────── */
export function MoveShipmentsModal({ batchId, shipmentIds, onClose, onSuccess }: {
  batchId: string; shipmentIds: string[]; onClose: () => void; onSuccess: () => void;
}) {
  const { t } = useTranslation('admin');
  const BLOCKED_REASON_LABELS: Record<string, string> = {
    different_zone: t('batchManagement.blockedReason.differentZone'),
    max_stops_exceeded: t('batchManagement.blockedReason.maxStopsExceeded'),
    insufficient_capacity: t('batchManagement.blockedReason.insufficientCapacity'),
    active_breakdown: t('batchManagement.blockedReason.activeBreakdown'),
  };
  const [loadingDest, setLoadingDest] = useState(true);
  const [destinations, setDestinations] = useState<EligibleDestination[]>([]);
  const [movingVolume, setMovingVolume] = useState(0);
  const [zonePairs, setZonePairs] = useState<{ from: string; to: string }[]>([]);
  const [destError, setDestError] = useState('');
  const [selected, setSelected] = useState('');
  const [reasonCode, setReasonCode] = useState<BatchAdminReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoadingDest(true);
      const res = await fetchEligibleDestinations(batchId, shipmentIds);
      if (!res.ok) {
        setDestError(res.error ?? t('batchManagement.loadDestinationsError'));
      } else {
        setDestinations(res.destinations ?? []);
        setMovingVolume(res.moving_volume ?? 0);
        setZonePairs(res.zone_pairs ?? []);
      }
      setLoadingDest(false);
    })();
  }, [batchId, shipmentIds]);

  const dest = destinations.find(d => d.id === selected) ?? null;

  async function handleConfirm() {
    if (!selected || !reasonCode || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await moveShipments(batchId, {
      shipment_ids: shipmentIds, destination_batch_id: selected,
      reason_code: reasonCode, reason: reason.trim(), notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) { setError(res.error ?? t('batchManagement.moveError')); return; }
    onSuccess();
  }

  return (
    <ModalShell title={t('batchManagement.moveModalTitle', { count: shipmentIds.length })} icon="🔁" onClose={onClose} width={560}>
      <ErrorBox error={error || destError} />

      {zonePairs.length > 0 && (
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
          {t('batchManagement.routes')}: <strong>{zonePairs.map(p => `${p.from} ← ${p.to}`).join(', ')}</strong> · {t('batchManagement.totalSelectedVolume')}: <strong>{movingVolume}</strong> {t('batchManagement.unit')}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{t('batchManagement.destinationBatch')} *</label>
        {loadingDest ? (
          <div style={{ fontSize: 12, color: '#94A3B8' }}>{t('batchManagement.searchingDestinations')}</div>
        ) : destinations.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94A3B8' }}>{t('batchManagement.noCandidateDestinations')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {destinations.map(d => (
              <label key={d.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8,
                border: `1.5px solid ${selected === d.id ? '#86EFAC' : '#E2E8F0'}`,
                background: d.eligible ? (selected === d.id ? '#F0FDF4' : '#fff') : '#F8FAFC',
                cursor: d.eligible ? 'pointer' : 'not-allowed', opacity: d.eligible ? 1 : 0.6,
              }}>
                <input type="radio" name="dest" disabled={!d.eligible} checked={selected === d.id}
                  onChange={() => setSelected(d.id)} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, fontWeight: 700, color: '#0F2B4E' }}>
                    <span style={{ fontFamily: 'monospace' }}>{d.batch_number}</span>
                    <span>{d.route.join(' ← ')}</span>
                    {d.courier_name && <span style={{ color: '#1D4ED8' }}>🚗 {d.courier_name}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                    {t('batchManagement.capacity')}: {d.total_volume} ← {d.capacity_after} / {d.max_volume} · {t('batchManagement.stops')}: {d.stops_used} ← {d.stops_after} / {d.max_stops}
                  </div>
                  {!d.eligible && (
                    <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>
                      {d.blocked_reasons.map(r => BLOCKED_REASON_LABELS[r] ?? r).join(', ')}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {dest && (
        <div style={{ padding: '10px 12px', background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 8, fontSize: 12, color: '#1D4ED8', marginBottom: 14 }}>
          {t('batchManagement.moveSummary', { count: shipmentIds.length, volume: movingVolume, batchNumber: dest.batch_number })}
          {' '}{t('batchManagement.capacityAfterMove', { after: dest.capacity_after, max: dest.max_volume })} {t('batchManagement.stopsAfterMove', { after: dest.stops_after, max: dest.max_stops })}
        </div>
      )}

      <ReasonFields reasonCode={reasonCode} setReasonCode={setReasonCode} reason={reason} setReason={setReason} notes={notes} setNotes={setNotes} />

      <ActionButtons onCancel={onClose} onConfirm={handleConfirm} loading={submitting} confirmLabel={t('batchManagement.confirmMove')}
        disabled={!selected || !reasonCode || !reason.trim()} />
    </ModalShell>
  );
}

/* ───────────────────────────── Remove Shipments Modal ───────────────────────────── */
export function RemoveShipmentsModal({ batchId, shipmentIds, onClose, onSuccess }: {
  batchId: string; shipmentIds: string[]; onClose: () => void; onSuccess: () => void;
}) {
  const { t } = useTranslation('admin');
  const [reasonCode, setReasonCode] = useState<BatchAdminReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!reasonCode || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await removeShipments(batchId, { shipment_ids: shipmentIds, reason_code: reasonCode, reason: reason.trim(), notes: notes.trim() || undefined });
    setSubmitting(false);
    if (!res.ok) { setError(res.error ?? t('batchManagement.removeError')); return; }
    onSuccess();
  }

  return (
    <ModalShell title={t('batchManagement.removeModalTitle', { count: shipmentIds.length })} icon="↩️" onClose={onClose}>
      <ErrorBox error={error} />
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
        {t('batchManagement.removeExplanation')}
      </div>
      <ReasonFields reasonCode={reasonCode} setReasonCode={setReasonCode} reason={reason} setReason={setReason} notes={notes} setNotes={setNotes} />
      <ActionButtons onCancel={onClose} onConfirm={handleConfirm} loading={submitting} confirmLabel={t('batchManagement.confirmRemove')} disabled={!reasonCode || !reason.trim()} />
    </ModalShell>
  );
}

/* ───────────────────────────── Add Note / Monitoring Modal ───────────────────────────── */
export function AddNoteModal({ batchId, onClose, onSuccess }: { batchId: string; onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('admin');
  const [note, setNote] = useState('');
  const [underMonitoring, setUnderMonitoring] = useState(false);
  const [manualIntervention, setManualIntervention] = useState(false);
  const [driverContacted, setDriverContacted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!note.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await addBatchNote(batchId, { note: note.trim(), under_monitoring: underMonitoring || undefined, manual_intervention: manualIntervention || undefined, driver_contacted: driverContacted || undefined });
    setSubmitting(false);
    if (!res.ok) { setError(res.error ?? t('batchManagement.saveNoteError')); return; }
    onSuccess();
  }

  return (
    <ModalShell title={t('batchManagement.addNoteTitle')} icon="📝" onClose={onClose}>
      <ErrorBox error={error} />
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t('batchManagement.noteLabel')} *</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, fontSize: 12, color: '#0F2B4E' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={driverContacted} onChange={e => setDriverContacted(e.target.checked)} /> {t('batchManagement.driverContacted')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={underMonitoring} onChange={e => setUnderMonitoring(e.target.checked)} /> {t('batchManagement.underMonitoring')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={manualIntervention} onChange={e => setManualIntervention(e.target.checked)} /> {t('batchManagement.escalateManual')}
        </label>
      </div>
      <ActionButtons onCancel={onClose} onConfirm={handleConfirm} loading={submitting} confirmLabel={t('batchManagement.save')} disabled={!note.trim()} />
    </ModalShell>
  );
}

/* ───────────────────────────── Update Estimated Time Modal ───────────────────────────── */
export function UpdateEstimatedTimeModal({ batchId, currentValue, onClose, onSuccess }: {
  batchId: string; currentValue: string | null; onClose: () => void; onSuccess: () => void;
}) {
  const { t } = useTranslation('admin');
  const [value, setValue] = useState(currentValue ? currentValue.slice(0, 16) : '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!value || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await updateEstimatedTime(batchId, { expected_completion_at: new Date(value).toISOString(), reason: reason.trim() });
    setSubmitting(false);
    if (!res.ok) { setError(res.error ?? t('batchManagement.updateError')); return; }
    onSuccess();
  }

  return (
    <ModalShell title={t('batchManagement.updateEtaTitle')} icon="⏱" onClose={onClose} width={420}>
      <ErrorBox error={error} />
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t('batchManagement.newExpectedTime')} *</label>
        <input type="datetime-local" value={value} onChange={e => setValue(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{t('batchManagement.updateReason')} *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
      <ActionButtons onCancel={onClose} onConfirm={handleConfirm} loading={submitting} confirmLabel={t('batchManagement.save')} disabled={!value || !reason.trim()} />
    </ModalShell>
  );
}

/* ───────────────────────────── Resolve Breakdown Modal ───────────────────────────── */
export function ResolveBreakdownModal({ caseRow, onClose, onSuccess }: {
  caseRow: BreakdownCase; onClose: () => void; onSuccess: () => void;
}) {
  const { t } = useTranslation('admin');
  const [resolution, setResolution] = useState<'shipments_repooled' | 'manual_intervention_pending' | 'returned_to_warehouse' | 'follow_up_required'>('returned_to_warehouse');
  const [dispositions, setDispositions] = useState<Record<string, 'returned_to_warehouse' | 'still_with_driver'>>(
    Object.fromEntries(caseRow.stranded.map(s => [s.id, 'still_with_driver'])),
  );
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!note.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await resolveBreakdown(caseRow.id, {
      resolution, note: note.trim(),
      stranded_dispositions: Object.entries(dispositions).map(([shipment_id, disposition]) => ({ shipment_id, disposition })),
    });
    setSubmitting(false);
    if (!res.ok) { setError(res.error ?? t('batchManagement.closeBreakdownError')); return; }
    onSuccess();
  }

  return (
    <ModalShell title={t('batchManagement.resolveBreakdownTitle', { batchNumber: caseRow.batch_number })} icon="🛠" onClose={onClose} width={520}>
      <ErrorBox error={error} />

      {caseRow.stranded.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>{t('batchManagement.strandedShipmentsLabel', { count: caseRow.stranded.length })}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {caseRow.stranded.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12 }}>
                <span style={{ fontFamily: 'monospace' }}>{s.shipment_number}</span>
                <select value={dispositions[s.id]} onChange={e => setDispositions(prev => ({ ...prev, [s.id]: e.target.value as any }))} style={{ ...inputStyle, width: 'auto', padding: '4px 8px' }}>
                  <option value="still_with_driver">{t('batchManagement.disposition.stillWithDriver')}</option>
                  <option value="returned_to_warehouse">{t('batchManagement.disposition.returnedToWarehouse')}</option>
                </select>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
            {t('batchManagement.strandedNote')}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t('batchManagement.resolutionOutcome')} *</label>
        <select value={resolution} onChange={e => setResolution(e.target.value as any)} style={inputStyle}>
          <option value="returned_to_warehouse">{t('batchManagement.resolution.returnedToWarehouse')}</option>
          <option value="shipments_repooled">{t('batchManagement.resolution.shipmentsRepooled')}</option>
          <option value="manual_intervention_pending">{t('batchManagement.resolution.manualInterventionPending')}</option>
          <option value="follow_up_required">{t('batchManagement.resolution.followUpRequired')}</option>
        </select>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{t('batchManagement.closingNote')} *</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      <ActionButtons onCancel={onClose} onConfirm={handleConfirm} loading={submitting} confirmLabel={t('batchManagement.saveResolution')} disabled={!note.trim()} />
    </ModalShell>
  );
}

/* ───────────────────────────── Change Driver Modal ───────────────────────────── */
// Two steps: fill the form, then ALWAYS confirm in a separate dialog before
// committing — the dialog's wording escalates when the current driver has
// already departed (batch in_transit), per the explicit safety requirement.
export function ChangeDriverModal({ batchId, batchStatus, currentCourier, couriers, onClose, onSuccess }: {
  batchId: string; batchStatus: string; currentCourier: { id: string; name: string } | null;
  couriers: { id: string; name: string; status: string }[]; onClose: () => void; onSuccess: () => void;
}) {
  const { t } = useTranslation('admin');
  const [courierId, setCourierId] = useState('');
  const [reasonCode, setReasonCode] = useState<BatchAdminReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The driver is considered "departed" once the batch is in_transit and
  // someone is actually assigned — a fresh pending_assignment batch has no
  // driver on the road yet, so the scary warning would be meaningless there.
  const driverDeparted = batchStatus === 'in_transit' && !!currentCourier;
  const newCourierName = couriers.find(c => c.id === courierId)?.name ?? '';

  async function handleFinalConfirm() {
    setSubmitting(true);
    setError('');
    const res = await changeDriver(batchId, {
      courier_id: courierId, reason_code: reasonCode as BatchAdminReasonCode, reason: reason.trim(),
      notes: notes.trim() || undefined, confirm_departed: driverDeparted || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(
        res.error_code === 'driver_already_departed'
          ? t('batchManagement.driverAlreadyDeparted')
          : (res.error ?? t('batchManagement.changeDriverError')),
      );
      return;
    }
    onSuccess();
  }

  if (showConfirm) {
    return (
      <ConfirmDialog
        icon={driverDeparted ? '⚠️' : '🚗'}
        title={t('batchManagement.confirmChangeDriverTitle')}
        message={
          driverDeparted
            ? t('batchManagement.confirmChangeDriverDeparted', { currentName: currentCourier?.name, newName: newCourierName })
            : currentCourier
              ? t('batchManagement.confirmChangeDriverFrom', { currentName: currentCourier.name, newName: newCourierName })
              : t('batchManagement.confirmChangeDriver', { newName: newCourierName })
        }
        warning={driverDeparted ? t('batchManagement.driverDepartedWarning') : undefined}
        confirmLabel={t('batchManagement.yesChangeDriver')}
        cancelLabel={t('batchManagement.back')}
        confirmColor={driverDeparted ? '#DC2626' : '#15803D'}
        hideReversibilityNote
        loading={submitting}
        error={error}
        onConfirm={handleFinalConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    );
  }

  return (
    <ModalShell title={currentCourier ? t('batchManagement.changeDriverTitle') : t('batchManagement.assignDriverTitle')} icon="🚗" onClose={onClose} width={460}>
      <ErrorBox error={error} />

      {currentCourier && (
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
          {t('batchManagement.currentDriver')}: <strong style={{ color: '#0F2B4E' }}>{currentCourier.name}</strong>
        </div>
      )}

      {driverDeparted && (
        <div style={{ padding: '10px 12px', background: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#DC2626', fontWeight: 700 }}>
          ⚠ {t('batchManagement.driverDepartedNotice', { name: currentCourier?.name })}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{currentCourier ? t('batchManagement.newDriver') : t('batchManagement.driver')} *</label>
        <select value={courierId} onChange={e => setCourierId(e.target.value)} style={inputStyle}>
          <option value="">{t('batchManagement.chooseDriver')}</option>
          {couriers.filter(c => c.id !== currentCourier?.id).map(c => (
            <option key={c.id} value={c.id}>{c.name} {c.status !== 'available' ? `(${c.status})` : ''}</option>
          ))}
        </select>
      </div>

      <ReasonFields reasonCode={reasonCode} setReasonCode={setReasonCode} reason={reason} setReason={setReason} notes={notes} setNotes={setNotes} />

      <ActionButtons onCancel={onClose} onConfirm={() => setShowConfirm(true)} loading={false}
        confirmLabel={t('batchManagement.continue')}
        disabled={!courierId || !reasonCode || !reason.trim()} />
    </ModalShell>
  );
}
