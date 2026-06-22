import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { supabase } from '../../lib/supabase';

/**
 * Admin — financial analytics overview ("التحليلات المالية").
 *
 * A visuals-first dashboard on the payouts ledger (GET /api/payments/payouts/ledger,
 * requireAdmin). Each chart sits in its own full-width card with an axis legend, and a
 * period selector (week … year … all) windows the data + adapts the time bucket
 * (day / week / month) so the trend stays readable at any range.
 */

const API_BASE = 'http://localhost:4000';
const FONTS_CSS = `@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');`;

type PayeeType = 'shop' | 'courier' | 'platform';
interface LedgerRow { payee_type: PayeeType; amount: number; currency: string | null; created_at: string; }
interface Group { payee_type: PayeeType; payee_name: string; total: number; }
interface Summary {
  customer_paid_total: number; merchants_total: number; couriers_total: number;
  platform_total: number; paid: number; pending: number; in_process: number; failed: number; count: number;
}

const CAT = { merchants: '#0F766E', couriers: '#7C3AED', platform: '#EA580C' };

// Period presets. days=null → all time. `gran` is the time bucket used for the trend.
const PERIODS: { key: string; label: string; days: number | null; gran: 'day' | 'week' | 'month' }[] = [
  { key: 'week',    label: 'أسبوع',   days: 7,    gran: 'day' },
  { key: 'month',   label: 'شهر',     days: 30,   gran: 'day' },
  { key: '2months', label: 'شهرين',   days: 60,   gran: 'week' },
  { key: '6months', label: '6 أشهر',  days: 180,  gran: 'week' },
  { key: 'year',    label: 'سنة',     days: 365,  gran: 'month' },
  { key: 'sinceStart', label: 'منذ بدء المنصّة', days: null, gran: 'month' },
];

