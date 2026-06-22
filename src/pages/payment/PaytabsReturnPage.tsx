import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useShop } from '../../context/ShopContext';
import Topbar from '../../components/Topbar';
import './PaytabsReturnPage.css';

/**
 * Landing page after the PayTabs Hosted Payment Page redirects the customer back.
 *
 * The browser may arrive here either:
 *   - directly from PayTabs (its `return` URL points at this route), or
 *   - via the backend /return endpoint which appends ?order_id&status.
 *
 * Either way we re-verify the real outcome server-side by calling
 * /api/payments/paytabs/status (which re-queries PayTabs and applies the
 * result idempotently), so the displayed state is always authoritative.
 */

type View = 'loading' | 'paid' | 'failed' | 'error';

export default function PaytabsReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { customer, isLoading: authLoading } = useCustomerAuth();
  const { removeItemsFromCart } = useShop();

  const [view, setView] = useState<View>('loading');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!customer) { navigate('/login'); return; }

    // order_id from the query (set by the backend /return redirect) or, as a
    // fallback, the value we stashed before redirecting to PayTabs.
    const oid = params.get('order_id') || localStorage.getItem('paytabs_pending_order_id');
    if (!oid) {
      setView('error');
      setMessage('تعذّر تحديد الطلب. يرجى مراجعة صفحة طلباتي.');
      return;
    }
    setOrderId(oid);

    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const resp = await fetch(`/api/payments/paytabs/status?order_id=${encodeURIComponent(oid)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await resp.json().catch(() => ({}));
        if (cancelled) return;

        if (!resp.ok || !json.ok) {
          setView('error');
          setMessage(json.error || 'تعذّر التحقق من حالة الدفع.');
          return;
        }

        localStorage.removeItem('paytabs_pending_order_id');
        if (json.payment_status === 'paid') {
          // Payment confirmed — now (and only now) clear the items that were
          // actually paid for, leaving the rest of the cart untouched.
          try {
            const stashed = localStorage.getItem('paytabs_pending_item_ids');
            const ids: string[] = stashed ? JSON.parse(stashed) : [];
            if (Array.isArray(ids) && ids.length > 0) removeItemsFromCart(ids);
          } catch { /* ignore malformed stash */ }
          localStorage.removeItem('paytabs_pending_item_ids');
          setView('paid');
        } else if (json.payment_status === 'failed') {
          setView('failed');
        } else {
          // Still pending — PayTabs hasn't finalised. Treat as failed-to-confirm.
          setView('failed');
          setMessage('لم يتم تأكيد الدفع بعد. إذا تم خصم المبلغ فسيظهر الطلب كمدفوع قريباً.');
        }
      } catch {
        if (!cancelled) {
          setView('error');
          setMessage('حدث خطأ أثناء التحقق من حالة الدفع.');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, customer, params, navigate, removeItemsFromCart]);

  return (
    <div className="ptr-page" dir="rtl">
      <Topbar />
      <div className="ptr-card">
        {view === 'loading' && (
          <>
            <div className="ptr-spinner" />
            <h2 className="ptr-title">جارٍ التحقق من حالة الدفع…</h2>
            <p className="ptr-sub">يرجى الانتظار لحظة.</p>
          </>
        )}

        {view === 'paid' && (
          <>
            <div className="ptr-icon ptr-icon--ok">✓</div>
            <h2 className="ptr-title">تم الدفع بنجاح 🎉</h2>
            <p className="ptr-sub">تم تأكيد طلبك وسنبدأ بتجهيزه.</p>
            <div className="ptr-actions">
              <button className="ptr-btn ptr-btn--primary" onClick={() => navigate(`/orders/${orderId}`)}>
                تتبّع الطلب
              </button>
              <button className="ptr-btn" onClick={() => navigate('/home')}>متابعة التسوّق</button>
            </div>
          </>
        )}

        {view === 'failed' && (
          <>
            <div className="ptr-icon ptr-icon--fail">✕</div>
            <h2 className="ptr-title">لم تكتمل عملية الدفع</h2>
            <p className="ptr-sub">{message || 'لم يتم إتمام الدفع. يمكنك المحاولة مرة أخرى من سلة المشتريات.'}</p>
            <div className="ptr-actions">
              {orderId && (
                <button className="ptr-btn ptr-btn--primary" onClick={() => navigate(`/orders/${orderId}`)}>
                  عرض الطلب
                </button>
              )}
              <button className="ptr-btn" onClick={() => navigate('/cart')}>العودة إلى السلة</button>
            </div>
          </>
        )}

        {view === 'error' && (
          <>
            <div className="ptr-icon ptr-icon--fail">!</div>
            <h2 className="ptr-title">تعذّر التحقق من الدفع</h2>
            <p className="ptr-sub">{message}</p>
            <div className="ptr-actions">
              <button className="ptr-btn ptr-btn--primary" onClick={() => navigate('/orders')}>
                طلباتي
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
