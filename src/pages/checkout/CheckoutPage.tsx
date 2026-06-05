import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import supabase from '../../lib/supabase';
import Topbar from '../../components/Topbar';
import './CheckoutPage.css';

type PaymentMethod = 'paytabs' | 'cod' | null;

export default function CheckoutPage() {
  const { cartItems, removeFromCart, updateCartQty, clearCart } = useShop();
  const { customer } = useCustomerAuth();
  const navigate     = useNavigate();

  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [shipping, setShipping] = useState({ address: '', apartment: '', city: '', postalCode: '' });
  const [payment, setPayment] = useState<PaymentMethod>(null);
  const [paying, setPaying]   = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!customer) { navigate('/login'); return; }
    if (!payment)  { setPayError('الرجاء اختيار طريقة الدفع'); return; }
    if (activeItems.length === 0) { setPayError('لا توجد منتجات متاحة للشراء في سلتك'); return; }

    setPaying(true);
    setPayError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const authHeaders = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      // 1. Create the order server-side (service-role bypasses RLS; prices are
      //    recomputed from the DB). Send only product_id + qty for active items.
      const orderResp = await fetch('/api/orders/create', {
        method:  'POST',
        headers: authHeaders,
        body: JSON.stringify({
          // item.id is a composite cart key (productId__color__size) — send the
          // real product UUID from item.productId.
          items:          activeItems.map(item => ({ product_id: String(item.productId), qty: item.quantity })),
          payment_method: payment,
          shipping,
        }),
      });
      const orderJson = await orderResp.json().catch(() => ({}));
      if (!orderResp.ok || !orderJson.ok || !orderJson.order_id) {
        throw new Error(orderJson.error || 'فشل إنشاء الطلب');
      }
      const orderId = orderJson.order_id;

      // 2. Branch on the selected payment method
      if (payment === 'paytabs') {
        // Online card payment — hand off to the PayTabs Hosted Payment Page.
        const resp = await fetch('/api/payments/paytabs/create', {
          method:  'POST',
          headers: authHeaders,
          body: JSON.stringify({ order_id: orderId, contact, shipping }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok || !json.redirect_url) {
          throw new Error(json.error || 'تعذر بدء عملية الدفع عبر PayTabs');
        }

        // Remember which order we're paying so the return page can verify it.
        localStorage.setItem('paytabs_pending_order_id', String(orderId));
        clearCart();
        window.location.href = json.redirect_url; // → PayTabs Hosted Payment Page
        return;
      }

      // Cash on Delivery — order already marked 'cod' server-side; go to tracking.
      clearCart();
      navigate(`/orders/${orderId}`);
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'حدث خطأ أثناء معالجة الدفع');
    } finally {
      setPaying(false);
    }
  };

  const activeItems  = cartItems.filter(item => !item.isDeleted);
  const hasDeleted   = cartItems.some(item => item.isDeleted);

  const DELIVERY_COST = 25;
  const subtotal = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + DELIVERY_COST;

  return (
    <div className="co-page" dir="rtl">
      <Topbar />
      <h1 className="co-page-title">إتمام الطلب</h1>
      <div className="co-wrap">

        {/* ── RIGHT: Form ── */}
        <div className="co-form-side">

          {/* Contact Info */}
          <section className="co-section">
            <h2 className="co-section-title">معلومات التواصل</h2>
            <div className="co-row">
              <div className="co-field">
                <label>الاسم الأول</label>
                <input placeholder="أدخل الاسم الأول" value={contact.firstName}
                  onChange={e => setContact(c => ({ ...c, firstName: e.target.value }))} />
              </div>
              <div className="co-field">
                <label>الاسم الأخير</label>
                <input placeholder="أدخل الاسم الأخير" value={contact.lastName}
                  onChange={e => setContact(c => ({ ...c, lastName: e.target.value }))} />
              </div>
            </div>
            <div className="co-field">
              <label>البريد الإلكتروني</label>
              <input type="email" placeholder="example@email.com" value={contact.email}
                onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
            </div>
            <div className="co-field">
              <label>رقم الهاتف</label>
              <input type="tel" placeholder="+966 5x xxx xxxx" value={contact.phone}
                onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} />
            </div>
          </section>

          {/* Delivery */}
          <section className="co-section">
            <h2 className="co-section-title">التوصيل والشحن</h2>
            <div className="co-field">
              <label>العنوان</label>
              <input placeholder="اسم الشارع ورقم المنزل" value={shipping.address}
                onChange={e => setShipping(s => ({ ...s, address: e.target.value }))} />
            </div>
            <div className="co-field">
              <label>الشقة / الدور (اختياري)</label>
              <input placeholder="رقم الشقة أو الدور" value={shipping.apartment}
                onChange={e => setShipping(s => ({ ...s, apartment: e.target.value }))} />
            </div>
            <div className="co-row">
              <div className="co-field">
                <label>المدينة</label>
                <input placeholder="مثال: الرياض" value={shipping.city}
                  onChange={e => setShipping(s => ({ ...s, city: e.target.value }))} />
              </div>
              <div className="co-field">
                <label>الرمز البريدي</label>
                <input placeholder="12345" value={shipping.postalCode}
                  onChange={e => setShipping(s => ({ ...s, postalCode: e.target.value }))} />
              </div>
            </div>
          </section>

          {/* Payment */}
          <section className="co-section">
            <h2 className="co-section-title">الدفع</h2>
            <div className="co-payment-options">
              <button
                type="button"
                className={`co-pay-opt ${payment === 'paytabs' ? 'active' : ''}`}
                onClick={() => setPayment('paytabs')}
              >
                <span className="co-pay-icon">💳</span>
                <span>الدفع التجريبي عبر PayTabs<br /><small>PayTabs Test Payment</small></span>
              </button>
              <button
                type="button"
                className={`co-pay-opt ${payment === 'cod' ? 'active' : ''}`}
                onClick={() => setPayment('cod')}
              >
                <span className="co-pay-icon">💵</span>
                <span>الدفع عند الاستلام<br /><small>Cash on Delivery</small></span>
              </button>
            </div>

            {payment === 'paytabs' && (
              <div className="co-paypal-msg">
                <p>سيتم تحويلك إلى صفحة الدفع الآمنة الخاصة بـ PayTabs لإتمام عملية الدفع (وضع الاختبار).</p>
                <p><small>You will be redirected to the secure PayTabs page to complete your payment (test mode).</small></p>
              </div>
            )}

            {payment === 'cod' && (
              <div className="co-paypal-msg">
                <p>ستدفع قيمة الطلب نقداً عند استلامه. سيتم تأكيد طلبك مباشرة.</p>
                <p><small>You will pay in cash upon delivery. Your order will be confirmed immediately.</small></p>
              </div>
            )}
          </section>
        </div>

        {/* ── LEFT: Order Summary ── */}
        <div className="co-summary-side">
          <div className="co-summary-box">
            <h2 className="co-summary-title">ملخص الطلب</h2>

            {cartItems.length === 0 ? (
              <p className="co-empty">السلة فارغة</p>
            ) : (
              <>
                {hasDeleted && (
                  <div className="co-deleted-warning">
                    ⚠️ بعض المنتجات في سلتك لم تعد متاحة وستُستثنى من الطلب
                  </div>
                )}
                <ul className="co-items">
                  {cartItems.map(item => (
                    <li key={item.id} className={`co-item${item.isDeleted ? ' co-item--deleted' : ''}`}>
                      <div className="co-item-info">
                        <span className="co-item-name">{item.name}</span>
                        {item.isDeleted ? (
                          <span className="co-item-deleted-msg">⚠️ تم حذف هذا المنتج من قبل التاجر</span>
                        ) : (
                          <>
                            <span className="co-item-price">{(item.price * item.quantity).toLocaleString('ar-SA')} ₪</span>
                            <div className="co-qty">
                              <button type="button" onClick={() => updateCartQty(item.id, item.quantity - 1)}
                                disabled={item.quantity <= 1}>−</button>
                              <span>{item.quantity}</span>
                              <button type="button" onClick={() => updateCartQty(item.id, item.quantity + 1)}>+</button>
                            </div>
                          </>
                        )}
                        <button type="button" className="co-remove" onClick={() => removeFromCart(item.id)}>
                          🗑 إزالة
                        </button>
                      </div>
                      {item.image && (
                        <div className="co-item-img">
                          <img src={item.image} alt={item.name} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="co-divider" />

            <div className="co-totals">
              <div className="co-total-row">
                <span className="co-total-label">المجموع الفرعي</span>
                <span className="co-total-val">{subtotal.toLocaleString('ar-SA')} ₪</span>
              </div>
              <div className="co-total-row">
                <span className="co-total-label">تكلفة التوصيل</span>
                <span className="co-total-val">{DELIVERY_COST.toLocaleString('ar-SA')} ₪</span>
              </div>
              <div className="co-total-row">
                <span className="co-total-label">الخصم</span>
                <span className="co-total-val co-discount">— ₪</span>
              </div>
              <div className="co-divider" />
              <div className="co-total-row co-grand">
                <span className="co-total-label">الإجمالي</span>
                <span className="co-total-val">{total.toLocaleString('ar-SA')} ₪</span>
              </div>
            </div>
          </div>

          {payError && <div className="co-pay-error">{payError}</div>}
          <button type="button" className="co-pay-btn" onClick={handlePay} disabled={paying}>
            {paying ? 'جارٍ المعالجة…' : 'ادفع الآن'}
          </button>
        </div>

      </div>
    </div>
  );
}
