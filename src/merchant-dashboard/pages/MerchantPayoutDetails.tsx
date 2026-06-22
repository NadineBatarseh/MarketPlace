import { useState, useEffect, useCallback } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
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
      if (!token) { setLoadError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/payments/payout-onboarding/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? 'تعذّر تحميل بيانات الدفع.'); }
      else { setInfo(json as PayoutStatus); }
    } catch {
      setLoadError('تعذّر الاتصال بالخادم.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Light client-side IBAN sanity check — the server runs the authoritative mod-97 check.
  const ibanLooksValid = (() => {
    const v = iban.replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v);
  })();

  const handleSubmit = async () => {
    setFormError('');
    setSuccess(null);
    if (!holder.trim()) { setFormError('يرجى إدخال اسم صاحب الحساب.'); return; }
    if (!ibanLooksValid) { setFormError('رقم الآيبان (IBAN) غير صالح.'); return; }

    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) { setFormError('انتهت الجلسة — يرجى تسجيل الدخول من جديد.'); setSubmitting(false); return; }
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
        setFormError(json.error ?? 'رقم الآيبان (IBAN) غير صالح.');
      } else if (res.status === 409) {
        setFormError('يوجد حساب دفع مفعّل بالفعل لهذا المتجر. للتغيير، تواصل مع الدعم.');
      } else {
        setFormError(json.error ?? 'تعذّر تسجيل بيانات الدفع. حاول مرة أخرى.');
      }
    } catch {
      setFormError('تعذّر الاتصال بالخادم.');
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="mpd-root"><div className="md-page-loading">جاري تحميل بيانات الدفع...</div></div>;
  }
  if (!merchant?.shop) {
    return <div className="mpd-root"><div className="md-page-empty">لا يوجد متجر مرتبط بحسابك.</div></div>;
  }
  if (loadError) {
    return <div className="mpd-root"><div className="md-page-error">{loadError}</div></div>;
  }

  const isActive = info?.status === 'active' && info.has_beneficiary;

  return (
    <div className="mpd-root">
      <h1 className="mpd-title">بيانات الدفع</h1>
      <p className="mpd-subtitle">
        أضف رقم حسابك البنكي (IBAN) لاستلام أرباحك من مبيعات متجرك. تُحوَّل الأرباح بعد تسليم الطلبات وانتهاء فترة الإرجاع.
      </p>

      {isActive ? (
        /* ── Active: read-only confirmation ── */
        <div className="mpd-card mpd-active-card">
          <div className="mpd-badge mpd-badge--active">مفعّل</div>
          <div className="mpd-active-row">
            <span className="mpd-active-label">اسم صاحب الحساب</span>
            <span className="mpd-active-value">{info?.beneficiary_name ?? '—'}</span>
          </div>
          <div className="mpd-active-row">
            <span className="mpd-active-label">رقم الآيبان</span>
            <span className="mpd-active-value mpd-iban">•••• •••• {info?.iban_last4 ?? '••••'}</span>
          </div>
          <p className="mpd-note">
            بياناتك البنكية محفوظة بأمان لدى مزوّد الدفع. لتغيير الحساب البنكي، يرجى التواصل مع الدعم.
          </p>
        </div>
      ) : (
        /* ── Not onboarded: the form ── */
        <div className="mpd-card">
          {info?.status === 'rejected' && info.error && (
            <div className="md-page-error md-page-error--spaced">
              فشل التسجيل السابق: {info.error}
            </div>
          )}

          <div className="mpd-field">
            <label>اسم صاحب الحساب <span className="mpd-req">*</span></label>
            <input
              type="text"
              value={holder}
              onChange={e => setHolder(e.target.value)}
              placeholder="كما يظهر في الحساب البنكي"
            />
          </div>

          <div className="mpd-field">
            <label>رقم الآيبان (IBAN) <span className="mpd-req">*</span></label>
            <input
              type="text"
              value={iban}
              onChange={e => setIban(e.target.value)}
              placeholder="PS00 0000 0000 0000 0000 0000 000"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="mpd-hint">يُرسَل بأمان إلى مزوّد الدفع ولا يُخزَّن لدينا.</span>
          </div>

          <div className="mpd-field">
            <label>اسم البنك <span className="mpd-optional">(اختياري)</span></label>
            <input
              type="text"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              placeholder="مثال: بنك فلسطين"
            />
          </div>

          {formError && <div className="md-page-error md-page-error--spaced">{formError}</div>}
          {success && (
            <div className="mpd-success">
              تم تسجيل بيانات الدفع بنجاح — ينتهي حسابك بـ •••• {success}
            </div>
          )}

          <button
            type="button"
            className="mpd-save-btn"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'جارٍ الحفظ...' : 'حفظ بيانات الدفع'}
          </button>
        </div>
      )}
    </div>
  );
}
