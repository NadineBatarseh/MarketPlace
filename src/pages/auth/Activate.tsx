import { useState } from 'react';
import { Link } from 'react-router-dom';
import zxcvbn from 'zxcvbn';

import PasswordStrengthBar from './PasswordStrengthBar';
import './Auth.css';

export default function Activate() {
  const [platformEmail, setPlatformEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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

    const res = await fetch('http://localhost:4000/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformEmail: platformEmail.trim(), password }),
    });

    const result = await res.json();
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? 'حدث خطأ غير متوقع');
      return;
    }

    setSuccess(true);
  };

  if (success) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">🎉</div>
          <h2 className="auth-title">تم تفعيل حسابك بنجاح!</h2>
          <p className="auth-success-msg">
            أرسلنا رسالة تأكيد إلى بريدك الإلكتروني الرسمي.<br /><br />
            افتح الرسالة واضغط على رابط التأكيد، ثم سجّل الدخول باستخدام بريدك الرسمي وكلمة المرور التي أنشأتها.
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
        <h1 className="auth-title">تفعيل الحساب</h1>
        <p className="auth-sub">أدخل بريدك الإلكتروني الرسمي وأنشئ كلمة مرور لحسابك</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>البريد الإلكتروني الرسمي</label>
            <input
              type="email"
              placeholder="البريد الذي أرسلناه لك في رسالة القبول"
              value={platformEmail}
              onChange={e => setPlatformEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label>كلمة المرور</label>
            <input
              type="password"
              placeholder="6 أحرف على الأقل"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <PasswordStrengthBar password={password} />
          </div>
          <div className="auth-field">
            <label>تأكيد كلمة المرور</label>
            <input
              type="password"
              placeholder="أعد كتابة كلمة المرور"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'جارٍ تفعيل الحساب...' : 'تفعيل الحساب'}
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
