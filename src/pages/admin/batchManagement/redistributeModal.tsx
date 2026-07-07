import { useEffect, useMemo, useState } from 'react';
import {
  fetchRedistributionPlan, redistributeShipments,
  type BatchAdminReasonCode, type RedistributionGroup,
} from '../../../lib/adminBatches';
import { ModalShell, ReasonFields, ErrorBox, ActionButtons, inputStyle, labelStyle } from './components';

const SOURCE_LABELS: Record<string, { icon: string; label: string }> = {
  store: { icon: '🏬', label: 'لم تُستلم بعد — نقطة الالتقاط: المتجر' },
  driver: { icon: '🚚', label: 'تم استلامها — نقطة الالتقاط: آخر موقع معروف للسائق' },
  breakdown: { icon: '🛑', label: 'تم استلامها قبل العطل — نقطة الالتقاط: موقع تعطل السائق' },
  unknown: { icon: '⚠', label: 'يتعذر تحديد نقطة الالتقاط — تُدار عبر شاشة معالجة العطل' },
};

const BLOCKED_REASON_LABELS: Record<string, string> = {
  different_zone: 'لا يوجد مسار مطابق لمنطقة تسليم هذه الشحنات في هذه التجميعة',
  max_stops_exceeded: 'سيتجاوز الحد الأقصى لعدد المحطات',
  insufficient_capacity: 'سعة غير كافية',
  active_breakdown: 'يوجد عطل نشط في هذه التجميعة',
  zone_coords_unavailable: 'تعذّر تحديد إحداثيات منطقة الوجهة للمقارنة',
  too_far: 'موقع الالتقاط الفعلي بعيد جداً عن مسار هذه التجميعة',
};

interface StagedOp {
  key: string;
  group_key: string;
  shipment_ids: string[];
  volume: number;
  label: string;
  target: { type: 'existing'; batch_id: string; batch_number: string } | { type: 'new' };
}

function groupKeyOf(g: RedistributionGroup): string {
  return `${g.source}::${g.pickup_zone ?? 'unknown'}::${g.dropoff_zone}`;
}

