import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { usePublishReadiness } from '../hooks/usePublishReadiness';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import './MerchantActivation.css';

interface Props {
  onNavigate: (page: string) => void;
}

type ToastType = 'success' | 'error';

interface Toast {
  type: ToastType;
  message: string;
}

export default function MerchantActivation({ onNavigate }: Props) {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const { merchant, updateShopLocally } = useMerchantAuth();
  const shop = merchant?.shop ?? null;
  const { checks, allPassed, loading } = usePublishReadiness(shop);

  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (type: ToastType, message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const isPublished = shop?.status === 'published';

  const handlePublish = async () => {
    if (!shop || !allPassed || isPublished) return;
    setPublishing(true);
    const { error } = await supabase
      .from('shops')
      .update({ status: 'published' })
      .eq('shop_id', shop.shop_id);

    if (error) {
      showToast('error', t('activation.toast.publishError', { message: error.message }));
    } else {
      updateShopLocally({ ...shop, status: 'published' });
      showToast('success', t('activation.toast.publishSuccess'));
    }
    setPublishing(false);
  };

  const completedCount = checks.filter(c => c.passed).length;

  return (
    <div className="ma-root" dir={direction}>
      {/* Toast */}
      {toast && (
        <div className={`ma-toast ma-toast--${toast.type}`}>
          {toast.type === 'success' ? '✅' : '⚠️'} {toast.message}
        </div>
      )}

      <div className="ma-header">
        <div className="ma-header-text">
          <h1 className="ma-title">{t('activation.header.title')}</h1>
          <p className="ma-subtitle">
            {t('activation.header.subtitle')}
          </p>
        </div>

        {isPublished ? (
          <div className="ma-status-badge ma-status-published">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t('activation.status.published')}
          </div>
        ) : (
          <div className="ma-status-badge ma-status-pending">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            {t('activation.status.pending')}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {!loading && (
        <div className="ma-progress-wrap">
          <div className="ma-progress-label">
            <span>{t('activation.progress.label')}</span>
            <span>{completedCount} / {checks.length}</span>
          </div>
          <div className="ma-progress-bar">
            <div
              className="ma-progress-fill"
              style={{ width: `${checks.length ? (completedCount / checks.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Checklist */}
      <div className="ma-checklist">
        {loading ? (
          <div className="ma-loading">{t('activation.loading')}</div>
        ) : (
          checks.map((check) => (
            <div key={check.id} className={`ma-check-item${check.passed ? ' ma-check-done' : ''}`}>
              <div className={`ma-check-icon${check.passed ? ' ma-check-icon--done' : ''}`}>
                {check.passed ? (
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                )}
              </div>
              <div className="ma-check-body">
                <span className="ma-check-label">{check.label}</span>
                {!check.passed && (
                  <span className="ma-check-hint">{check.hint}</span>
                )}
              </div>
              {!check.passed && check.action && (
                <button
                  type="button"
                  className="ma-check-action"
                  onClick={() => onNavigate(check.action!)}
                >
                  {t('activation.checklist.fixAction')}
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Publish button */}
      {!isPublished && (
        <div className="ma-publish-wrap">
          <button
            type="button"
            className="ma-publish-btn"
            onClick={handlePublish}
            disabled={!allPassed || publishing || loading}
            title={!allPassed ? t('activation.publish.disabledTitle') : undefined}
          >
            {publishing ? (
              <>
                <span className="ma-btn-spinner" />
                {t('activation.publish.publishing')}
              </>
            ) : (
              <>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {t('activation.publish.button')}
              </>
            )}
          </button>
          {!allPassed && !loading && (
            <p className="ma-publish-note">
              {t('activation.publish.remainingNote', { count: checks.length - completedCount })}
            </p>
          )}
        </div>
      )}

      {/* Published success state */}
      {isPublished && (
        <div className="ma-published-state">
          <div className="ma-published-icon">🎉</div>
          <h2 className="ma-published-title">{t('activation.publishedState.title')}</h2>
          <p className="ma-published-desc">
            {t('activation.publishedState.desc')}
          </p>
        </div>
      )}
    </div>
  );
}
