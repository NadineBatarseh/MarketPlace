import { useState } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { usePublishReadiness } from '../hooks/usePublishReadiness';
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
      .eq('shop_id', shop.shop_id)
      .eq('owner_id', merchant!.id);

    if (error) {
      showToast('error', 'تعذّر نشر المتجر: ' + error.message);
    } else {
      updateShopLocally({ ...shop, status: 'published' });
      showToast('success', 'تهانينا! تم نشر متجرك بنجاح 🎉');
    }
    setPublishing(false);
  };

  const completedCount = checks.filter(c => c.passed).length;

  return (
    <div className="ma-root">
      {/* Toast */}
      {toast && (
        <div className={`ma-toast ma-toast--${toast.type}`}>
          {toast.type === 'success' ? '✅' : '⚠️'} {toast.message}
        </div>
      )}

      <div className="ma-header">
        <div className="ma-header-text">
          <h1 className="ma-title">نشر المتجر</h1>
          <p className="ma-subtitle">
            أكمل جميع الخطوات أدناه لتفعيل متجرك وجعله مرئياً للعملاء
          </p>
        </div>

        {isPublished ? (
          <div className="ma-status-badge ma-status-published">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            متجرك منشور
          </div>
        ) : (
          <div className="ma-status-badge ma-status-pending">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            قيد الإعداد
          </div>
        )}
      </div>

      {/* Progress bar */}
      {!loading && (
        <div className="ma-progress-wrap">
          <div className="ma-progress-label">
            <span>التقدم</span>
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
          <div className="ma-loading">جاري تحميل متطلبات النشر...</div>
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
                  إصلاح
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
            title={!allPassed ? 'أكمل جميع المتطلبات أولاً' : undefined}
          >
            {publishing ? (
              <>
                <span className="ma-btn-spinner" />
                جاري النشر...
              </>
            ) : (
              <>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                انشر المتجر
              </>
            )}
          </button>
          {!allPassed && !loading && (
            <p className="ma-publish-note">
              {checks.length - completedCount} خطوة متبقية قبل النشر
            </p>
          )}
        </div>
      )}

      {/* Published success state */}
      {isPublished && (
        <div className="ma-published-state">
          <div className="ma-published-icon">🎉</div>
          <h2 className="ma-published-title">متجرك منشور ومرئي للعملاء</h2>
          <p className="ma-published-desc">
            يمكن للمتسوقين الآن العثور على متجرك وتصفح منتجاتك
          </p>
        </div>
      )}
    </div>
  );
}
