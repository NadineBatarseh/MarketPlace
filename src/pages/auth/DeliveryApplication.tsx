import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { validateIsraeliId } from '../../utils/validateIsraeliId';
import { useFieldHint } from './useFieldHint';
import './Auth.css';

const VEHICLE_OPTIONS = [
  { value: 'motorcycle', label: 'دراجة نارية' },
  { value: 'car', label: 'سيارة' },
  { value: 'van', label: 'فان' },
  { value: 'bicycle', label: 'دراجة هوائية' },
];

export default function DeliveryApplication() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    nationalId: '',
    vehicleType: '',
  });
  const [phoneCode, setPhoneCode] = useState('970');
  const [phoneLocal, setPhoneLocal] = useState('');
  const phoneHint = useFieldHint();
  const nameHint = useFieldHint();
  const idHint = useFieldHint();
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const vehicleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!vehicleOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (vehicleRef.current && !vehicleRef.current.contains(e.target as Node)) {
        setVehicleOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [vehicleOpen]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.fullName.trim().length < 2) {
      setError('يرجى إدخال الاسم الكامل');
      return;
    }

    const idCheck = validateIsraeliId(form.nationalId);
    if (!idCheck.valid) {
      setError(idCheck.reason);
      return;
    }

    if (phoneLocal.trim().length !== 8) {
      setError('رقم الهاتف غير صحيح — أدخل 8 أرقام بعد 05');
      return;
    }

    if (!form.vehicleType) {
      setError('يرجى اختيار نوع المركبة');
      return;
    }

    setLoading(true);

    const { data, error: dbError } = await supabase
      .from('delivery_applications')
      .insert({
        name: form.fullName,
        email: form.email,
        phone_number: phoneCode + '5' + phoneLocal.trim(),
        ID_number: form.nationalId,
        type_of_vehicle: form.vehicleType,
        status: 'pending',
      })
      .select('id')
      .single();

    setLoading(false);

    if (dbError) {
      setError('حدث خطأ أثناء إرسال الطلب: ' + dbError.message);
      return;
    }

    if (data?.id) setSubmissionId(String(data.id).slice(0, 8).toUpperCase());
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">✅</div>
          <h2 className="auth-title">تم إرسال طلبك بنجاح!</h2>
          <p className="auth-success-msg">
            شكراً لك <strong>{form.fullName}</strong>، تم استلام طلب انضمامك كمندوب توصيل.
            <br /><br />
            سيقوم فريقنا بمراجعة طلبك والتواصل معك عبر البريد الإلكتروني{' '}
            <strong>{form.email}</strong> خلال 1–3 أيام عمل.
            {submissionId && (
              <>
                <br /><br />
                رقم طلبك المرجعي: <strong dir="ltr">#{submissionId}</strong>
              </>
            )}
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card auth-wide-card">
        <div className="auth-logo">🚚</div>
        <h1 className="auth-title">طلب الانضمام كمندوب توصيل</h1>
        <p className="auth-sub">أكمل النموذج وسيتم مراجعة طلبك من قِبل الإدارة</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-row">
            <div className="auth-field">
              <label>الاسم الكامل <span className="auth-required-star">*</span></label>
              <input
                placeholder="الاسم الكامل"
                value={form.fullName}
                minLength={2}
                onChange={e => {
                  const raw = e.target.value;
                  if (/[0-9]/.test(raw)) nameHint.show('لا يُسمح بالأرقام في هذا الحقل');
                  setForm(f => ({ ...f, fullName: raw.replace(/[0-9]/g, '') }));
                }}
                required
              />
              {nameHint.hint && <p className="auth-phone-hint">{nameHint.hint}</p>}
            </div>
            <div className="auth-field">
              <label>رقم الهوية الوطنية <span className="auth-required-star">*</span></label>
              <input
                placeholder="xxxxxxxxx"
                value={form.nationalId}
                inputMode="numeric"
                onChange={e => {
                  const raw = e.target.value;
                  const digits = raw.replace(/\D/g, '');
                  if (/\D/.test(raw)) idHint.show('أرقام فقط');
                  else if (digits.length > 9) idHint.show('الحد الأقصى 9 أرقام');
                  else idHint.clear();
                  setForm(f => ({ ...f, nationalId: digits.slice(0, 9) }));
                }}
                required
              />
              {idHint.hint && <p className="auth-phone-hint">{idHint.hint}</p>}
            </div>
          </div>

          <div className="auth-field">
            <label>البريد الإلكتروني <span className="auth-required-star">*</span></label>
            <input type="email" placeholder="example@email.com" value={form.email} onChange={set('email')} required />
          </div>

          <div className="auth-field">
            <label>رقم الهاتف <span className="auth-required-star">*</span></label>
            <div className="auth-phone-split" dir="ltr">
              <select
                title="رمز الدولة"
                value={phoneCode}
                onChange={e => setPhoneCode(e.target.value)}
                className="auth-phone-code"
              >
                <option value="970">+970</option>
                <option value="972">+972</option>
              </select>
              <span className="auth-phone-prefix">05</span>
              <input
                type="text"
                value={phoneLocal}
                inputMode="numeric"
                onChange={e => {
                  const raw = e.target.value;
                  const digits = raw.replace(/\D/g, '');
                  if (/[^\d]/.test(raw)) phoneHint.show('أرقام فقط');
                  else if (digits.length > 8) phoneHint.show('الحد الأقصى 8 أرقام');
                  else phoneHint.clear();
                  setPhoneLocal(digits.slice(0, 8));
                }}
                placeholder="XXXXXXXX"
                className="auth-phone-local"
                dir="ltr"
                required
              />
            </div>
            {phoneHint.hint && <p className="auth-phone-hint">{phoneHint.hint}</p>}
          </div>

          <div className="auth-field">
            <label>نوع المركبة <span className="auth-required-star">*</span></label>
            <div className="auth-custom-select" ref={vehicleRef}>
              <button
                type="button"
                className={`auth-custom-select-trigger${!form.vehicleType ? ' auth-custom-select-placeholder' : ''}`}
                onClick={() => setVehicleOpen(o => !o)}
              >
                {VEHICLE_OPTIONS.find(v => v.value === form.vehicleType)?.label || 'اختر النوع'}
                <span className="auth-custom-select-arrow">{vehicleOpen ? '▲' : '▼'}</span>
              </button>
              {vehicleOpen && (
                <ul className="auth-custom-select-list">
                  {VEHICLE_OPTIONS.map(opt => (
                    <li
                      key={opt.value}
                      className={`auth-custom-select-option${form.vehicleType === opt.value ? ' selected' : ''}`}
                      onMouseDown={() => {
                        setForm(f => ({ ...f, vehicleType: opt.value }));
                        setVehicleOpen(false);
                      }}
                    >
                      {opt.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'جارٍ إرسال الطلب...' : 'إرسال الطلب'}
          </button>
        </form>

        <p className="auth-switch">
          لديك حساب بالفعل؟{' '}
          <Link to="/login">تسجيل الدخول</Link>
        </p>
      </div>
    </div>
  );
}
