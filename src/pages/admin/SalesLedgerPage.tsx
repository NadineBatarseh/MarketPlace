import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Admin — sales & earnings ledger ("كشف سجلات المبيعات").
 *
 * Reads the payouts ledger through the requireAdmin-gated API
 * (GET /api/payments/payouts/ledger). Two views: per-transaction and grouped per
 * payee (merchant / courier / platform). Supports filters + CSV export.
 * (The visual charts live separately in FinancialAnalyticsPage.)
 */

const API_BASE = 'http://localhost:4000';

const FONTS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
  /* On phones the table reflows into stacked cards (no horizontal scroll). */
  @media (max-width: 760px) {
    .sl-scroll { overflow: visible !important; border: none !important; background: transparent !important; }
    .sl-table thead { display: none; }
    .sl-table, .sl-table tbody, .sl-table tr, .sl-table td { display: block; width: 100%; }
    .sl-table tr {
      background: #FFFFFF; border: 1.5px solid #E2E8F0; border-radius: 10px;
      margin-bottom: 10px; padding: 6px 12px;
    }
    .sl-table td {
      border: none !important; display: flex; align-items: center;
      justify-content: space-between; gap: 12px; padding: 7px 0 !important; text-align: left;
    }
    .sl-table td::before {
      content: attr(data-label); font-weight: 700; color: #64748B; font-size: 12px; white-space: nowrap;
    }
  }
