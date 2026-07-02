import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';

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
  const { t } = useTranslation('admin');
  const { direction } = useLanguage();
  const TYPE_LABEL: Record<PayeeType, string> = {
    shop: t('salesLedger.type.shop'), courier: t('salesLedger.type.courier'), platform: t('salesLedger.type.platform'),
  };
  // Split Payout statuses + legacy ones (so old rows still render).
  const STATUS_LABEL: Record<string, string> = {
    distributed: t('salesLedger.status.distributed'), platform_held: t('salesLedger.status.platform_held'),
    pending: t('salesLedger.status.pending'), queued: t('salesLedger.status.queued'), submitted: t('salesLedger.status.submitted'),
    paid: t('salesLedger.status.paid'), failed: t('salesLedger.status.failed'), skipped: t('salesLedger.status.skipped'), reversed: t('salesLedger.status.reversed'),
  };
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
      if (!token) { setError(t('salesLedger.sessionExpired')); setLoading(false); return; }
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
      if (!res.ok) { setError(json.error ?? t('salesLedger.loadError')); setLoading(false); return; }
      setRows(json.rows ?? []);
      setGroups(json.groups ?? []);
      setSummary(json.summary ?? null);
    } catch {
      setError(t('salesLedger.connectionError'));
    }
    setLoading(false);
  }, [type, status, from, to, q, t]);

  useEffect(() => { load(); }, []); // initial load; filters apply via the button

  const currency = rows[0]?.currency ?? '₪';

  const exportCSV = () => {
    if (tab === 'transactions') {
      downloadCSV(
        'sales-ledger.csv',
        [t('salesLedger.csv.date'), t('salesLedger.csv.orderNumber'), t('salesLedger.csv.payee'), t('salesLedger.csv.type'), t('salesLedger.csv.amount'), t('salesLedger.csv.currency'), t('salesLedger.csv.status')],
        rows.map(r => [
          fmtDate(r.created_at), r.order_id ?? '', r.payee_name, TYPE_LABEL[r.payee_type],
          r.amount, r.currency ?? '', STATUS_LABEL[r.status] ?? r.status,
        ]),
      );
    } else {
      downloadCSV(
        'sales-by-payee.csv',
        [t('salesLedger.csv.payee'), t('salesLedger.csv.type'), t('salesLedger.csv.total'), t('salesLedger.csv.distributed'), t('salesLedger.csv.held'), t('salesLedger.csv.transactionCount')],
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

  const th: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#94A3B8', textAlign: direction === 'rtl' ? 'right' : 'left', padding: '8px 12px', borderBottom: '1.5px solid #E2E8F0', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 13, color: '#1E3A5F', padding: '9px 12px', borderBottom: '1px solid #F1F5F9', textAlign: direction === 'rtl' ? 'right' : 'left' };

  const tableHasData = tab === 'transactions' ? rows.length > 0 : groups.length > 0;

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", color: '#0F2B4E', direction, background: '#F8FAFC', borderRadius: 8, padding: 16 }}>
      <style>{FONTS_CSS}</style>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{t('salesLedger.title')}</h1>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>{t('salesLedger.subtitle')}</p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {card(t('salesLedger.cards.customerPaid'), `${fmtMoney(summary.customer_paid_total)} ${currency}`, '#0F2B4E')}
          {card(t('salesLedger.cards.merchantShares'), `${fmtMoney(summary.merchants_total)} ${currency}`, '#0F766E')}
          {card(t('salesLedger.cards.courierFees'), `${fmtMoney(summary.couriers_total)} ${currency}`, '#7C3AED')}
          {card(t('salesLedger.cards.platformCommission'), `${fmtMoney(summary.platform_total)} ${currency}`, '#EA580C')}
          {card(t('salesLedger.status.distributed'), `${fmtMoney(summary.distributed)} ${currency}`, '#15803D')}
          {card(t('salesLedger.status.platform_held'), `${fmtMoney(summary.held)} ${currency}`, '#C2410C')}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
          <option value="">{t('salesLedger.filters.allPayees')}</option>
          <option value="shop">{t('salesLedger.type.shop')}</option>
          <option value="courier">{t('salesLedger.type.courier')}</option>
          <option value="platform">{t('salesLedger.type.platform')}</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
          <option value="">{t('salesLedger.filters.allStatuses')}</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} title={t('salesLedger.filters.from')} />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} title={t('salesLedger.filters.to')} />
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} placeholder={t('salesLedger.filters.searchPlaceholder')} style={{ ...inputStyle, flex: '1 1 160px', maxWidth: 240 }} />
        <button onClick={load} style={{ background: 'linear-gradient(135deg,#F97316,#EA580C)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 18px', cursor: 'pointer', fontFamily: "'Tajawal', sans-serif" }}>{t('salesLedger.filters.apply')}</button>
        <button onClick={exportCSV} disabled={!tableHasData} style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 7, color: tableHasData ? '#0F2B4E' : '#CBD5E1', fontSize: 13, fontWeight: 700, padding: '8px 14px', cursor: tableHasData ? 'pointer' : 'not-allowed', fontFamily: "'Tajawal', sans-serif" }}>⬇ {t('salesLedger.filters.exportCsv')}</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([['transactions', t('salesLedger.tabs.byTransaction')], ['byPayee', t('salesLedger.tabs.byPayee')]] as const).map(([key, label]) => (
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
        <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>{t('salesLedger.loading')}</div>
      ) : error ? (
        <div style={{ padding: 16, color: '#B91C1C', background: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 8 }}>{error}</div>
      ) : !tableHasData ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>{t('salesLedger.noRecords')}</div>
      ) : (
        <div className="sl-scroll" style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 10, overflow: 'auto' }}>
          {tab === 'transactions' ? (
            <table className="sl-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>{t('salesLedger.csv.date')}</th><th style={th}>{t('salesLedger.order')}</th><th style={th}>{t('salesLedger.csv.payee')}</th>
                  <th style={th}>{t('salesLedger.csv.type')}</th><th style={th}>{t('salesLedger.csv.amount')}</th><th style={th}>{t('salesLedger.csv.status')}</th>
                  <th style={th}>{t('salesLedger.paidAtDate')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={td} data-label={t('salesLedger.csv.date')}>{fmtDate(r.created_at)}</td>
                    <td style={td} data-label={t('salesLedger.order')}>{r.order_id ?? '—'}</td>
                    <td style={{ ...td, fontWeight: 600 }} data-label={t('salesLedger.csv.payee')}>{r.payee_name}</td>
                    <td style={td} data-label={t('salesLedger.csv.type')}>{TYPE_LABEL[r.payee_type]}</td>
                    <td style={{ ...td, fontWeight: 700 }} data-label={t('salesLedger.csv.amount')}>{fmtMoney(Number(r.amount))} {r.currency ?? currency}</td>
                    <td style={td} data-label={t('salesLedger.csv.status')}>{statusBadge(r.status)}</td>
                    <td style={td} data-label={t('salesLedger.paidAtDate')}>{fmtDate(r.paid_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="sl-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>{t('salesLedger.csv.payee')}</th><th style={th}>{t('salesLedger.csv.type')}</th><th style={th}>{t('salesLedger.csv.total')}</th>
                  <th style={th}>{t('salesLedger.csv.distributed')}</th><th style={th}>{t('salesLedger.csv.held')}</th><th style={th}>{t('salesLedger.csv.transactionCount')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={`${g.payee_type}:${g.payee_id}`}>
                    <td style={{ ...td, fontWeight: 600 }} data-label={t('salesLedger.csv.payee')}>{g.payee_name}</td>
                    <td style={td} data-label={t('salesLedger.csv.type')}>{TYPE_LABEL[g.payee_type]}</td>
                    <td style={{ ...td, fontWeight: 700 }} data-label={t('salesLedger.csv.total')}>{fmtMoney(g.total)} {currency}</td>
                    <td style={{ ...td, color: '#15803D' }} data-label={t('salesLedger.csv.distributed')}>{fmtMoney(g.distributed_total)} {currency}</td>
                    <td style={{ ...td, color: '#C2410C' }} data-label={t('salesLedger.csv.held')}>{fmtMoney(g.held_total)} {currency}</td>
                    <td style={td} data-label={t('salesLedger.csv.transactionCount')}>{g.count}</td>
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
