import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';

interface CustomerInfo {
  full_name: string | null;
  phone: string | null;
  address: string | null;
}

interface BillItem {
  productTitle: string;
  qty: number;
  unitPrice: number;
}

interface Bill {
  id: string;
  payment_status: string | null;
  total_price: number;
  created_at: string;
  user_id: string;
  customer: CustomerInfo | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  items: BillItem[];
}

function formatDate(iso: string, numLocale: string) {
  return new Intl.DateTimeFormat(numLocale, {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso));
}

function BillCard({ bill }: { bill: Bill }) {
  const { t } = useTranslation('merchant');
  const { lang } = useLanguage();
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const isPaid = bill.payment_status === 'paid';
  const customerName = bill.customer?.full_name ?? t('billing.customerFallback', { id: bill.user_id.slice(0, 8) });
  const phone = bill.customer?.phone;
  const address = bill.customer?.address;

  return (
    <div className={`mb-bill-card ${isPaid ? 'paid' : 'unpaid'}`}>
      <div className="mb-bill-header">
        <div className="mb-bill-name">{customerName}</div>
        <span className={`mb-status-badge ${isPaid ? 'paid' : 'unpaid'}`}>
          {isPaid ? `✅ ${t('billing.statusPaid')}` : `⏳ ${t('billing.statusUnpaid')}`}
        </span>
      </div>

      <div className="mb-bill-info">
        <div className="mb-bill-row">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>{customerName}</span>
        </div>

        {phone && (
          <div className="mb-bill-row">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.32 2 2 0 0 1 3.56 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.54a16 16 0 0 0 5.55 5.55l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span>{phone}</span>
          </div>
        )}

        {address && (
          <div className="mb-bill-row">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M17.657 16.657L13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z" />
              <circle cx="12" cy="11" r="3" />
            </svg>
            <span>{address}</span>
          </div>
        )}

        {!address && bill.delivery_lat && bill.delivery_lng && (
          <div className="mb-bill-row">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M17.657 16.657L13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z" />
              <circle cx="12" cy="11" r="3" />
            </svg>
            <span>{bill.delivery_lat.toFixed(4)}, {bill.delivery_lng.toFixed(4)}</span>
          </div>
        )}

        <div className="mb-bill-row">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{formatDate(bill.created_at, numLocale)}</span>
        </div>
      </div>

      <div className="mb-divider" />

      <div className="mb-products-list">
        <div className="mb-products-label">{t('billing.productsRequested')}</div>
        {bill.items.map((item, idx) => (
          <div key={idx} className="mb-product-row">
            <span className="mb-product-name">{item.productTitle} × {item.qty}</span>
            <span className="mb-product-cost">
              {(item.qty * item.unitPrice).toLocaleString(numLocale)} ₪
            </span>
          </div>
        ))}
      </div>

      <div className="mb-divider" />

      <div className="mb-total">
        <span className="mb-total-label">{t('billing.total')}</span>
        <span className="mb-total-value">{Number(bill.total_price).toLocaleString(numLocale)} ₪</span>
      </div>
    </div>
  );
}

export default function MerchantBilling() {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const { merchant } = useMerchantAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [tab, setTab] = useState<'unpaid' | 'paid'>('unpaid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const shopId = merchant?.shop?.shop_id;
    if (!shopId) { setLoading(false); return; }
    loadBills(shopId);
  }, [merchant?.shop?.shop_id]);

  const loadBills = async (shopId: string) => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch order line items for this shop
      const { data: details, error: dErr } = await supabase
        .from('order_details')
        .select('order_id, product_id, qty')
        .eq('shop_id', shopId);
      if (dErr) throw dErr;

      if (!details || details.length === 0) {
        setBills([]);
        setLoading(false);
        return;
      }

      // 2. Fetch product info separately
      const productIds = [...new Set((details as any[]).map(r => r.product_id))];
      const { data: productsData } = await supabase
        .from('products')
        .select('id, title, price')
        .in('id', productIds);
      const productMap: Record<string, { title: string; price: number }> = {};
      for (const p of productsData ?? []) {
        productMap[(p as any).id] = { title: (p as any).title, price: Number((p as any).price) };
      }

      // 3. Group by order_id
      const detailsByOrder: Record<string, BillItem[]> = {};
      for (const row of details as any[]) {
        if (!detailsByOrder[row.order_id]) detailsByOrder[row.order_id] = [];
        const prod = productMap[row.product_id];
        detailsByOrder[row.order_id].push({
          productTitle: prod?.title ?? t('billing.productFallback'),
          qty: row.qty,
          unitPrice: prod?.price ?? 0,
        });
      }

      const orderIds = Object.keys(detailsByOrder).map(Number);

      // 3. Fetch order headers
      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select('id, payment_status, total_price, created_at, user_id, delivery_lat, delivery_lng')
        .in('id', orderIds)
        .order('created_at', { ascending: false });
      if (oErr) throw oErr;

      const userIds = [...new Set((orders ?? []).map((o: any) => o.user_id as string))];

      // 4. Fetch customer profiles (name, phone, address)
      let profileMap: Record<string, CustomerInfo> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, phone, address')
          .in('id', userIds);
        if (profiles) {
          for (const p of profiles as any[]) {
            profileMap[p.id] = { full_name: p.full_name, phone: p.phone, address: p.address };
          }
        }
      }

      const mapped: Bill[] = (orders ?? []).map((o: any) => ({
        id: o.id,
        payment_status: o.payment_status,
        total_price: Number(o.total_price),
        created_at: o.created_at,
        user_id: o.user_id,
        customer: profileMap[o.user_id] ?? null,
        delivery_lat: o.delivery_lat ?? null,
        delivery_lng: o.delivery_lng ?? null,
        items: detailsByOrder[o.id] ?? [],
      }));

      setBills(mapped);
    } catch (err: unknown) {
      setError(t('billing.loadFailed'));
      console.error(err);
    }
    setLoading(false);
  };

  const unpaid = bills.filter(b => b.payment_status !== 'paid');
  const paid = bills.filter(b => b.payment_status === 'paid');
  const displayed = tab === 'unpaid' ? unpaid : paid;

  if (loading) return <div className="mb-root" dir={direction}><div className="md-page-loading">{t('billing.loading')}</div></div>;
  if (!merchant?.shop) return <div className="mb-root" dir={direction}><div className="md-page-empty">{t('billing.noShop')}</div></div>;

  return (
    <div className="mb-root" dir={direction}>
      <div className="mb-header">
        <h1 className="mb-title">{t('billing.title')}</h1>
        <div className="mb-tabs">
          <button
            type="button"
            className={`mb-tab${tab === 'unpaid' ? ' mb-tab-active' : ''}`}
            onClick={() => setTab('unpaid')}
          >
            ⏳ {t('billing.tabUnpaid')} ({unpaid.length})
          </button>
          <button
            type="button"
            className={`mb-tab${tab === 'paid' ? ' mb-tab-active' : ''}`}
            onClick={() => setTab('paid')}
          >
            ✅ {t('billing.tabPaid')} ({paid.length})
          </button>
        </div>
      </div>

      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      <div className="mb-grid">
        {displayed.length === 0 ? (
          <div className="mb-empty">
            {tab === 'unpaid' ? `${t('billing.emptyUnpaid')} 🎉` : t('billing.emptyPaid')}
          </div>
        ) : (
          displayed.map(bill => <BillCard key={bill.id} bill={bill} />)
        )}
      </div>
    </div>
  );
}
