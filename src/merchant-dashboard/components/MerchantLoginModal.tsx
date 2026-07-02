import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import './MerchantLoginModal.css';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function MerchantLoginModal({ onClose, onSuccess }: Props) {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const { login, isLoading } = useMerchantAuth();
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
      setError(t('loginModal.missingFields'));
      return;
    }
    const result = await login(email.trim(), password.trim());
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? t('loginModal.unexpectedError'));
    }
  };

  return (
    <div
      className="mlm-overlay"
      ref={overlayRef}
      dir={direction}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="mlm-modal">
        <button className="mlm-close" onClick={onClose} aria-label={t('loginModal.close')}>✕</button>

        <div className="mlm-header">
          <span className="mlm-icon">🏪</span>
          <h2>{t('loginModal.title')}</h2>
          <p>{t('loginModal.subtitle')}</p>
        </div>

        <form className="mlm-form" onSubmit={handleSubmit}>
          <div className="mlm-field">
            <label htmlFor="mlm-email">{t('loginModal.email')}</label>
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
            <label htmlFor="mlm-password">{t('loginModal.password')}</label>
            <input
              id="mlm-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('loginModal.passwordPlaceholder')}
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          {error && <div className="mlm-error" role="alert">{error}</div>}

          <button type="submit" className="mlm-submit" disabled={isLoading}>
            {isLoading ? t('loginModal.submitting') : t('loginModal.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
