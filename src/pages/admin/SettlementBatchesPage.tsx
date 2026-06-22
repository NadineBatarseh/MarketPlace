import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Admin — vendor settlement batches monitor ("تحويلات التجار").
 *
 * Reads the settlement batches through the requireAdmin-gated API
 * (GET /api/payments/payouts/batches). Lets an admin trigger a sweep now
 * (POST /run), drill into one batch + its payout lines (GET /batches/:id),
 * and re-poll PayTabs for a batch (POST /reconcile/:id).
 */

const API_BASE = 'http://localhost:4000';

const FONTS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
  @media (max-width: 760px) {
    .sb-scroll { overflow: visible !important; border: none !important; background: transparent !important; }
    .sb-table thead { display: none; }
    .sb-table, .sb-table tbody, .sb-table tr, .sb-table td { display: block; width: 100%; }
    .sb-table tr {
      background: #FFFFFF; border: 1.5px solid #E2E8F0; border-radius: 10px;
      margin-bottom: 10px; padding: 6px 12px;
    }
    .sb-table td {
      border: none !important; display: flex; align-items: center;
      justify-content: space-between; gap: 12px; padding: 7px 0 !important; text-align: left;
    }
    .sb-table td::before {
      content: attr(data-label); font-weight: 700; color: #64748B; font-size: 12px; white-space: nowrap;
    }
  }
