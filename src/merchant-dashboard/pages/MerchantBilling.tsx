import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

// Snapshot frozen on the order at checkout (see server/routes/ordersRouter.ts).
// This is the authoritative source for customer name/phone — it doesn't depend
// on a profile that may not exist or may have since changed.
interface ShippingAddress {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  apartment: string | null;
  city: string | null;
  postalCode: string | null;
}

interface BillItem {
  productTitle: string;
  qty: number;
  unitPrice: number;
}

interface Bill {
  id: string;
  total_price: number;
  created_at: string;
  user_id: string;
  shipping_address: ShippingAddress | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  items: BillItem[];
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso));
}

function BillCard({ bill }: { bill: Bill }) {
  const fullName = [bill.shipping_address?.firstName, bill.shipping_address?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const customerName = fullName || 'عميل غير معروف';
  const phone = bill.shipping_address?.phone || 'رقم الهاتف غير متوفر';
  const address = bill.shipping_address?.address;

  return (
    <div className="mb-bill-card paid">
      <div className="mb-bill-header">
        <div className="mb-bill-name">{customerName}</div>
        <span className="mb-status-badge paid">✅ مدفوعة</span>
      </div>

      <div className="mb-bill-info">
        <div className="mb-bill-row">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>العميل: {customerName}</span>
        </div>

        <div className="mb-bill-row">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.32 2 2 0 0 1 3.56 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.54a16 16 0 0 0 5.55 5.55l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>الهاتف: {phone}</span>
        </div>

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
          <span>{formatDate(bill.created_at)}</span>
        </div>
      </div>

      <div className="mb-divider" />

      <div className="mb-products-list">
        <div className="mb-products-label">المنتجات المطلوبة:</div>
        {bill.items.map((item, idx) => (
          <div key={idx} className="mb-product-row">
            <span className="mb-product-name">{item.productTitle} × {item.qty}</span>
            <span className="mb-product-cost">
              {(item.qty * item.unitPrice).toLocaleString('en-US')} ₪
            </span>
          </div>
        ))}
      </div>

      <div className="mb-divider" />

      <div className="mb-total">
        <span className="mb-total-label">الإجمالي</span>
        <span className="mb-total-value">{Number(bill.total_price).toLocaleString('en-US')} ₪</span>
      </div>
    </div>
  );
}

export default function MerchantBilling() {
  const { merchant } = useMerchantAuth();
  const [bills, setBills] = useState<Bill[]>([]);
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
          productTitle: prod?.title ?? 'منتج',
          qty: row.qty,
          unitPrice: prod?.price ?? 0,
        });
      }

      const orderIds = Object.keys(detailsByOrder).map(Number);

      // 4. Fetch order headers — paid only. All payments go through PayTabs; the
      //    marketplace has no cash-on-delivery flow, so unpaid orders never belong
      //    on this page.
      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select('id, total_price, created_at, user_id, delivery_lat, delivery_lng, shipping_address')
        .in('id', orderIds)
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: false });
      if (oErr) throw oErr;

      const mapped: Bill[] = (orders ?? []).map((o: any) => ({
        id: o.id,
        total_price: Number(o.total_price),
        created_at: o.created_at,
        user_id: o.user_id,
        shipping_address: o.shipping_address ?? null,
        delivery_lat: o.delivery_lat ?? null,
        delivery_lng: o.delivery_lng ?? null,
        items: detailsByOrder[o.id] ?? [],
      }));

      setBills(mapped);
    } catch (err: unknown) {
      setError('تعذّر تحميل الفواتير');
      console.error(err);
    }
    setLoading(false);
  };

  if (loading) return <div className="mb-root"><div className="md-page-loading">جاري تحميل الفواتير...</div></div>;
  if (!merchant?.shop) return <div className="mb-root"><div className="md-page-empty">لا يوجد متجر مرتبط بحسابك.</div></div>;

  return (
    <div className="mb-root">
      <div className="mb-header">
        <h1 className="mb-title">الفواتير</h1>
        <div className="mb-tabs">
          <span className="mb-tab mb-tab-active">
            ✅ مدفوعة ({bills.length})
          </span>
        </div>
      </div>

      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      <div className="mb-grid">
        {bills.length === 0 ? (
          <div className="mb-empty">لا توجد فواتير مدفوعة بعد</div>
        ) : (
          bills.map(bill => <BillCard key={bill.id} bill={bill} />)
        )}
      </div>
    </div>
  );
}
