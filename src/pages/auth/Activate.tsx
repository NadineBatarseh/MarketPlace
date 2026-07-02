import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import zxcvbn from 'zxcvbn';

import PasswordStrengthBar from './PasswordStrengthBar';
import './Auth.css';

export default function Activate() {
  const { t } = useTranslation('auth');
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

    const res = await fetch('http://localhost:4000/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformEmail: platformEmail.trim(), password }),
    });

    const result = await res.json();
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? t('errors.unexpected'));
      return;
    }

    setSuccess(true);
  };

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">🎉</div>
          <h2 className="auth-title">{t('activate.success.title')}</h2>
          <p className="auth-success-msg">
            {t('activate.success.messagePre')}<br /><br />
            {t('activate.success.messagePost')}
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {t('activate.success.login')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">{t('activate.title')}</h1>
        <p className="auth-sub">{t('activate.subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('activate.officialEmailLabel')}</label>
            <input
              type="email"
              placeholder={t('activate.officialEmailPlaceholder')}
              value={platformEmail}
              onChange={e => setPlatformEmail(e.target.value)}
              required
              autoComplete="email"
              dir="ltr"
            />
          </div>
          <div className="auth-field">
            <label>{t('shared.passwordLabel')}</label>
            <input
              type="password"
              placeholder={t('shared.passwordPlaceholder')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <PasswordStrengthBar password={password} />
          </div>
          <div className="auth-field">
            <label>{t('shared.confirmPasswordLabel')}</label>
            <input
              type="password"
              placeholder={t('shared.confirmPlaceholder2')}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? t('activate.loading') : t('activate.submit')}
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
