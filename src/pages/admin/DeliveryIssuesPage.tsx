import { useState, useEffect, useCallback } from 'react';
import { fetchDeliveryIssues, resolveDeliveryIssue, type DeliveryIssue } from '../../lib/deliveryIssues';
import ConfirmDialog from '../../components/ConfirmDialog';
import './adminResponsiveTable.css';

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending:    'قيد التحضير',
  available:  'جاهز للاستلام',
  delayed:    'متأخر',
  batched:    'مجمّع للنقل',
  reserved:   'محجوز للتوصيل',
  picked_up:  'قيد التوصيل',
  delivered:  'تم التسليم',
  stranded:   'مشكلة في النقل',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', {
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
      setError('تعذّر تحميل البيانات: ' + (res.error ?? ''));
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
      setResolveError('فشل تحديث الحالة: ' + (res.error ?? ''));
      setResolving(false);
      return;
    }
    setIssues(prev => prev.filter(i => i.id !== resolveTarget.id));
    setResolveTarget(null);
    setResolving(false);
  }

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction: 'rtl', color: '#0F2B4E' }}>
      {resolveTarget && (
        <ConfirmDialog
          title="تأكيد حل المشكلة"
          icon="✅"
          message={<>هل تريد تعليم تقرير التأخير للطلب <strong>#{resolveTarget.order_id}</strong> كمحلول؟ سيتم إزالته من قائمة المشاكل المفتوحة.</>}
          confirmColor="#16a34a"
          confirmLabel="تم الحل"
          reversible={false}
          loading={resolving}
          error={resolveError}
          onConfirm={handleResolve}
          onCancel={() => { setResolveTarget(null); setResolveError(''); }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>مشاكل التوصيل</h2>
        <button onClick={load} disabled={loading}
          style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
          ↻ تحديث
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="admin-stat-card" style={{ maxWidth: 220 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>تقارير تأخير مفتوحة</span>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', lineHeight: 1, marginTop: 6 }}>{issues.length}</div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>
      ) : issues.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا توجد مشاكل توصيل مفتوحة 🎉</div>
      ) : (
        <div className="adm-scroll" style={{ overflowX: 'auto', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff' }}>
          <table className="adm-rtable" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>رقم الطلب</th>
                <th style={thStyle}>رقم الشحنة</th>
                <th style={thStyle}>العميل</th>
                <th style={thStyle}>ملاحظة العميل</th>
                <th style={thStyle}>تاريخ التقرير</th>
                <th style={thStyle}>حالة الشحنة الحالية</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {issues.map(issue => (
                <tr key={issue.id}>
                  <td style={tdStyle} data-label="رقم الطلب">#{issue.order_id}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }} data-label="رقم الشحنة">
                    {issue.shipment_number ?? <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={tdStyle} data-label="العميل">{issue.customer_name ?? <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                  <td style={{ ...tdStyle, maxWidth: 280, whiteSpace: 'pre-wrap' }} data-label="ملاحظة العميل">{issue.note ?? '—'}</td>
                  <td style={tdStyle} data-label="تاريخ التقرير">{formatDate(issue.reported_at)}</td>
                  <td style={tdStyle} data-label="حالة الشحنة الحالية">
                    {issue.shipment_status
                      ? <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                          {SHIPMENT_STATUS_LABEL[issue.shipment_status] ?? issue.shipment_status}
                        </span>
                      : <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }} data-label="إجراءات">
                    <button
                      onClick={() => { setResolveTarget(issue); setResolveError(''); }}
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: '1.5px solid #86EFAC',
                        background: '#F0FDF4', color: '#15803D', cursor: 'pointer',
                        fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                      }}>
                      تعليم كمحلول
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
