import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import zxcvbn from 'zxcvbn';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useRecaptcha } from '../../hooks/useRecaptcha';
import PasswordStrengthBar from './PasswordStrengthBar';
import './Auth.css';

export default function CustomerSignup() {
  const { signup, signInWithGoogle } = useCustomerAuth();
  const { getToken } = useRecaptcha();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [nameHint, setNameHint] = useState('');
  const nameHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (zxcvbn(password).score < 2) {
      setError('كلمة المرور ضعيفة جداً — اختر كلمة مرور أصعب');
      return;
    }

    setLoading(true);

    try {
      const token = await getToken('signup');
      const captchaRes = await fetch('/api/auth/verify-recaptcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recaptchaToken: token, recaptchaAction: 'signup' }),
      });
      const captchaData = await captchaRes.json();
      if (!captchaData.ok) {
        setError(captchaData.error ?? 'فشل التحقق من أنك لست روبوتًا، يرجى المحاولة مرة أخرى');
        setLoading(false);
        return;
      }
    } catch {
      setError('فشل التحقق من أنك لست روبوتًا، يرجى المحاولة مرة أخرى');
      setLoading(false);
      return;
    }

    const result = await signup(email, password, name);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'حدث خطأ غير متوقع');
      return;
    }

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">📧</div>
          <h2 className="auth-title">تحقق من بريدك الإلكتروني</h2>
          <p className="auth-success-msg">
            أرسلنا رسالة تأكيد إلى <strong>{email}</strong>.<br /><br />
            افتح الرسالة واضغط على رابط التأكيد لتفعيل حسابك، ثم سجّل الدخول.
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">إنشاء حساب عميل</h1>
        <p className="auth-sub">انضم إلى سوق لينك وابدأ التسوق</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>الاسم الكامل <span className="auth-required-star">*</span></label>
            <input
              type="text"
              placeholder="أدخل اسمك الكامل"
              value={name}
              onChange={e => {
                const raw = e.target.value;
                if (/[0-9]/.test(raw)) {
                  setNameHint('لا يُسمح بالأرقام في هذا الحقل');
                  if (nameHintTimer.current) clearTimeout(nameHintTimer.current);
                  nameHintTimer.current = setTimeout(() => setNameHint(''), 2000);
                }
                setName(raw.replace(/[0-9]/g, ''));
              }}
              required
            />
            {nameHint && <p className="auth-phone-hint">{nameHint}</p>}
          </div>
          <div className="auth-field">
            <label>البريد الإلكتروني <span className="auth-required-star">*</span></label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label>كلمة المرور <span className="auth-required-star">*</span></label>
            <div className="auth-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="6 أحرف على الأقل"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="button" className="auth-eye" onClick={() => setShowPassword(v => !v)} aria-label="toggle password">
                {showPassword ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
              </button>
            </div>
            <PasswordStrengthBar password={password} />
          </div>
          <div className="auth-field">
            <label>تأكيد كلمة المرور <span className="auth-required-star">*</span></label>
            <div className="auth-input-wrap">
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder="أعد كتابة كلمة المرور"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="button" className="auth-eye" onClick={() => setShowConfirm(v => !v)} aria-label="toggle confirm password">
                {showConfirm ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'جارٍ إنشاء الحساب...' : 'إنشاء الحساب'}
          </button>

          <div className="auth-divider"><span>أو</span></div>

          <button type="button" className="auth-google-btn" onClick={signInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            إنشاء حساب بـ Google
          </button>
        </form>

        <p className="auth-switch">
          لديك حساب بالفعل؟{' '}
          <Link to="/login">تسجيل الدخول</Link>
        </p>
        <p className="auth-recaptcha-note">
          هذا الموقع محمي بواسطة reCAPTCHA وتسري عليه{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a>
          {' '}و{' '}
          <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">شروط الخدمة</a>
          {' '}الخاصة بـ Google.
        </p>
      </div>
    </div>
  );
}
