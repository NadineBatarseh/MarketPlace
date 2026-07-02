import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import PasswordStrengthBar from './PasswordStrengthBar';
import './Auth.css';

type Status = 'loading' | 'ready' | 'invalid' | 'success';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
  const [status, setStatus] = useState<Status>('loading');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStatus('ready');
      }
    });

    const timer = setTimeout(() => {
      setStatus(s => s === 'loading' ? 'invalid' : s);
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError(t('errors.tooShort')); return; }
    if (newPassword !== confirmPassword) { setError(t('errors.mismatch')); return; }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) {
      if (updateError.status === 422 || updateError.message?.includes('invalid')) {
        setError(t('resetPassword.errors.expiredLink'));
      } else {
        setError(t('resetPassword.errors.failed'));
      }
      return;
    }
    setStatus('success');
  };

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card--centered">
          <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
          <h1 className="auth-title">{t('resetPassword.verifyingTitle')}</h1>
        </div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="auth-page">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">⚠️</div>
          <h1 className="auth-title">{t('resetPassword.invalid.title')}</h1>
          <p className="auth-success-msg">
            {t('resetPassword.invalid.message')}
            <br />
            {t('resetPassword.invalid.hint')}
          </p>
          <Link to="/forgot-password" className="auth-submit auth-submit--link">
            {t('resetPassword.invalid.requestNew')}
          </Link>
          <p className="auth-switch">
            <Link to="/login">{t('shared.backToLogin')}</Link>
          </p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="auth-page">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">✅</div>
          <h1 className="auth-title">{t('resetPassword.success.title')}</h1>
          <p className="auth-success-msg">
            {t('resetPassword.success.message')}
            <br />
            {t('resetPassword.success.hint')}
          </p>
          <button type="button" className="auth-submit" onClick={() => navigate('/login')}>
            {t('resetPassword.success.login')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">{t('resetPassword.title')}</h1>
        <p className="auth-sub">{t('resetPassword.subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('resetPassword.newPasswordLabel')}</label>
            <div className="auth-input-wrap">
              <input
                type={showNew ? 'text' : 'password'}
                placeholder={t('shared.passwordPlaceholder')}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                disabled={loading}
              />
              <button type="button" className="auth-eye" onClick={() => setShowNew(v => !v)} aria-label="toggle password">
                <EyeIcon open={showNew} />
              </button>
            </div>
            <PasswordStrengthBar password={newPassword} />
          </div>

          <div className="auth-field">
            <label>{t('shared.confirmPasswordLabel')}</label>
            <div className="auth-input-wrap">
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder={t('shared.confirmPlaceholder')}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
              />
              <button type="button" className="auth-eye" onClick={() => setShowConfirm(v => !v)} aria-label="toggle password">
                <EyeIcon open={showConfirm} />
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? t('resetPassword.saving') : t('resetPassword.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