const GRAN_LABEL: Record<string, string> = { day: 'يومي', week: 'أسبوعي', month: 'شهري' };

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
// Bucket a timestamp into a day/week/month key (sortable, zero-padded).
function bucketKey(iso: string, gran: 'day' | 'week' | 'month'): string {
  const d = new Date(iso);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
  if (gran === 'month') return `${y}-${m}`;
  if (gran === 'week') {
    const s = new Date(d); s.setDate(d.getDate() - d.getDay()); // back to Sunday
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
  }
  return `${y}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

const FinancialAnalyticsPage: React.FC<{ embedded?: boolean }> = () => {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodKey, setPeriodKey] = useState('sinceStart');
  const [chart, setChart] = useState<'revenue' | 'distribution' | 'topMerchants'>('revenue');

  const period = PERIODS.find(p => p.key === periodKey) ?? PERIODS[PERIODS.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setLoading(false); return; }
      const params = new URLSearchParams();
      if (period.days !== null) {
        const fromDate = new Date(Date.now() - period.days * 86_400_000);
        params.set('from', fromDate.toISOString());
      }
      const res = await fetch(`${API_BASE}/api/payments/payouts/ledger?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'تعذّر تحميل التحليلات.'); setLoading(false); return; }
      setRows(json.rows ?? []);
      setGroups(json.groups ?? []);
      setSummary(json.summary ?? null);
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    }
    setLoading(false);
  }, [period.days]);

  useEffect(() => { load(); }, [load]); // reloads whenever the period changes

  const currency = rows[0]?.currency ?? '₪';
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const timeSeries = useMemo(() => {
    const byKey = new Map<string, { date: string; merchants: number; couriers: number; platform: number }>();
    for (const row of rows) {
      const k = bucketKey(row.created_at, period.gran);
      let e = byKey.get(k);
      if (!e) { e = { date: k, merchants: 0, couriers: 0, platform: 0 }; byKey.set(k, e); }
      const amt = Number(row.amount ?? 0);
      if (row.payee_type === 'shop') e.merchants += amt;
      else if (row.payee_type === 'courier') e.couriers += amt;
      else e.platform += amt;
    }
    return [...byKey.values()]
      .map(e => ({ date: e.date, merchants: r2(e.merchants), couriers: r2(e.couriers), platform: r2(e.platform) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [rows, period.gran]);

  const distribution = useMemo(() => (summary ? [
    { name: 'التجار', value: summary.merchants_total, color: CAT.merchants },
    { name: 'المناديب', value: summary.couriers_total, color: CAT.couriers },
    { name: 'المنصّة', value: summary.platform_total, color: CAT.platform },
  ].filter(d => d.value > 0) : []), [summary]);

  const topMerchants = useMemo(
    () => groups.filter(g => g.payee_type === 'shop').slice(0, 10).map(g => ({ name: g.payee_name, total: g.total })),
    [groups],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moneyTip = (v: any) => `${fmtMoney(Number(v))} ${currency}`;

  const chartCard: React.CSSProperties = { background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 12, padding: 18, boxShadow: '0 1px 4px rgba(15,43,78,0.05)' };
  const chartTitle: React.CSSProperties = { fontSize: 16, fontWeight: 800, color: '#0F2B4E', direction: 'rtl', textAlign: 'right' };
  const axisNote: React.CSSProperties = { fontSize: 12, color: '#64748B', direction: 'rtl', textAlign: 'right', marginTop: 4, marginBottom: 14, lineHeight: 1.6 };

  // A small "what the axes mean" legend shown under each chart title.
  const AxisLegend: React.FC<{ x: string; y: string }> = ({ x, y }) => (
    <div style={axisNote}>
      <span><b>المحور الأفقي (السيني):</b> {x}</span>
      <span style={{ margin: '0 8px', color: '#CBD5E1' }}>|</span>
      <span><b>المحور العمودي (الصادي):</b> {y}</span>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", color: '#0F2B4E', direction: 'rtl', background: '#F8FAFC', borderRadius: 8, padding: 16 }}>
      <style>{FONTS_CSS}</style>

      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>التحليلات</h1>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>نظرة بصرية تحليلية. اختاري الفترة الزمنية ونوع الرسم لعرضه.</p>
      </div>

      {/* Chart-type selector (above the period selector) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {([
          ['revenue', 'الإيرادات عبر الوقت'],
          ['distribution', 'توزيع الأموال'],
          ['topMerchants', 'أعلى التجار أرباحًا'],
        ] as const).map(([key, label]) => {
          const active = chart === key;
          return (
            <button key={key} onClick={() => setChart(key)}
              style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Tajawal', sans-serif",
                border: active ? '1.5px solid #FED7AA' : '1.5px solid #E2E8F0',
                background: active ? '#FFF7ED' : '#FFFFFF', color: active ? '#EA580C' : '#64748B' }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {PERIODS.map(p => {
          const active = p.key === periodKey;
          return (
            <button key={p.key} onClick={() => setPeriodKey(p.key)}
              style={{ fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Tajawal', sans-serif",
                border: active ? '1.5px solid #FED7AA' : '1.5px solid #E2E8F0',
                background: active ? '#FFF7ED' : '#FFFFFF', color: active ? '#EA580C' : '#64748B' }}>
              {p.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#64748B' }}>...جاري تحميل التحليلات</div>
      ) : error ? (
        <div style={{ padding: 16, color: '#B91C1C', background: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 8 }}>{error}</div>
      ) : (
        <>
          {rows.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>لا توجد بيانات ضمن هذه الفترة.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* ── 1. Revenue over time ── */}
              {chart === 'revenue' && (
              <div style={chartCard}>
                <div style={chartTitle}>الإيرادات عبر الوقت (تجميع {GRAN_LABEL[period.gran]})</div>
                <AxisLegend x={`الزمن — كل نقطة فترة ${GRAN_LABEL[period.gran]}`} y={`المبلغ الموزَّع (${currency}) مقسومًا على التجار/المناديب/المنصّة`} />
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={340}>
                    <AreaChart data={timeSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} width={60} />
                      <Tooltip formatter={moneyTip} />
                      <Legend />
                      <Area type="monotone" dataKey="merchants" name="التجار" stackId="1" stroke={CAT.merchants} fill={CAT.merchants} fillOpacity={0.25} />
                      <Area type="monotone" dataKey="couriers" name="المناديب" stackId="1" stroke={CAT.couriers} fill={CAT.couriers} fillOpacity={0.25} />
                      <Area type="monotone" dataKey="platform" name="المنصّة" stackId="1" stroke={CAT.platform} fill={CAT.platform} fillOpacity={0.25} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              )}

              {/* ── 2. Money distribution ── */}
              {chart === 'distribution' && (
              <div style={chartCard}>
                <div style={{ ...chartTitle, marginBottom: 14 }}>توزيع الأموال بين الأطراف</div>
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Pie data={distribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={75} outerRadius={120} paddingAngle={2}>
                        {distribution.map(d => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={moneyTip} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              )}

              {/* ── 3. Top merchants ── */}
              {chart === 'topMerchants' && (
              <div style={chartCard}>
                <div style={chartTitle}>أعلى التجار أرباحًا (أعلى 10)</div>
                <AxisLegend x={`إجمالي أرباح التاجر (${currency}) — كلّما طال العمود زادت الأرباح`} y="اسم التاجر" />
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={Math.max(320, topMerchants.length * 40)}>
                    <BarChart data={topMerchants} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#1E3A5F' }} />
                      <Tooltip formatter={moneyTip} />
                      <Bar dataKey="total" name="الإجمالي" fill={CAT.merchants} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default FinancialAnalyticsPage;
