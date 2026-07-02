import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import { type PayoutStatus, payoutMeta, fmtMoney, fmtDate } from '../lib/payoutDisplay';
import './MerchantPayouts.css';

const API_BASE = 'http://localhost:4000';

interface PayoutRow {
  id: string;
  order_id: number;
  amount: number;
  currency: string;
  status: PayoutStatus;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

interface Summary {
  distributed_total: number;
  held_total: number;
  currency: string;
}

interface PayoutsResponse {
  ok: boolean;
  summary: Summary;
  onboarding_status: string;
  payouts: PayoutRow[];
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function MerchantPayouts() {
  const { t } = useTranslation('merchant');
  const { lang, direction } = useLanguage();
  const { merchant } = useMerchantAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<PayoutsResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError(t('payouts.sessionExpired')); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payout-onboarding/payouts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? t('payouts.loadFailed'));
      else setData(json as PayoutsResponse);
    } catch {
      setError(t('payouts.connectionFailed'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    if (!merchant?.shop?.shop_id) { setLoading(false); return; }
    load();
  }, [merchant?.shop?.shop_id, load]);

  if (loading) {
    return <div className="mpo-root" dir={direction}><div className="md-page-loading">{t('payouts.loading')}</div></div>;
  }
  if (!merchant?.shop) {
    return <div className="mpo-root" dir={direction}><div className="md-page-empty">{t('payouts.noShop')}</div></div>;
  }

  const summary = data?.summary;
  const ccy = summary?.currency ?? 'ILS';
  const payouts = data?.payouts ?? [];
  const notOnboarded = data?.onboarding_status !== 'active';

  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';

  return (
    <div className="mpo-root" dir={direction}>
      <h1 className="mpo-title">{t('payouts.title')}</h1>
      <p className="mpo-subtitle">{t('payouts.subtitle')}</p>

      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      {notOnboarded && (
        <div className="mpo-banner">
          {t('payouts.onboardingPrefix')} <strong>{t('payouts.payoutDetailsLink')}</strong> {t('payouts.onboardingSuffix')}
        </div>
      )}

      {/* Summary cards */}
      <div className="mpo-cards">
        <div className="mpo-card mpo-card--green">
          <div className="mpo-card-label">{t('payouts.cardDistributed')}</div>
          <div className="mpo-card-value">{fmtMoney(summary?.distributed_total ?? 0, ccy)}</div>
        </div>
        <div className="mpo-card mpo-card--amber">
          <div className="mpo-card-label">{t('payouts.cardHeld')}</div>
          <div className="mpo-card-value">{fmtMoney(summary?.held_total ?? 0, ccy)}</div>
        </div>
      </div>

      {/* Payout lines */}
      {payouts.length === 0 ? (
        <div className="md-page-empty">{t('payouts.empty')}</div>
      ) : (
        <div className="mpo-table-wrap">
          <table className="mpo-table">
            <thead>
              <tr>
                <th>{t('payouts.colOrderNumber')}</th>
                <th>{t('payouts.colAmount')}</th>
                <th>{t('payouts.colStatus')}</th>
                <th>{t('payouts.colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(p => {
                const meta = payoutMeta(p.status, t);
                const dateLabel = fmtDate(p.paid_at ?? p.created_at, numLocale);
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
