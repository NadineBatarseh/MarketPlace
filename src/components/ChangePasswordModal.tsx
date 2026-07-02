import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../lib/supabase';
import './ChangePasswordModal.css';

type Step = 'verify' | 'change' | 'success';

function getStrengthLevel(pwd: string): 0 | 1 | 2 | 3 | 4 {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return (score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4) as 1 | 2 | 3 | 4;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  const [step, setStep] = useState<Step>('verify');
  const [email, setEmail] = useState('');
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const strengthLevel = getStrengthLevel(newPassword);
  const strengthLabels = ['', t('changePassword.strength.veryWeak'), t('changePassword.strength.weak'), t('changePassword.strength.medium'), t('changePassword.strength.strong')];
  const strengthLabel = strengthLabels[strengthLevel];

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setEmail(data.user.email ?? '');
        setIsGoogleUser(data.user.app_metadata?.provider === 'google');
      }
    });
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!currentPassword) { setError(t('changePassword.errors.enterCurrent')); return; }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    setLoading(false);
    if (authError) { setError(t('changePassword.errors.wrongCurrent')); return; }
    setStep('change');
  };

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError(t('changePassword.errors.tooShort')); return; }
    if (newPassword !== confirmPassword) { setError(t('changePassword.errors.mismatch')); return; }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) { setError(t('changePassword.errors.failed')); return; }
    setStep('success');
  };

  return (
    <div
      className="cpm-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="cpm-modal">
        <button className="cpm-close" onClick={onClose} aria-label={t('actions.close')}>✕</button>

        {isGoogleUser ? (
          <div className="cpm-centered">
            <span className="cpm-icon">🔒</span>
            <h2>{t('changePassword.title')}</h2>
            <p>{t('changePassword.googleUserMessage')}</p>
            <button className="cpm-submit" onClick={onClose}>{t('actions.ok')}</button>
          </div>
        ) : step === 'verify' ? (
          <>
            <div className="cpm-header">
              <span className="cpm-icon">🔑</span>
              <h2>{t('changePassword.title')}</h2>
              <p>{t('changePassword.verify.subtitle')}</p>
            </div>
            <form className="cpm-form" onSubmit={handleVerify}>
              <div className="cpm-field">
                <label>{t('changePassword.verify.currentLabel')}</label>
                <div className="cpm-input-wrap">
                  <input
                    type={showCurrentPwd ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder={t('changePassword.verify.currentPlaceholder')}
                    autoFocus
                    disabled={loading}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="cpm-eye"
                    onClick={() => setShowCurrentPwd(v => !v)}
                    tabIndex={-1}
                    aria-label={showCurrentPwd ? t('changePassword.hidePassword') : t('changePassword.showPassword')}
                  >
                    <EyeIcon open={showCurrentPwd} />
                  </button>
                </div>
              </div>
              {error && <div className="cpm-error" role="alert">{error}</div>}
              <button type="submit" className="cpm-submit" disabled={loading}>
                {loading ? t('changePassword.verify.verifying') : t('changePassword.verify.submit')}
              </button>
            </form>
          </>
        ) : step === 'change' ? (
          <>
            <div className="cpm-header">
              <span className="cpm-icon">🔒</span>
              <h2>{t('changePassword.change.title')}</h2>
              <p>{t('changePassword.change.subtitle')}</p>
            </div>
            <form className="cpm-form" onSubmit={handleChange}>
              <div className="cpm-field">
                <label>{t('changePassword.change.newLabel')}</label>
                <div className="cpm-input-wrap">
                  <input
                    type={showNewPwd ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder={t('changePassword.change.newPlaceholder')}
                    autoFocus
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="cpm-eye"
                    onClick={() => setShowNewPwd(v => !v)}
                    tabIndex={-1}
                    aria-label={showNewPwd ? t('changePassword.hidePassword') : t('changePassword.showPassword')}
                  >
                    <EyeIcon open={showNewPwd} />
                  </button>
                </div>
                {newPassword && (
                  <div className="cpm-strength" data-level={strengthLevel}>
                    <div className="cpm-strength-bars">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="cpm-strength-bar" />
                      ))}
                    </div>
                    <span className="cpm-strength-label">{strengthLabel}</span>
                  </div>
                )}
              </div>
              <div className="cpm-field">
                <label>{t('changePassword.change.confirmLabel')}</label>
                <div className="cpm-input-wrap">
                  <input
                    type={showConfirmPwd ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={t('changePassword.change.confirmPlaceholder')}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="cpm-eye"
                    onClick={() => setShowConfirmPwd(v => !v)}
                    tabIndex={-1}
                    aria-label={showConfirmPwd ? t('changePassword.hidePassword') : t('changePassword.showPassword')}
                  >
                    <EyeIcon open={showConfirmPwd} />
                  </button>
                </div>
              </div>
              {error && <div className="cpm-error" role="alert">{error}</div>}
              <button type="submit" className="cpm-submit" disabled={loading}>
                {loading ? t('changePassword.change.saving') : t('changePassword.change.submit')}
              </button>
            </form>
          </>
        ) : (
          <div className="cpm-centered">
            <span className="cpm-icon">✅</span>
            <h2>{t('changePassword.success.title')}</h2>
            <p>{t('changePassword.success.message')}</p>
            <button className="cpm-submit" onClick={onClose}>{t('actions.close')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
