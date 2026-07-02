import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  title?: string;
  message: React.ReactNode;
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Emoji or ReactNode shown at the top of the dialog */
  icon?: React.ReactNode;
  /** Colour of the confirm button. Defaults to danger red (#DC2626). */
  confirmColor?: string;
  /** When true, shows the reversible note instead of the irreversible note. */
  reversible?: boolean;
  /** When true, hides the reversibility note entirely. */
  hideReversibilityNote?: boolean;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  warning,
  confirmLabel,
  cancelLabel,
  icon = '🗑️',
  confirmColor = '#DC2626',
  reversible = false,
  hideReversibilityNote = false,
  loading = false,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation('common');
  const { direction: dir } = useLanguage();
  const resolvedTitle = title ?? t('confirmDialog.defaultTitle');
  const resolvedConfirmLabel = confirmLabel ?? t('confirmDialog.defaultConfirm');
  const resolvedCancelLabel = cancelLabel ?? t('confirmDialog.defaultCancel');
  const loadingColor = confirmColor + 'AA';

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,43,78,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        fontFamily: "'Tajawal', sans-serif",
        direction: dir,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');`}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 14,
          padding: '28px 32px',
          maxWidth: 420,
          width: '90%',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          textAlign: 'center',
        }}
      >
        {/* Icon */}
        <div style={{ fontSize: 38, marginBottom: 14, lineHeight: 1 }}>{icon}</div>

        {/* Title */}
        <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 800, color: '#0F2B4E' }}>
          {resolvedTitle}
        </h3>

        {/* Main message */}
        <p style={{ margin: '0 0 10px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          {message}
        </p>

        {/* Optional warning */}
        {warning && (
          <div style={{
            margin: '0 0 10px',
            fontSize: 12, color: '#DC2626',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            padding: '8px 12px',
            borderRadius: 7,
            lineHeight: 1.5,
          }}>
            {warning}
          </div>
        )}

        {/* Reversibility note */}
        {!hideReversibilityNote && (
          <p style={{ margin: '0 0 20px', fontSize: 11, color: '#94A3B8' }}>
            {reversible ? t('confirmDialog.reversible') : t('confirmDialog.irreversible')}
          </p>
        )}

        {/* API error */}
        {error && (
          <p style={{ margin: '0 0 14px', fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
            {error}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '9px 24px', borderRadius: 8,
              border: '1.5px solid #E2E8F0',
              background: '#fff', color: '#0F2B4E',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {resolvedCancelLabel}
          </button>

          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '9px 24px', borderRadius: 8,
              border: 'none',
              background: loading ? loadingColor : confirmColor,
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
              transition: 'background 0.15s',
            }}
          >
            {loading ? t('confirmDialog.executing') : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
