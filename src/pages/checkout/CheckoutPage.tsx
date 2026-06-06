import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import {
  fetchProfile,
  saveProfile,
  emptyProfile,
  profilesEqual,
  type ProfileData,
} from '../../lib/profile';
import supabase from '../../lib/supabase';
import Topbar from '../../components/Topbar';
import './CheckoutPage.css';

type PaymentMethod = 'paytabs' | 'cod' | null;

export default function CheckoutPage() {
  const { cartItems, removeFromCart, updateCartQty, removeItemsFromCart } = useShop();
  const { customer } = useCustomerAuth();
  const navigate     = useNavigate();

  // ── Profile-backed shipping form (Phase 2) ────────────────────────────
  // formData    : the LIVE form the user edits.
  // originalData: an immutable snapshot of what we auto-filled from the saved
  //               profile. We compare formData against it to detect edits.
  const [formData, setFormData]         = useState<ProfileData>(emptyProfile());
  const [originalData, setOriginalData] = useState<ProfileData>(emptyProfile());

  // Email is owned by the auth account, not the profile — kept as its own field.
  const [email, setEmail] = useState(customer?.email ?? '');

  // When the form differs from the saved profile, offer to save it as default.
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const [payment, setPayment] = useState<PaymentMethod>(null);
  const [paying, setPaying]   = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // ── Auto-fill: pull the saved profile once when the page opens ─────────
  useEffect(() => {
    if (!customer) return; // checkout is customer-gated, but stay defensive
    let cancelled = false;

    (async () => {
      try {
        const profile = await fetchProfile();
        if (cancelled) return;
        setFormData(profile);
        setOriginalData(profile); // baseline for change detection
      } catch {
        // No saved profile / network issue → leave the form blank; not fatal.
      }
      if (!cancelled && customer.email) setEmail(customer.email);
    })();

    return () => { cancelled = true; };
  }, [customer]);

  // Change detection: true the moment ANY monitored field diverges from the
  // originally fetched profile. Recomputed every render — cheap (7 string ==).
  const hasChanges = !profilesEqual(formData, originalData);

  // If the user reverts every edit back to the saved values, the checkbox
  // disappears again — so also clear its checked state to avoid a hidden "on".
  useEffect(() => {
    if (!hasChanges && saveAsDefault) setSaveAsDefault(false);
  }, [hasChanges, saveAsDefault]);

  // One-liner field updater for every shipping/contact input.
  const update = (field: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const handlePay = async () => {
    if (!customer) { navigate('/login'); return; }
    if (!payment)  { setPayError('الرجاء اختيار طريقة الدفع'); return; }
    if (activeItems.length === 0) { setPayError('لا توجد منتجات متاحة للشراء في سلتك'); return; }

    setPaying(true);
    setPayError(null);

    // Build the contact + shipping payloads the order/payment APIs expect from
    // the profile-shaped form.
    const contact  = { firstName: formData.firstName, lastName: formData.lastName, email, phone: formData.phone };
    const shipping = {
      address:    formData.street,
      apartment:  formData.apartment,
      city:       formData.city,
      postalCode: formData.postalCode,
    };

    // Phase 2 — save on submit: if the user edited their details AND ticked the
    // box, persist the new profile IN PARALLEL with placing the order. This is
    // best-effort: a profile-save failure must never block the purchase, so we
    // swallow its error and only log it.
    const profileSave =
      saveAsDefault && hasChanges
        ? saveProfile(formData)
            .then(() => setOriginalData(formData)) // new baseline once saved
            .catch((err) => console.error('[checkout] profile save failed:', err))
        : Promise.resolve();

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
          contact, // persisted with the order as the shipping-address snapshot
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

        // Remember which order we're paying — plus the exact cart items in it —
        // so the return page can clear ONLY the paid-for items, and only once
        // the payment is actually confirmed. Do NOT clear the cart here: the
        // customer hasn't paid yet and may abandon the PayTabs page.
        localStorage.setItem('paytabs_pending_order_id', String(orderId));
        localStorage.setItem(
          'paytabs_pending_item_ids',
          JSON.stringify(activeItems.map(item => item.id)),
        );
        window.location.href = json.redirect_url; // → PayTabs Hosted Payment Page
        return;
      }

      // Cash on Delivery — order already marked 'cod' server-side; the order is
      // confirmed now, so clear only the purchased items from the cart.
      removeItemsFromCart(activeItems.map(item => item.id));
      await profileSave; // let the parallel profile save settle before leaving
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
                <input placeholder="أدخل الاسم الأول" value={formData.firstName}
                  onChange={update('firstName')} />
              </div>
              <div className="co-field">
                <label>الاسم الأخير</label>
                <input placeholder="أدخل الاسم الأخير" value={formData.lastName}
                  onChange={update('lastName')} />
              </div>
            </div>
            <div className="co-field">
              <label>البريد الإلكتروني</label>
              <input type="email" placeholder="example@email.com" value={email}
                onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="co-field">
              <label>رقم الهاتف</label>
              <input type="tel" placeholder="+970 5x xxx xxxx" value={formData.phone}
                onChange={update('phone')} />
            </div>
          </section>

          {/* Delivery */}
          <section className="co-section">
            <h2 className="co-section-title">التوصيل والشحن</h2>
            <div className="co-field">
              <label>العنوان</label>
              <input placeholder="اسم الشارع ورقم المنزل" value={formData.street}
                onChange={update('street')} />
            </div>
            <div className="co-field">
              <label>الشقة / الدور (اختياري)</label>
              <input placeholder="رقم الشقة أو الدور" value={formData.apartment}
                onChange={update('apartment')} />
            </div>
            <div className="co-row">
              <div className="co-field">
                <label>المدينة</label>
                <input placeholder="مثال: رام الله" value={formData.city}
                  onChange={update('city')} />
              </div>
              <div className="co-field">
                <label>الرمز البريدي</label>
                <input placeholder="12345" value={formData.postalCode}
                  onChange={update('postalCode')} />
              </div>
            </div>

            {/* Dynamic "save as default" checkbox — only rendered once the user
                has changed something vs. their saved profile (hasChanges). */}
            {hasChanges && (
              <label className="co-save-default">
                <input
                  type="checkbox"
                  checked={saveAsDefault}
                  onChange={e => setSaveAsDefault(e.target.checked)}
                />
                <span>حفظ هذا العنوان كعنوان افتراضي في حسابي للطلبات القادمة</span>
              </label>
            )}
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