`;

type PayeeType = 'shop' | 'courier' | 'platform';

interface LedgerRow {
  id: string;
  order_id: number | null;
  payee_type: PayeeType;
  payee_id: string | null;
  payee_name: string;
  amount: number;
  currency: string | null;
  status: string;
  note: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
}
interface Group {
  payee_type: PayeeType;
  payee_id: string | null;
  payee_name: string;
  total: number;
  distributed_total: number;
  held_total: number;
  count: number;
}
interface Summary {
  customer_paid_total: number;
  merchants_total: number;
  couriers_total: number;
  platform_total: number;
  distributed: number;
  held: number;
  count: number;
}

const TYPE_LABEL: Record<PayeeType, string> = { shop: 'تاجر', courier: 'مندوب', platform: 'المنصّة' };
// Split Payout statuses + legacy ones (so old rows still render).
const STATUS_LABEL: Record<string, string> = {
  distributed: 'موزّعة عبر PayTabs', platform_held: 'محتجزة لدى المنصّة',
  pending: 'قيد الانتظار', queued: 'في الطابور', submitted: 'قيد التحويل',
  paid: 'مدفوع', failed: 'فشل', skipped: 'متجاوز', reversed: 'معكوس',
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  distributed: { bg: '#F0FDF4', fg: '#15803D' },
  platform_held: { bg: '#FFF7ED', fg: '#C2410C' },
  paid: { bg: '#F0FDF4', fg: '#15803D' },
  pending: { bg: '#FFF7ED', fg: '#C2410C' },
  queued: { bg: '#FFF7ED', fg: '#C2410C' },
  submitted: { bg: '#EFF6FF', fg: '#1D4ED8' },
  failed: { bg: '#FEF2F2', fg: '#B91C1C' },
  skipped: { bg: '#F1F5F9', fg: '#475569' },
  reversed: { bg: '#F1F5F9', fg: '#475569' },
};

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadCSV(filename: string, headers: string[], records: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...records].map(r => r.map(esc).join(',')).join('\n');
  // BOM so Excel reads Arabic/UTF-8 correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const card = (label: string, value: string, accent: string) => (
  <div key={label} style={{ flex: '1 1 150px', background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: accent }}>{value}</div>
  </div>
);

const SalesLedgerPage: React.FC<{ embedded?: boolean }> = () => {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'transactions' | 'byPayee'>('transactions');

  // filters
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setLoading(false); return; }
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', new Date(to + 'T23:59:59').toISOString());
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`${API_BASE}/api/payments/payouts/ledger?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'تعذّر تحميل الكشف.'); setLoading(false); return; }
      setRows(json.rows ?? []);
      setGroups(json.groups ?? []);
      setSummary(json.summary ?? null);
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    }
    setLoading(false);
  }, [type, status, from, to, q]);

  useEffect(() => { load(); }, []); // initial load; filters apply via the button

  const currency = rows[0]?.currency ?? '₪';

  const exportCSV = () => {
    if (tab === 'transactions') {
      downloadCSV(
        'sales-ledger.csv',
        ['التاريخ', 'رقم الطلب', 'المستفيد', 'النوع', 'المبلغ', 'العملة', 'الحالة'],
        rows.map(r => [
          fmtDate(r.created_at), r.order_id ?? '', r.payee_name, TYPE_LABEL[r.payee_type],
          r.amount, r.currency ?? '', STATUS_LABEL[r.status] ?? r.status,
        ]),
      );
    } else {
      downloadCSV(
        'sales-by-payee.csv',
        ['المستفيد', 'النوع', 'الإجمالي', 'موزّعة', 'محتجزة', 'عدد المعاملات'],
        groups.map(g => [g.payee_name, TYPE_LABEL[g.payee_type], g.total, g.distributed_total, g.held_total, g.count]),
      );
    }
  };

  const inputStyle: React.CSSProperties = {
    background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 7, color: '#0F2B4E',
    fontSize: 13, padding: '7px 10px', outline: 'none', fontFamily: "'Tajawal', sans-serif",
  };

  const statusBadge = (s: string) => {
    const c = STATUS_COLOR[s] ?? { bg: '#F1F5F9', fg: '#475569' };
    return <span style={{ fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg, borderRadius: 5, padding: '2px 8px' }}>{STATUS_LABEL[s] ?? s}</span>;
  };

  const th: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#94A3B8', textAlign: 'right', padding: '8px 12px', borderBottom: '1.5px solid #E2E8F0', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 13, color: '#1E3A5F', padding: '9px 12px', borderBottom: '1px solid #F1F5F9', textAlign: 'right' };

  const tableHasData = tab === 'transactions' ? rows.length > 0 : groups.length > 0;

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", color: '#0F2B4E', direction: 'rtl', background: '#F8FAFC', borderRadius: 8, padding: 16 }}>
      <style>{FONTS_CSS}</style>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>كشف المبيعات والأرباح</h1>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>سجلّ توزيع الأموال على التجار والمناديب والمنصّة، مع الإجماليات وإمكانية التصدير.</p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {card('مدفوعات العملاء', `${fmtMoney(summary.customer_paid_total)} ${currency}`, '#0F2B4E')}
          {card('حصص التجار', `${fmtMoney(summary.merchants_total)} ${currency}`, '#0F766E')}
          {card('أجور المناديب', `${fmtMoney(summary.couriers_total)} ${currency}`, '#7C3AED')}
          {card('عمولة المنصّة', `${fmtMoney(summary.platform_total)} ${currency}`, '#EA580C')}
          {card('موزّعة عبر PayTabs', `${fmtMoney(summary.distributed)} ${currency}`, '#15803D')}
          {card('محتجزة لدى المنصّة', `${fmtMoney(summary.held)} ${currency}`, '#C2410C')}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
          <option value="">كل المستفيدين</option>
          <option value="shop">التجار</option>
          <option value="courier">المناديب</option>
          <option value="platform">المنصّة</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} title="من" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} title="إلى" />
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} placeholder="بحث بالاسم..." style={{ ...inputStyle, flex: '1 1 160px', maxWidth: 240 }} />
        <button onClick={load} style={{ background: 'linear-gradient(135deg,#F97316,#EA580C)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 18px', cursor: 'pointer', fontFamily: "'Tajawal', sans-serif" }}>تطبيق</button>
        <button onClick={exportCSV} disabled={!tableHasData} style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 7, color: tableHasData ? '#0F2B4E' : '#CBD5E1', fontSize: 13, fontWeight: 700, padding: '8px 14px', cursor: tableHasData ? 'pointer' : 'not-allowed', fontFamily: "'Tajawal', sans-serif" }}>⬇ تصدير CSV</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([['transactions', 'حسب المعاملة'], ['byPayee', 'حسب المستفيد']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 7, cursor: 'pointer', fontFamily: "'Tajawal', sans-serif",
              border: tab === key ? '1.5px solid #FED7AA' : '1.5px solid #E2E8F0',
              background: tab === key ? '#FFF7ED' : '#FFFFFF', color: tab === key ? '#EA580C' : '#64748B' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>...جاري تحميل الكشف</div>
      ) : error ? (
        <div style={{ padding: 16, color: '#B91C1C', background: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 8 }}>{error}</div>
      ) : !tableHasData ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>لا توجد سجلات مطابقة.</div>
      ) : (
        <div className="sl-scroll" style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 10, overflow: 'auto' }}>
          {tab === 'transactions' ? (
            <table className="sl-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>التاريخ</th><th style={th}>الطلب</th><th style={th}>المستفيد</th>
                  <th style={th}>النوع</th><th style={th}>المبلغ</th><th style={th}>الحالة</th>
                  <th style={th}>تاريخ الصرف</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={td} data-label="التاريخ">{fmtDate(r.created_at)}</td>
                    <td style={td} data-label="الطلب">{r.order_id ?? '—'}</td>
                    <td style={{ ...td, fontWeight: 600 }} data-label="المستفيد">{r.payee_name}</td>
                    <td style={td} data-label="النوع">{TYPE_LABEL[r.payee_type]}</td>
                    <td style={{ ...td, fontWeight: 700 }} data-label="المبلغ">{fmtMoney(Number(r.amount))} {r.currency ?? currency}</td>
                    <td style={td} data-label="الحالة">{statusBadge(r.status)}</td>
                    <td style={td} data-label="تاريخ الصرف">{fmtDate(r.paid_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="sl-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>المستفيد</th><th style={th}>النوع</th><th style={th}>الإجمالي</th>
                  <th style={th}>موزّعة</th><th style={th}>محتجزة</th><th style={th}>عدد المعاملات</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={`${g.payee_type}:${g.payee_id}`}>
                    <td style={{ ...td, fontWeight: 600 }} data-label="المستفيد">{g.payee_name}</td>
                    <td style={td} data-label="النوع">{TYPE_LABEL[g.payee_type]}</td>
                    <td style={{ ...td, fontWeight: 700 }} data-label="الإجمالي">{fmtMoney(g.total)} {currency}</td>
                    <td style={{ ...td, color: '#15803D' }} data-label="موزّعة">{fmtMoney(g.distributed_total)} {currency}</td>
                    <td style={{ ...td, color: '#C2410C' }} data-label="محتجزة">{fmtMoney(g.held_total)} {currency}</td>
                    <td style={td} data-label="عدد المعاملات">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default SalesLedgerPage;