export function RedistributeShipmentsModal({ batchId, onClose, onSuccess }: {
  batchId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [groups, setGroups] = useState<RedistributionGroup[]>([]);
  const [checked, setChecked] = useState<Record<string, Set<string>>>({});
  const [destChoice, setDestChoice] = useState<Record<string, string>>({}); // group_key -> destination batch id, or '__new__'
  const [staged, setStaged] = useState<StagedOp[]>([]);

  const [reasonCode, setReasonCode] = useState<BatchAdminReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetchRedistributionPlan(batchId);
      if (!res.ok) { setLoadError(res.error ?? 'تعذّر تحميل تحليل الشحنات'); setLoading(false); return; }
      const gs = res.groups ?? [];
      setGroups(gs);
      setChecked(Object.fromEntries(gs.map(g => [groupKeyOf(g), new Set(g.shipment_ids)])));
      setLoading(false);
    })();
  }, [batchId]);

  const stagedShipmentIds = useMemo(() => new Set(staged.flatMap(s => s.shipment_ids)), [staged]);

  function remainingIds(g: RedistributionGroup): string[] {
    return g.shipment_ids.filter(id => !stagedShipmentIds.has(id));
  }

  function toggleShipment(groupKey: string, shipmentId: string) {
    setChecked(prev => {
      const next = new Set(prev[groupKey] ?? []);
      if (next.has(shipmentId)) next.delete(shipmentId); else next.add(shipmentId);
      return { ...prev, [groupKey]: next };
    });
  }

  function stageDecision(g: RedistributionGroup) {
    const groupKey = groupKeyOf(g);
    const remaining = new Set(remainingIds(g));
    const selectedIds = [...(checked[groupKey] ?? [])].filter(id => remaining.has(id));
    if (!selectedIds.length) return;
    const choice = destChoice[groupKey];
    if (!choice) return;

    const volume = Math.round((g.total_volume / g.shipment_ids.length) * selectedIds.length);
    const label = `${SOURCE_LABELS[g.source]?.icon ?? ''} ${g.pickup_zone ?? '?'} ← ${g.dropoff_zone} (${selectedIds.length} شحنة)`;

    if (choice === '__new__') {
      setStaged(prev => [...prev, { key: `${groupKey}:${Date.now()}`, group_key: groupKey, shipment_ids: selectedIds, volume, label, target: { type: 'new' } }]);
    } else {
      const dest = g.eligible_destinations.find(d => d.id === choice);
      if (!dest) return;
      setStaged(prev => [...prev, {
        key: `${groupKey}:${Date.now()}`, group_key: groupKey, shipment_ids: selectedIds, volume, label,
        target: { type: 'existing', batch_id: dest.id, batch_number: dest.batch_number },
      }]);
    }
    setDestChoice(prev => ({ ...prev, [groupKey]: '' }));
  }

  function unstage(key: string) {
    setStaged(prev => prev.filter(s => s.key !== key));
  }

  async function handleConfirm() {
    if (!staged.length || !reasonCode || !reason.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    const moves = staged.filter(s => s.target.type === 'existing').map(s => ({
      shipment_ids: s.shipment_ids, destination_batch_id: (s.target as { type: 'existing'; batch_id: string }).batch_id,
    }));
    const new_batches = staged.filter(s => s.target.type === 'new').map(s => ({ shipment_ids: s.shipment_ids }));

    const res = await redistributeShipments(batchId, {
      reason_code: reasonCode, reason: reason.trim(), notes: notes.trim() || undefined, moves, new_batches,
    });
    setSubmitting(false);
    if (!res.ok) { setSubmitError(res.error ?? 'فشلت عملية إعادة التوزيع'); return; }
    const failed = (res.results ?? []).filter(r => !r.success);
    if (failed.length) {
      setSubmitError(`تم تنفيذ ${(res.results ?? []).length - failed.length} من ${res.results?.length} عملية، وفشلت ${failed.length} — راجع سجل التدقيق للتفاصيل.`);
      return;
    }
    onSuccess();
  }

  return (
    <ModalShell title="إعادة توزيع الشحنات" icon="🔀" onClose={onClose} width={720}>
      <ErrorBox error={loadError || submitError} />

      {loading ? (
        <div style={{ fontSize: 12, color: '#94A3B8', padding: '12px 0' }}>جاري تحليل شحنات التجميعة...</div>
      ) : groups.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94A3B8', padding: '12px 0' }}>لا توجد شحنات نشطة في هذه التجميعة لإعادة توزيعها</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
            حلّل النظام شحنات هذه التجميعة وقسّمها بحسب نقطة الالتقاط الفعلية. لكل مجموعة، حدّد الشحنات المطلوبة واختر وجهة (تجميعة موجودة أو دفعة جديدة)، ثم اضغط "إضافة كقرار" — يمكنك تكرار ذلك لتقسيم نفس المجموعة على أكثر من وجهة، أو ترك بعض الشحنات دون قرار لمعالجتها لاحقاً.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
            {groups.map(g => {
              const groupKey = groupKeyOf(g);
              const remaining = remainingIds(g);
              if (!remaining.length) return null;
              const src = SOURCE_LABELS[g.source] ?? SOURCE_LABELS.unknown;
              const checkedSet = checked[groupKey] ?? new Set<string>();

              return (
                <div key={groupKey} style={{ border: '1.5px solid #E2E8F0', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0F2B4E' }}>
                      {g.pickup_zone ?? '؟'} ← {g.dropoff_zone} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({remaining.length} شحنة متبقية · {g.total_volume} وحدة)</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#475569' }}>{src.icon} {src.label}</span>
                  </div>

                  {!g.location_available ? (
                    <div style={{ fontSize: 12, color: '#DC2626' }}>لا يمكن تحديد نقطة التقاط موثوقة لهذه المجموعة — استخدم شاشة "معالجة العطل" لهذه الشحنات.</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, maxHeight: 90, overflowY: 'auto' }}>
                        {remaining.map(id => (
                          <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'monospace', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '2px 6px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checkedSet.has(id)} onChange={() => toggleShipment(groupKey, id)} />
                            {id.slice(0, 8)}
                          </label>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <select value={destChoice[groupKey] ?? ''} onChange={e => setDestChoice(prev => ({ ...prev, [groupKey]: e.target.value }))} style={{ ...inputStyle, width: 'auto', minWidth: 260, flex: 1 }}>
                          <option value="">اختر وجهة للشحنات المحددة...</option>
                          {g.can_create_new_batch && <option value="__new__">➕ إنشاء دفعة جديدة بهذه الشحنات</option>}
                          {g.eligible_destinations.map(d => (
                            <option key={d.id} value={d.id} disabled={!d.eligible}>
                              {d.batch_number} — {d.route.join(' ← ')}{d.match_type === 'distance_based' ? ` (تطابق بالمسافة: ${d.distance_km} كم)` : ''}{!d.eligible ? ` — ${d.blocked_reasons.map(r => BLOCKED_REASON_LABELS[r] ?? r).join('، ')}` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => stageDecision(g)}
                          disabled={!destChoice[groupKey] || ![...checkedSet].some(id => remaining.includes(id))}
                          style={{
                            padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                            background: (!destChoice[groupKey]) ? '#CBD5E1' : '#15803D', color: '#fff',
                            cursor: (!destChoice[groupKey]) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          إضافة كقرار
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {staged.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>القرارات المُعدّة ({staged.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {staged.map(s => (
                  <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 7, padding: '6px 10px' }}>
                    <span>
                      {s.label} ← {s.target.type === 'new' ? '➕ دفعة جديدة' : `🔁 ${s.target.batch_number}`}
                    </span>
                    <button onClick={() => unstage(s.key)} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>إلغاء</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ReasonFields reasonCode={reasonCode} setReasonCode={setReasonCode} reason={reason} setReason={setReason} notes={notes} setNotes={setNotes} />
          <ActionButtons onCancel={onClose} onConfirm={handleConfirm} loading={submitting} confirmLabel={`تنفيذ إعادة التوزيع (${staged.length} قرار)`}
            disabled={!staged.length || !reasonCode || !reason.trim()} />
        </>
      )}
    </ModalShell>
  );
}
