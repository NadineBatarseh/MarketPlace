import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import supabase from '../../lib/supabase';
import { insertTrackingEvent } from '../../lib/trackingEvents';
import Topbar from '../../components/Topbar';
import './CheckoutPage.css';

type PaymentMethod = 'visa' | 'paypal' | null;

export default function CheckoutPage() {
  const { cartItems, removeFromCart, updateCartQty, clearCart } = useShop();
  const { customer } = useCustomerAuth();
  const navigate     = useNavigate();

  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [shipping, setShipping] = useState({ address: '', apartment: '', city: '', postalCode: '' });
  const [payment, setPayment] = useState<PaymentMethod>(null);
  const [visa, setVisa] = useState({ cardNumber: '', cardHolder: '', expiry: '', cvv: '' });
  const [paying, setPaying]   = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!customer) { navigate('/login'); return; }
    if (!payment)  { setPayError('الرجاء اختيار طريقة الدفع'); return; }
    if (cartItems.length === 0) { setPayError('السلة فارغة'); return; }

    setPaying(true);
    setPayError(null);
    try {
      // 1. Insert order
      const { data: orderData, error: ordErr } = await supabase
        .from('orders')
        .insert({
          user_id:     customer.id,
          status:      'pending',
          total_price: total,
        })
        .select('id')
        .single();

      if (ordErr || !orderData) throw ordErr ?? new Error('فشل إنشاء الطلب');

      // 2. Insert order_details for every cart item
      const details = cartItems.map(item => ({
        order_id:   orderData.id,
        product_id: item.id,
        qty:        item.quantity,
        unit_price: item.price,
      }));

      const { error: detErr } = await supabase.from('order_details').insert(details);
      if (detErr) throw detErr;

      // 3. Insert the first tracking event — "placed"
      await insertTrackingEvent(orderData.id, 'placed', customer.displayName ?? 'العميل', {
        location: `${shipping.city}، فلسطين`,
        note:     'تم استلام الطلب وتأكيد الدفع',
      });

      // 4. Clear cart and navigate to tracking page
      clearCart();
      navigate(`/orders/${orderData.id}`);
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'حدث خطأ أثناء معالجة الدفع');
    } finally {
      setPaying(false);
    }
  };

  const DELIVERY_COST = 25;
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
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
                className={`co-pay-opt ${payment === 'visa' ? 'active' : ''}`}
                onClick={() => setPayment('visa')}
              >
                <span className="co-pay-icon">💳</span>
                <span>فيزا / بطاقة ائتمان<br /><small>Visa / Credit Card</small></span>
              </button>
              <button
                type="button"
                className={`co-pay-opt ${payment === 'paypal' ? 'active' : ''}`}
                onClick={() => setPayment('paypal')}
              >
                <span className="co-pay-icon">🅿️</span>
                <span>باي بال<br /><small>PayPal</small></span>
              </button>
            </div>

            {payment === 'visa' && (
              <div className="co-visa-fields">
                <div className="co-field">
                  <label>رقم البطاقة — Card Number</label>
                  <input placeholder="1234 5678 9012 3456" maxLength={19} value={visa.cardNumber}
                    onChange={e => setVisa(v => ({ ...v, cardNumber: e.target.value }))} />
                </div>
                <div className="co-field">
                  <label>الاسم على البطاقة — Cardholder Name</label>
                  <input placeholder="Full name as on card" value={visa.cardHolder}
                    onChange={e => setVisa(v => ({ ...v, cardHolder: e.target.value }))} />
                </div>
                <div className="co-row">
                  <div className="co-field">
                    <label>تاريخ الانتهاء — Expiry Date</label>
                    <input placeholder="MM / YY" maxLength={5} value={visa.expiry}
                      onChange={e => setVisa(v => ({ ...v, expiry: e.target.value }))} />
                  </div>
                  <div className="co-field">
                    <label>رمز الأمان — CVV</label>
                    <input placeholder="123" maxLength={3} value={visa.cvv}
                      onChange={e => setVisa(v => ({ ...v, cvv: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            {payment === 'paypal' && (
              <div className="co-paypal-msg">
                <p>سيتم تحويلك إلى PayPal لإتمام الدفع بعد تأكيد الطلب.</p>
                <p><small>You will be redirected to PayPal to complete your payment.</small></p>
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
              <ul className="co-items">
                {cartItems.map(item => (
                  <li key={item.id} className="co-item">
                    <div className="co-item-info">
                      <span className="co-item-name">{item.name}</span>
                      <span className="co-item-price">{(item.price * item.quantity).toLocaleString('ar-SA')} ₪</span>
                      <div className="co-qty">
                        <button type="button" onClick={() => updateCartQty(item.id, item.quantity - 1)}
                          disabled={item.quantity <= 1}>−</button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => updateCartQty(item.id, item.quantity + 1)}>+</button>
                      </div>
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
