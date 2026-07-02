import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import './Auth.css';

type State = 'idle' | 'loading' | 'sent' | 'error';

export default function ForgotPassword() {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showSignupLink, setShowSignupLink] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setShowSignupLink(false);
    setState('loading');

    const trimmed = email.trim().toLowerCase();

    const { data: userRow } = await supabase
      .from('Users')
      .select('email, provider')
      .eq('email', trimmed)
      .maybeSingle();

    if (!userRow) {
      setErrorMsg(t('forgotPassword.errors.notRegistered'));
      setShowSignupLink(true);
      setState('error');
      return;
    }

    if (userRow.provider === 'google') {
      setErrorMsg(t('forgotPassword.errors.googleAccount'));
      setState('error');
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      const msg = error.message?.toLowerCase() ?? '';
      if (msg.includes('rate') || msg.includes('limit') || error.status === 429) {
        setErrorMsg(t('forgotPassword.errors.rateLimited'));
      } else if (msg.includes('email') && msg.includes('not')) {
        setErrorMsg(t('forgotPassword.errors.notInAuth'));
      } else {
        setErrorMsg(t('forgotPassword.errors.sendFailed'));
      }
      setState('error');
      return;
    }

    setState('sent');
  };

  if (state === 'sent') {
    return (
      <div className="auth-page">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">📩</div>
          <h1 className="auth-title">{t('forgotPassword.success.title')}</h1>
          <p className="auth-success-msg">
            {t('forgotPassword.success.messagePre')}
            <br />
            <strong>{email.trim()}</strong>
            <br /><br />
            {t('forgotPassword.success.messagePost')}
          </p>
          <Link to="/login" className="auth-submit auth-submit--link">
            {t('shared.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">{t('forgotPassword.title')}</h1>
        <p className="auth-sub">{t('forgotPassword.subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('shared.emailLabel')}</label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              disabled={state === 'loading'}
              dir="ltr"
            />
          </div>

          {state === 'error' && (
            <p className="auth-error">{errorMsg}</p>
          )}

          <button type="submit" className="auth-submit" disabled={state === 'loading'}>
            {state === 'loading' ? t('forgotPassword.verifying') : t('forgotPassword.submit')}
          </button>
        </form>

        <p className="auth-switch">
          {t('forgotPassword.rememberPassword')}{' '}
          <Link to="/login">{t('shared.backToLoginLink')}</Link>
        </p>
        {showSignupLink && (
          <p className="auth-switch auth-switch--spaced">
            <Link to="/signup">{t('forgotPassword.createNewAccount')}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
