import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import './MerchantPayoutDetails.css';

const API_BASE = 'http://localhost:4000';

type OnboardingStatus = 'not_started' | 'pending' | 'active' | 'rejected' | 'disabled';

interface PayoutStatus {
  status: OnboardingStatus;
  has_beneficiary: boolean;
  beneficiary_name: string | null;
  iban_last4: string | null;
  onboarded_at: string | null;
  error: string | null;
}

/** Bearer token from the current Supabase session (null if expired). */
async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function MerchantPayoutDetails() {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const { merchant } = useMerchantAuth();

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<PayoutStatus | null>(null);
  const [loadError, setLoadError] = useState('');

  // form state
  const [holder, setHolder] = useState('');
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = await getToken();
      if (!token) { setLoadError(t('payoutDetails.sessionExpired')); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payout-onboarding/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? t('payoutDetails.loadFailed')); }
      else { setInfo(json as PayoutStatus); }
    } catch {
      setLoadError(t('payoutDetails.connectionFailed'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Light client-side IBAN sanity check — the server runs the authoritative mod-97 check.
  const ibanLooksValid = (() => {
    const v = iban.replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v);
  })();

  const handleSubmit = async () => {
    setFormError('');
    setSuccess(null);
    if (!holder.trim()) { setFormError(t('payoutDetails.holderRequired')); return; }
    if (!ibanLooksValid) { setFormError(t('payoutDetails.ibanInvalid')); return; }

    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) { setFormError(t('payoutDetails.sessionExpired')); setSubmitting(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payout-onboarding/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_holder_name: holder.trim(),
          iban: iban.replace(/\s+/g, '').toUpperCase(),
          bank_name: bankName.trim() || undefined,
        }),
      });
      const json = await res.json();

      if (res.ok) {
        setSuccess(json.iban_last4 ?? null);
        setIban(''); // never keep the IBAN around
        await loadStatus();
      } else if (res.status === 400) {
        setFormError(json.error ?? t('payoutDetails.ibanInvalid'));
      } else if (res.status === 409) {
        setFormError(t('payoutDetails.duplicateAccount'));
      } else {
        setFormError(json.error ?? t('payoutDetails.registerFailed'));
      }
    } catch {
      setFormError(t('payoutDetails.connectionFailed'));
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="mpd-root" dir={direction}><div className="md-page-loading">{t('payoutDetails.loading')}</div></div>;
  }
  if (!merchant?.shop) {
    return <div className="mpd-root" dir={direction}><div className="md-page-empty">{t('payoutDetails.noShop')}</div></div>;
  }
  if (loadError) {
    return <div className="mpd-root" dir={direction}><div className="md-page-error">{loadError}</div></div>;
  }

  const isActive = info?.status === 'active' && info.has_beneficiary;

  return (
    <div className="mpd-root" dir={direction}>
      <h1 className="mpd-title">{t('payoutDetails.title')}</h1>
      <p className="mpd-subtitle">{t('payoutDetails.subtitle')}</p>

      {isActive ? (
        /* ── Active: read-only confirmation ── */
        <div className="mpd-card mpd-active-card">
          <div className="mpd-badge mpd-badge--active">{t('payoutDetails.active')}</div>
          <div className="mpd-active-row">
            <span className="mpd-active-label">{t('payoutDetails.accountHolderLabel')}</span>
            <span className="mpd-active-value">{info?.beneficiary_name ?? '—'}</span>
          </div>
          <div className="mpd-active-row">
            <span className="mpd-active-label">{t('payoutDetails.ibanLabel')}</span>
            <span className="mpd-active-value mpd-iban">•••• •••• {info?.iban_last4 ?? '••••'}</span>
          </div>
          <p className="mpd-note">{t('payoutDetails.securityNote')}</p>
        </div>
      ) : (
        /* ── Not onboarded: the form ── */
        <div className="mpd-card">
          {info?.status === 'rejected' && info.error && (
            <div className="md-page-error md-page-error--spaced">
              {t('payoutDetails.previousRegistrationFailed')} {info.error}
            </div>
          )}

          <div className="mpd-field">
            <label>{t('payoutDetails.accountHolderLabel')} <span className="mpd-req">{t('payoutDetails.required')}</span></label>
            <input
              type="text"
              value={holder}
              onChange={e => setHolder(e.target.value)}
              placeholder={t('payoutDetails.accountHolderPlaceholder')}
            />
          </div>

          <div className="mpd-field">
            <label>{t('payoutDetails.ibanLabel')} (IBAN) <span className="mpd-req">{t('payoutDetails.required')}</span></label>
            <input
              type="text"
              value={iban}
              onChange={e => setIban(e.target.value)}
              placeholder="PS00 0000 0000 0000 0000 0000 000"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="mpd-hint">{t('payoutDetails.ibanHint')}</span>
          </div>

          <div className="mpd-field">
            <label>{t('payoutDetails.bankNameLabel')} <span className="mpd-optional">{t('payoutDetails.optional')}</span></label>
            <input
              type="text"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              placeholder={t('payoutDetails.bankNamePlaceholder')}
            />
          </div>

          {formError && <div className="md-page-error md-page-error--spaced">{formError}</div>}
          {success && (
            <div className="mpd-success">
              {t('payoutDetails.successMessage', { last4: success })}
            </div>
          )}

          <button
            type="button"
            className="mpd-save-btn"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? t('payoutDetails.saving') : t('payoutDetails.save')}
          </button>
        </div>
      )}
    </div>
  );
}