`;

interface Batch {
  id: string;
  paytabs_batch_id: string | null;
  status: string;
  payout_count: number;
  total_amount: number;
  currency: string;
  created_at: string;
  closed_at: string | null;
  completed_at: string | null;
  error: string | null;
}

interface BatchLine {
  id: string;
  order_id: number | null;
  payee_type: string;
  payee_id: string | null;
  amount: number;
  currency: string | null;
  status: string;
  paytabs_payout_ref: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  attempts: number;
}

interface SweepSummary {
  batch_id: string | null;
  paytabs_batch_id: string | null;
  claimed: number;
  skipped: number;
  total_amount: number;
  currency: string | null;
  status: string;
}

// Batch lifecycle: creating → open → closed → completed | failed | cancelled
const BATCH_STATUS_LABEL: Record<string, string> = {
  creating: 'قيد الإنشاء', open: 'مفتوحة', closed: 'مغلقة',
  completed: 'مكتملة', failed: 'فشلت', cancelled: 'ملغاة',
};
// Per-line payout status (matches the ledger).
const LINE_STATUS_LABEL: Record<string, string> = {
  pending: 'قيد الانتظار', queued: 'في الطابور', submitted: 'قيد التحويل',
  paid: 'مدفوع', failed: 'فشل', skipped: 'متجاوز', reversed: 'معكوس',
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  completed: { bg: '#F0FDF4', fg: '#15803D' }, paid: { bg: '#F0FDF4', fg: '#15803D' },
  closed: { bg: '#EFF6FF', fg: '#1D4ED8' }, submitted: { bg: '#EFF6FF', fg: '#1D4ED8' },
  open: { bg: '#FFF7ED', fg: '#C2410C' }, creating: { bg: '#FFF7ED', fg: '#C2410C' },
  pending: { bg: '#FFF7ED', fg: '#C2410C' }, queued: { bg: '#FFF7ED', fg: '#C2410C' },
  failed: { bg: '#FEF2F2', fg: '#B91C1C' },
  cancelled: { bg: '#F1F5F9', fg: '#475569' }, skipped: { bg: '#F1F5F9', fg: '#475569' },
  reversed: { bg: '#F1F5F9', fg: '#475569' },
};
const TYPE_LABEL: Record<string, string> = { shop: 'تاجر', courier: 'مندوب', platform: 'المنصّة' };

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const card = (label: string, value: string, accent: string) => (
  <div key={label} style={{ flex: '1 1 150px', background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: accent }}>{value}</div>
  </div>
);

const th: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#94A3B8', textAlign: 'right', padding: '8px 12px', borderBottom: '1.5px solid #E2E8F0', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { fontSize: 13, color: '#1E3A5F', padding: '9px 12px', borderBottom: '1px solid #F1F5F9', textAlign: 'right' };

function statusBadge(s: string, labels: Record<string, string>) {
  const c = STATUS_COLOR[s] ?? { bg: '#F1F5F9', fg: '#475569' };
  return <span style={{ fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg, borderRadius: 5, padding: '2px 8px' }}>{labels[s] ?? s}</span>;
}

const SettlementBatchesPage: React.FC<{ embedded?: boolean }> = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);

  // drill-in
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<BatchLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payouts/batches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'تعذّر تحميل الدفعات.'); setLoading(false); return; }
      setBatches(json.batches ?? []);
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runSweep = async () => {
    setRunning(true);
    setNotice('');
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setRunning(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payouts/run`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'تعذّر تشغيل التسوية.'); setRunning(false); return; }
      const s = json.summary as SweepSummary;
      setNotice(
        s.status === 'noop'
          ? 'لا توجد أرباح مستحقّة للتحويل حاليًا.'
          : `النتيجة: ${s.status} — تم ضمّ ${s.claimed} تحويل (${fmtMoney(s.total_amount)} ${s.currency ?? ''})، وتجاوز ${s.skipped}.`,
      );
      await load();
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    }
    setRunning(false);
  };

  const fetchLines = async (id: string) => {
    setLinesLoading(true);
    try {
      const token = await getToken();
      if (!token) { setLinesLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payouts/batches/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) setLines(json.payouts ?? []);
    } catch { /* ignore */ }
    setLinesLoading(false);
  };

  const openBatch = async (id: string) => {
    if (openId === id) { setOpenId(null); setLines([]); return; }
    setOpenId(id);
    setLines([]);
    await fetchLines(id);
  };

  const reconcile = async (id: string) => {
    setReconciling(true);
    setNotice('');
    setError('');
    try {
      const token = await getToken();
      if (!token) { setReconciling(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payouts/reconcile/${id}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'تعذّرت إعادة المطابقة.'); setReconciling(false); return; }
      setNotice(`إعادة المطابقة: مدفوع ${json.paid ?? 0}، فشل ${json.failed ?? 0}، قيد المعالجة ${json.pending ?? 0}.`);
      await load();
      if (openId === id) await fetchLines(id); // refresh the open drill-in
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    }
    setReconciling(false);
  };

  const currency = batches[0]?.currency ?? '₪';
  const totalPending = batches.filter(b => ['creating', 'open', 'closed'].includes(b.status)).reduce((s, b) => s + Number(b.total_amount || 0), 0);
  const totalDone = batches.filter(b => b.status === 'completed').reduce((s, b) => s + Number(b.total_amount || 0), 0);

  const btn = (bg: string, disabled: boolean): React.CSSProperties => ({
    background: bg, border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700,
    padding: '8px 18px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
    fontFamily: "'Tajawal', sans-serif",
  });

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", color: '#0F2B4E', direction: 'rtl', background: '#F8FAFC', borderRadius: 8, padding: 16 }}>
      <style>{FONTS_CSS}</style>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>تحويلات التجار (التسوية)</h1>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>دفعات تحويل أرباح التجار إلى حساباتهم البنكية عبر PayTabs، وحالتها.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={runSweep} disabled={running} style={btn('linear-gradient(135deg,#F97316,#EA580C)', running)}>
            {running ? '...جارٍ التشغيل' : '⚡ تشغيل التسوية الآن'}
          </button>
          <button onClick={load} disabled={loading} style={{ ...btn('#FFFFFF', loading), color: '#0F2B4E', border: '1.5px solid #E2E8F0' }}>↻ تحديث</button>
        </div>
      </div>

      {notice && <div style={{ padding: 12, marginBottom: 12, color: '#1D4ED8', background: '#EFF6FF', border: '1.5px solid #BFDBFE', borderRadius: 8, fontSize: 13 }}>{notice}</div>}
      {error && <div style={{ padding: 12, marginBottom: 12, color: '#B91C1C', background: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 8, fontSize: 13 }}>{error}</div>}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {card('عدد الدفعات', String(batches.length), '#0F2B4E')}
        {card('قيد التحويل', `${fmtMoney(totalPending)} ${currency}`, '#C2410C')}
        {card('اكتملت', `${fmtMoney(totalDone)} ${currency}`, '#15803D')}
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>...جاري تحميل الدفعات</div>
      ) : batches.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>لا توجد دفعات تسوية بعد. اضغط «تشغيل التسوية الآن» لإنشاء دفعة من الأرباح المستحقّة.</div>
      ) : (
        <div className="sb-scroll" style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 10, overflow: 'auto' }}>
          <table className="sb-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>تاريخ الإنشاء</th><th style={th}>مرجع PayTabs</th><th style={th}>الحالة</th>
                <th style={th}>عدد التحويلات</th><th style={th}>الإجمالي</th><th style={th}>الخطأ</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <React.Fragment key={b.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => openBatch(b.id)}>
                    <td style={td} data-label="تاريخ الإنشاء">{fmtDateTime(b.created_at)}</td>
                    <td style={td} data-label="مرجع PayTabs">{b.paytabs_batch_id ?? '—'}</td>
                    <td style={td} data-label="الحالة">{statusBadge(b.status, BATCH_STATUS_LABEL)}</td>
                    <td style={td} data-label="عدد التحويلات">{b.payout_count}</td>
                    <td style={{ ...td, fontWeight: 700 }} data-label="الإجمالي">{fmtMoney(b.total_amount)} {b.currency}</td>
                    <td style={{ ...td, color: '#B91C1C', maxWidth: 240, whiteSpace: 'normal' }} data-label="الخطأ">{b.error ?? '—'}</td>
                    <td style={td} data-label="">{openId === b.id ? '▲' : '▼'}</td>
                  </tr>
                  {openId === b.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                        <div style={{ padding: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                            <strong style={{ fontSize: 13 }}>تحويلات هذه الدفعة</strong>
                            <button onClick={() => reconcile(b.id)} disabled={reconciling || !b.paytabs_batch_id}
                              style={btn('#0F766E', reconciling || !b.paytabs_batch_id)}>
                              {reconciling ? '...جارٍ' : '↻ إعادة المطابقة مع PayTabs'}
                            </button>
                          </div>
                          {linesLoading ? (
                            <div style={{ padding: 16, textAlign: 'center', color: '#64748B' }}>...جاري التحميل</div>
                          ) : lines.length === 0 ? (
                            <div style={{ padding: 16, textAlign: 'center', color: '#94A3B8' }}>لا توجد تحويلات في هذه الدفعة.</div>
                          ) : (
                            <table className="sb-table" style={{ width: '100%', borderCollapse: 'collapse', background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 8 }}>
                              <thead>
                                <tr>
                                  <th style={th}>الطلب</th><th style={th}>المستفيد</th><th style={th}>المبلغ</th>
                                  <th style={th}>الحالة</th><th style={th}>المحاولات</th><th style={th}>سبب الفشل</th><th style={th}>مرجع</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map(l => (
                                  <tr key={l.id}>
                                    <td style={td} data-label="الطلب">{l.order_id ?? '—'}</td>
                                    <td style={td} data-label="المستفيد">{TYPE_LABEL[l.payee_type] ?? l.payee_type}</td>
                                    <td style={{ ...td, fontWeight: 700 }} data-label="المبلغ">{fmtMoney(l.amount)} {l.currency ?? currency}</td>
                                    <td style={td} data-label="الحالة">{statusBadge(l.status, LINE_STATUS_LABEL)}</td>
                                    <td style={td} data-label="المحاولات">{l.attempts}</td>
                                    <td style={{ ...td, color: '#B91C1C', maxWidth: 200, whiteSpace: 'normal' }} data-label="سبب الفشل">{l.failure_reason ?? '—'}</td>
                                    <td style={td} data-label="مرجع">{l.paytabs_payout_ref ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SettlementBatchesPage;
