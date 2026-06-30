import { useState, useEffect, useRef } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useRecaptcha } from '../../hooks/useRecaptcha';
import './MerchantLoginModal.css';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function MerchantLoginModal({ onClose, onSuccess }: Props) {
  const { login, isLoading } = useMerchantAuth();
  const { getToken } = useRecaptcha();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }

    try {
      const token = await getToken('merchant_login');
      const captchaRes = await fetch('/api/auth/verify-recaptcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recaptchaToken: token, recaptchaAction: 'merchant_login' }),
      });
      const captchaData = await captchaRes.json();
      if (!captchaData.ok) {
        setError(captchaData.error ?? 'فشل التحقق من أنك لست روبوتًا، يرجى المحاولة مرة أخرى');
        return;
      }
    } catch {
      setError('فشل التحقق من أنك لست روبوتًا، يرجى المحاولة مرة أخرى');
      return;
    }

    const result = await login(email.trim(), password.trim());
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? 'حدث خطأ غير متوقع');
    }
  };

  return (
    <div
      className="mlm-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="mlm-modal">
        <button className="mlm-close" onClick={onClose} aria-label="إغلاق">✕</button>

        <div className="mlm-header">
          <span className="mlm-icon">🏪</span>
          <h2>تسجيل دخول التاجر</h2>
          <p>أدخل بيانات حسابك للوصول إلى لوحة التحكم</p>
        </div>

        <form className="mlm-form" onSubmit={handleSubmit}>
          <div className="mlm-field">
            <label htmlFor="mlm-email">البريد الإلكتروني</label>
            <input
              id="mlm-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="example@mail.com"
              autoFocus
              disabled={isLoading}
              autoComplete="email"
              dir="ltr"
            />
          </div>

          <div className="mlm-field">
            <label htmlFor="mlm-password">كلمة المرور</label>
            <input
              id="mlm-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="أدخل كلمة المرور"
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          {error && <div className="mlm-error" role="alert">{error}</div>}

          <button type="submit" className="mlm-submit" disabled={isLoading}>
            {isLoading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>
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
