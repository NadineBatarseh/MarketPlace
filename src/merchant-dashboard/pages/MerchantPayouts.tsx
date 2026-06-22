import { useState, useEffect, useCallback } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';
import './MerchantPayouts.css';

const API_BASE = 'http://localhost:4000';

type PayoutStatus = 'pending' | 'queued' | 'submitted' | 'paid' | 'failed' | 'skipped' | 'reversed';

interface PayoutRow {
  id: string;
  order_id: number;
  amount: number;
  currency: string;
  status: PayoutStatus;
  settle_eligible_at: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

interface Summary {
  paid_total: number;
  pending_total: number;
  in_process_total: number;
  currency: string;
}

interface PayoutsResponse {
  ok: boolean;
  summary: Summary;
  onboarding_status: string;
  payouts: PayoutRow[];
}

// Arabic label + colour bucket per ledger status.
const STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  pending:   { label: 'قيد الانتظار', cls: 'mpo-st--amber' },
  queued:    { label: 'قيد التحويل',  cls: 'mpo-st--amber' },
  submitted: { label: 'قيد التحويل',  cls: 'mpo-st--blue' },
  paid:      { label: 'مدفوع',         cls: 'mpo-st--green' },
  failed:    { label: 'فشل',           cls: 'mpo-st--red' },
  skipped:   { label: 'معلّق',         cls: 'mpo-st--grey' },
  reversed:  { label: 'ملغى',          cls: 'mpo-st--red' },
};

const fmtMoney = (n: number, ccy: string) =>
  `${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function MerchantPayouts() {
  const { merchant } = useMerchantAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<PayoutsResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payout-onboarding/payouts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'تعذّر تحميل الأرباح.');
      else setData(json as PayoutsResponse);
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!merchant?.shop?.shop_id) { setLoading(false); return; }
    load();
  }, [merchant?.shop?.shop_id, load]);

  if (loading) {
    return <div className="mpo-root"><div className="md-page-loading">جاري تحميل الأرباح...</div></div>;
  }
  if (!merchant?.shop) {
    return <div className="mpo-root"><div className="md-page-empty">لا يوجد متجر مرتبط بحسابك.</div></div>;
  }

  const summary = data?.summary;
  const ccy = summary?.currency ?? 'ILS';
  const payouts = data?.payouts ?? [];
  const notOnboarded = data?.onboarding_status !== 'active';

  return (
    <div className="mpo-root">
      <h1 className="mpo-title">أرباحي</h1>
      <p className="mpo-subtitle">حصّتك من مبيعات متجرك بعد خصم عمولة المنصّة، وحالة تحويلها إلى حسابك البنكي.</p>

      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      {notOnboarded && (
        <div className="mpo-banner">
          أكمل <strong>بيانات الدفع</strong> (رقم الآيبان) لاستلام أرباحك إلى حسابك البنكي.
        </div>
      )}

      {/* Summary cards */}
      <div className="mpo-cards">
        <div className="mpo-card mpo-card--green">
          <div className="mpo-card-label">إجمالي المدفوع</div>
          <div className="mpo-card-value">{fmtMoney(summary?.paid_total ?? 0, ccy)}</div>
        </div>
        <div className="mpo-card mpo-card--blue">
          <div className="mpo-card-label">قيد التحويل</div>
          <div className="mpo-card-value">{fmtMoney(summary?.in_process_total ?? 0, ccy)}</div>
        </div>
        <div className="mpo-card mpo-card--amber">
          <div className="mpo-card-label">قيد الانتظار</div>
          <div className="mpo-card-value">{fmtMoney(summary?.pending_total ?? 0, ccy)}</div>
        </div>
      </div>

      {/* Payout lines */}
      {payouts.length === 0 ? (
        <div className="md-page-empty">لا توجد أرباح بعد. ستظهر هنا بعد إتمام أول عملية بيع.</div>
      ) : (
        <div className="mpo-table-wrap">
          <table className="mpo-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>المبلغ</th>
                <th>الحالة</th>
                <th>تاريخ الاستحقاق / الدفع</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(p => {
                const meta = STATUS_META[p.status] ?? { label: p.status, cls: 'mpo-st--grey' };
                const dateLabel = p.status === 'paid'
                  ? `دُفع: ${fmtDate(p.paid_at)}`
                  : p.settle_eligible_at
                    ? `مستحق: ${fmtDate(p.settle_eligible_at)}`
                    : '—';
                return (
                  <tr key={p.id}>
                    <td className="mpo-order">#{p.order_id}</td>
                    <td className="mpo-amount">{fmtMoney(p.amount, p.currency || ccy)}</td>
                    <td>
                      <span className={`mpo-st ${meta.cls}`}>{meta.label}</span>
                      {p.failure_reason && p.status === 'failed' && (
                        <span className="mpo-fail-reason" title={p.failure_reason}>⚠</span>
                      )}
                    </td>
                    <td className="mpo-date">{dateLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
