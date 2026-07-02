import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import zxcvbn from 'zxcvbn';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PasswordStrengthBar from './PasswordStrengthBar';
import './Auth.css';

export default function CustomerSignup() {
  const { signup, signInWithGoogle } = useCustomerAuth();
  const { t } = useTranslation('auth');

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
      setError(t('errors.mismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('errors.tooShort'));
      return;
    }
    if (zxcvbn(password).score < 2) {
      setError(t('errors.tooWeak'));
      return;
    }

    setLoading(true);
    const result = await signup(email, password, name);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? t('errors.unexpected'));
      return;
    }

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">📧</div>
          <h2 className="auth-title">{t('signup.success.title')}</h2>
          <p className="auth-success-msg">
            {t('signup.success.messagePre')} <strong>{email}</strong>.<br /><br />
            {t('signup.success.messagePost')}
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {t('signup.success.login')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">{t('signup.title')}</h1>
        <p className="auth-sub">{t('signup.subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('signup.nameLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <input
              type="text"
              placeholder={t('signup.namePlaceholder')}
              value={name}
              onChange={e => {
                const raw = e.target.value;
                if (/[0-9]/.test(raw)) {
                  setNameHint(t('shared.noDigitsHint'));
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
            <label>{t('shared.emailLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              dir="ltr"
            />
          </div>
          <div className="auth-field">
            <label>{t('shared.passwordLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <div className="auth-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={t('shared.passwordPlaceholder')}
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
            <label>{t('shared.confirmPasswordLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <div className="auth-input-wrap">
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder={t('shared.confirmPlaceholder2')}
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
            {loading ? t('signup.loading') : t('signup.submit')}
          </button>

          <div className="auth-divider"><span>{t('shared.or')}</span></div>

          <button type="button" className="auth-google-btn" onClick={signInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {t('signup.withGoogle')}
          </button>
        </form>

        <p className="auth-switch">
          {t('shared.hasAccount')}{' '}
          <Link to="/login">{t('shared.backToLoginLink')}</Link>
        </p>
      </div>
    </div>
  );
}
