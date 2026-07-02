import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';

export default function MerchantSettings() {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const { merchant } = useMerchantAuth();

  const [displayName, setDisplayName] = useState(merchant?.displayName ?? '');
  const [nameStatus, setNameStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pwError, setPwError] = useState('');

  const handleSaveName = async () => {
    if (!displayName.trim()) return;
    setNameStatus('saving');
    const { error } = await supabase.auth.updateUser({
      data: { full_name: displayName.trim() },
    });
    setNameStatus(error ? 'error' : 'saved');
    setTimeout(() => setNameStatus('idle'), 3000);
  };

  const handleChangePassword = async () => {
    setPwError('');
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwError(t('settings.password.errors.allFields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError(t('settings.password.errors.mismatch'));
      return;
    }
    if (newPassword.length < 6) {
      setPwError(t('settings.password.errors.tooShort'));
      return;
    }
    setPwStatus('saving');
    // Re-authenticate with old password first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: merchant!.email,
      password: oldPassword,
    });
    if (signInError) {
      setPwError(t('settings.password.errors.wrongCurrent'));
      setPwStatus('error');
      setTimeout(() => setPwStatus('idle'), 3000);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPwError(error.message);
      setPwStatus('error');
    } else {
      setPwStatus('saved');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setTimeout(() => setPwStatus('idle'), 3000);
  };

  return (
    <div className="ms-root" dir={direction}>
      <h1 className="ms-title">{t('settings.title')}</h1>

      {/* Profile info card */}
      <section className="ms-card">
        <h2 className="ms-card-title">{t('settings.profile.title')}</h2>

        <div className="ms-field">
          <label className="ms-label">{t('settings.profile.emailLabel')}</label>
          <input
            type="email"
            className="ms-input ms-input-readonly"
            value={merchant?.email ?? ''}
            readOnly
            dir="ltr"
          />
          <span className="ms-hint">{t('settings.profile.emailHint')}</span>
        </div>

        <div className="ms-field">
          <label className="ms-label">{t('settings.profile.displayNameLabel')}</label>
          <input
            type="text"
            className="ms-input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={t('settings.profile.displayNamePlaceholder')}
          />
        </div>

        <button
          type="button"
          className={`ms-btn ms-btn-primary${nameStatus === 'saving' ? ' ms-btn-loading' : ''}`}
          onClick={handleSaveName}
          disabled={nameStatus === 'saving'}
        >
          {nameStatus === 'saving' ? t('settings.profile.saving') : nameStatus === 'saved' ? t('settings.profile.saved') : t('settings.profile.saveButton')}
        </button>
        {nameStatus === 'error' && <p className="ms-error">{t('settings.profile.saveError')}</p>}
      </section>

      {/* Change password card */}
      <section className="ms-card">
        <h2 className="ms-card-title">{t('settings.password.title')}</h2>

        <div className="ms-field">
          <label className="ms-label">{t('settings.password.currentLabel')}</label>
          <input
            type="password"
            className="ms-input"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <div className="ms-field">
          <label className="ms-label">{t('settings.password.newLabel')}</label>
          <input
            type="password"
            className="ms-input"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <div className="ms-field">
          <label className="ms-label">{t('settings.password.confirmLabel')}</label>
          <input
            type="password"
            className="ms-input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {pwError && <p className="ms-error">{pwError}</p>}

        <button
          type="button"
          className={`ms-btn ms-btn-primary${pwStatus === 'saving' ? ' ms-btn-loading' : ''}`}
          onClick={handleChangePassword}
          disabled={pwStatus === 'saving'}
        >
          {pwStatus === 'saving' ? t('settings.password.saving') : pwStatus === 'saved' ? t('settings.password.saved') : t('settings.password.saveButton')}
        </button>
      </section>
    </div>
  );
}
