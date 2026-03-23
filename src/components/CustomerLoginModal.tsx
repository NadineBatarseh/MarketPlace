import { useState, useEffect, useRef } from 'react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import './CustomerLoginModal.css';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type Tab = 'login' | 'signup';

export default function CustomerLoginModal({ onClose, onSuccess }: Props) {
  const { login, signup, isLoading } = useCustomerAuth();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
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
    if (tab === 'signup' && !name.trim()) {
      setError('يرجى إدخال اسمك');
      return;
    }

    const result =
      tab === 'login'
        ? await login(email.trim(), password.trim())
        : await signup(email.trim(), password.trim(), name.trim());

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? 'حدث خطأ غير متوقع');
    }
  };

  return (
    <div
      className="clm-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="clm-modal">
        <button className="clm-close" onClick={onClose} aria-label="إغلاق">✕</button>

        <div className="clm-header">
          <span className="clm-icon">🛒</span>
          <h2>حساب العميل</h2>
          <p>تسجيل الدخول أو إنشاء حساب جديد للتسوق</p>
        </div>

        {/* Tabs */}
        <div className="clm-tabs">
          <button
            type="button"
            className={`clm-tab${tab === 'login' ? ' clm-tab--active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            className={`clm-tab${tab === 'signup' ? ' clm-tab--active' : ''}`}
            onClick={() => { setTab('signup'); setError(''); }}
          >
            إنشاء حساب
          </button>
        </div>

        <form className="clm-form" onSubmit={handleSubmit}>
          {tab === 'signup' && (
            <div className="clm-field">
              <label htmlFor="clm-name">الاسم</label>
              <input
                id="clm-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="أدخل اسمك"
                disabled={isLoading}
                autoComplete="name"
              />
            </div>
          )}

          <div className="clm-field">
            <label htmlFor="clm-email">البريد الإلكتروني</label>
            <input
              id="clm-email"
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

          <div className="clm-field">
            <label htmlFor="clm-password">كلمة المرور</label>
            <input
              id="clm-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="أدخل كلمة المرور"
              disabled={isLoading}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="clm-error" role="alert">{error}</div>}

          <button type="submit" className="clm-submit" disabled={isLoading}>
            {isLoading
              ? 'جاري التحميل...'
              : tab === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}
          </button>
        </form>
      </div>
    </div>
  );
}
