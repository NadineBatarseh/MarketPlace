import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useShop } from '../../context/ShopContext';
import Topbar from '../../components/Topbar';
import './PaytabsReturnPage.css';

type View = 'loading' | 'paid' | 'failed' | 'error';

export default function PaytabsReturnPage() {
  const { t } = useTranslation('cart-checkout');
  const { direction } = useLanguage();
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

    const oid = params.get('order_id') || localStorage.getItem('paytabs_pending_order_id');
    if (!oid) {
      setView('error');
      setMessage(t('paytabs.error.noOrderId'));
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
          setMessage(json.error || t('paytabs.error.verifyFailed'));
          return;
        }

        localStorage.removeItem('paytabs_pending_order_id');
        if (json.payment_status === 'paid') {
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
          setView('failed');
          setMessage(t('paytabs.error.pending'));
        }
      } catch {
        if (!cancelled) {
          setView('error');
          setMessage(t('paytabs.error.generic'));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, customer, params, navigate, removeItemsFromCart]);

  return (
    <div className="ptr-page" dir={direction}>
      <Topbar />
      <div className="ptr-card">
        {view === 'loading' && (
          <>
            <div className="ptr-spinner" />
            <h2 className="ptr-title">{t('paytabs.loading.title')}</h2>
            <p className="ptr-sub">{t('paytabs.loading.subtitle')}</p>
          </>
        )}

        {view === 'paid' && (
          <>
            <div className="ptr-icon ptr-icon--ok">✓</div>
            <h2 className="ptr-title">{t('paytabs.paid.title')}</h2>
            <p className="ptr-sub">{t('paytabs.paid.subtitle')}</p>
            <div className="ptr-actions">
              <button className="ptr-btn ptr-btn--primary" onClick={() => navigate(`/orders/${orderId}`)}>
                {t('paytabs.paid.trackOrder')}
              </button>
              <button className="ptr-btn" onClick={() => navigate('/home')}>{t('paytabs.paid.continueShopping')}</button>
            </div>
          </>
        )}

        {view === 'failed' && (
          <>
            <div className="ptr-icon ptr-icon--fail">✕</div>
            <h2 className="ptr-title">{t('paytabs.failed.title')}</h2>
            <p className="ptr-sub">{message || t('paytabs.failed.defaultMsg')}</p>
            <div className="ptr-actions">
              {orderId && (
                <button className="ptr-btn ptr-btn--primary" onClick={() => navigate(`/orders/${orderId}`)}>
                  {t('paytabs.failed.viewOrder')}
                </button>
              )}
              <button className="ptr-btn" onClick={() => navigate('/cart')}>{t('paytabs.failed.backToCart')}</button>
            </div>
          </>
        )}

        {view === 'error' && (
          <>
            <div className="ptr-icon ptr-icon--fail">!</div>
            <h2 className="ptr-title">{t('paytabs.error.title')}</h2>
            <p className="ptr-sub">{message}</p>
            <div className="ptr-actions">
              <button className="ptr-btn ptr-btn--primary" onClick={() => navigate('/orders')}>
                {t('paytabs.error.myOrders')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
