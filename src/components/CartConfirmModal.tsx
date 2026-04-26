import './CartConfirmModal.css';

interface Props {
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CartConfirmModal({
  message = 'هذا المنتج موجود بالفعل في سلتك. هل ترغب في زيادة الكمية؟',
  confirmLabel = 'نعم',
  cancelLabel = 'لا',
  confirmDanger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="ccm-overlay" onClick={onCancel}>
      <div className="ccm-box" onClick={e => e.stopPropagation()}>
        <p className="ccm-msg">{message}</p>
        <div className="ccm-actions">
          <button
            type="button"
            className={`ccm-btn ${confirmDanger ? 'ccm-btn-danger' : 'ccm-btn-yes'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="ccm-btn ccm-btn-no" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
