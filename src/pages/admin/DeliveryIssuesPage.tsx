import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchDeliveryIssues, resolveDeliveryIssue, type DeliveryIssue } from '../../lib/deliveryIssues';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useLanguage } from '../../context/LanguageContext';
import './adminResponsiveTable.css';

function formatDate(iso: string, numLocale: string) {
  return new Date(iso).toLocaleDateString(numLocale, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'right', color: '#64748B',
  fontWeight: 700, fontSize: 11, borderBottom: '1.5px solid #E2E8F0',
  whiteSpace: 'nowrap', background: '#F8FAFC', letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px', color: '#0F2B4E', fontSize: 13,
  verticalAlign: 'middle', textAlign: 'right', borderBottom: '1px solid #F1F5F9',
};

export default function DeliveryIssuesPage() {
  const { t } = useTranslation('admin');
  const { direction, lang } = useLanguage();
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const SHIPMENT_STATUS_LABEL: Record<string, string> = {
    pending: t('deliveryIssues.status.pending'),
    available: t('deliveryIssues.status.available'),
    delayed: t('deliveryIssues.status.delayed'),
    batched: t('deliveryIssues.status.batched'),
    reserved: t('deliveryIssues.status.reserved'),
    picked_up: t('deliveryIssues.status.picked_up'),
    delivered: t('deliveryIssues.status.delivered'),
    stranded: t('deliveryIssues.status.stranded'),
  };
  const [issues, setIssues]   = useState<DeliveryIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [resolveTarget, setResolveTarget] = useState<DeliveryIssue | null>(null);
  const [resolving, setResolving]         = useState(false);
  const [resolveError, setResolveError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await fetchDeliveryIssues();
    if (!res.ok) {
      setError(t('deliveryIssues.loadError', { error: res.error ?? '' }));
      setLoading(false);
      return;
    }
    setIssues(res.issues);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleResolve() {
    if (!resolveTarget) return;
    setResolving(true);
    setResolveError('');
    const res = await resolveDeliveryIssue(resolveTarget.id);
    if (!res.ok) {
      setResolveError(t('deliveryIssues.resolveError', { error: res.error ?? '' }));
      setResolving(false);
      return;
    }
    setIssues(prev => prev.filter(i => i.id !== resolveTarget.id));
    setResolveTarget(null);
    setResolving(false);
  }

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction, color: '#0F2B4E' }}>
      {resolveTarget && (
        <ConfirmDialog
          title={t('deliveryIssues.confirmResolveTitle')}
          icon="✅"
          message={t('deliveryIssues.confirmResolveMessage', { orderId: resolveTarget.order_id })}
          confirmColor="#16a34a"
          confirmLabel={t('deliveryIssues.confirmResolveLabel')}
          reversible={false}
          loading={resolving}
          error={resolveError}
          onConfirm={handleResolve}
          onCancel={() => { setResolveTarget(null); setResolveError(''); }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t('deliveryIssues.title')}</h2>
        <button onClick={load} disabled={loading}
          style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
          ↻ {t('deliveryIssues.refresh')}
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="admin-stat-card" style={{ maxWidth: 220 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{t('deliveryIssues.openIssuesLabel')}</span>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', lineHeight: 1, marginTop: 6 }}>{issues.length}</div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('deliveryIssues.loading')}</div>
      ) : issues.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>{t('deliveryIssues.noIssues')} 🎉</div>
      ) : (
        <div className="adm-scroll" style={{ overflowX: 'auto', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff' }}>
          <table className="adm-rtable" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('deliveryIssues.table.orderNumber')}</th>
                <th style={thStyle}>{t('deliveryIssues.table.shipmentNumber')}</th>
                <th style={thStyle}>{t('deliveryIssues.table.customer')}</th>
                <th style={thStyle}>{t('deliveryIssues.table.customerNote')}</th>
                <th style={thStyle}>{t('deliveryIssues.table.reportDate')}</th>
                <th style={thStyle}>{t('deliveryIssues.table.currentStatus')}</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>{t('deliveryIssues.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map(issue => (
                <tr key={issue.id}>
                  <td style={tdStyle} data-label={t('deliveryIssues.table.orderNumber')}>#{issue.order_id}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }} data-label={t('deliveryIssues.table.shipmentNumber')}>
                    {issue.shipment_number ?? <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={tdStyle} data-label={t('deliveryIssues.table.customer')}>{issue.customer_name ?? <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                  <td style={{ ...tdStyle, maxWidth: 280, whiteSpace: 'pre-wrap' }} data-label={t('deliveryIssues.table.customerNote')}>{issue.note ?? '—'}</td>
                  <td style={tdStyle} data-label={t('deliveryIssues.table.reportDate')}>{formatDate(issue.reported_at, numLocale)}</td>
                  <td style={tdStyle} data-label={t('deliveryIssues.table.currentStatus')}>
                    {issue.shipment_status
                      ? <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                          {SHIPMENT_STATUS_LABEL[issue.shipment_status] ?? issue.shipment_status}
                        </span>
                      : <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }} data-label={t('deliveryIssues.table.actions')}>
                    <button
                      onClick={() => { setResolveTarget(issue); setResolveError(''); }}
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: '1.5px solid #86EFAC',
                        background: '#F0FDF4', color: '#15803D', cursor: 'pointer',
                        fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                      }}>
                      {t('deliveryIssues.markResolved')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
