import { useState } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { validateIsraeliId } from '../../utils/validateIsraeliId';
import './Auth.css';

export default function HubWorkerApplication() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    nationalId: '',
    placeOfResidence: '',
  });
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const idCheck = validateIsraeliId(form.nationalId);
    if (!idCheck.valid) {
      setError(idCheck.reason);
      return;
    }
    if (!/^(05\d{8}|\+9725\d{8})$/.test(form.phone.trim())) {
      setError('رقم الهاتف غير صحيح — يجب أن يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0547479568)');
      return;
    }

    setLoading(true);

    const { error: dbError } = await supabase.from('hubworker_applications').insert({
      name: form.fullName,
      email: form.email,
      phone_number: form.phone,
      ID_number: form.nationalId,
      place_of_residence: form.placeOfResidence,
      status: 'pending',
    });

    setLoading(false);

    if (dbError) {
      setError('حدث خطأ أثناء إرسال الطلب: ' + dbError.message);
      return;
    }

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">✅</div>
          <h2 className="auth-title">تم إرسال طلبك بنجاح!</h2>
          <p className="auth-success-msg">
            شكراً لك <strong>{form.fullName}</strong>، تم استلام طلب انضمامك كعامل مستودع.
            <br /><br />
            سيقوم فريقنا بمراجعة طلبك والتواصل معك عبر البريد الإلكتروني{' '}
            <strong>{form.email}</strong> خلال 1–3 أيام عمل.
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
      <div className="auth-card">
        <div className="auth-logo">📦</div>
        <h1 className="auth-title">طلب الانضمام كعامل مستودع</h1>
        <p className="auth-sub">أكمل النموذج وسيتم مراجعة طلبك من قِبل الإدارة</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-row">
            <div className="auth-field">
              <label>الاسم الكامل</label>
              <input placeholder="الاسم الكامل" value={form.fullName} onChange={set('fullName')} required />
            </div>
            <div className="auth-field">
              <label>رقم الهوية الوطنية</label>
              <input placeholder="xxxxxxxxx" value={form.nationalId} onChange={set('nationalId')} required maxLength={9} />
            </div>
          </div>

          <div className="auth-field">
            <label>البريد الإلكتروني</label>
            <input type="email" placeholder="example@email.com" value={form.email} onChange={set('email')} required />
          </div>

          <div className="auth-field">
            <label>رقم الهاتف</label>
            <input type="tel" placeholder="05xxxxxxxx" value={form.phone} onChange={set('phone')} required />
          </div>

          <div className="auth-field">
            <label>مكان الإقامة</label>
            <input placeholder="المدينة / الحي" value={form.placeOfResidence} onChange={set('placeOfResidence')} required />
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
