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
import LocationPicker, { type PlaceMeta } from '../../components/LocationPicker';
import { fetchZones, pointInZone, zoneCenter, type Zone } from '../../lib/zones';
import { useFieldHint } from '../auth/useFieldHint';
import { EMAIL_RE, ARABIC_RE, parsePhone } from '../../lib/formValidation';
import './CheckoutPage.css';

type PaymentMethod = 'paytabs' | null;

export default function CheckoutPage() {
  const { cartItems, removeFromCart, updateCartQty } = useShop();
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

  // Phone is edited via a split control (country code + "05" prefix + 8 digits)
  // and recomposed into formData.phone. Inline hints mirror the application forms.
  const [phoneCode, setPhoneCode]   = useState('970');
  const [phoneLocal, setPhoneLocal] = useState('');
  const phoneHint     = useFieldHint();
  const firstNameHint = useFieldHint();
  const lastNameHint  = useFieldHint();
  const emailHint     = useFieldHint();

  const [payment, setPayment] = useState<PaymentMethod>(null);
  const [paying, setPaying]   = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // ── Delivery zone + exact location ────────────────────────────────────
  const [zones, setZones] = useState<Zone[]>([]);
  // Whether the customer is editing the address (vs. using the saved default).
  const [editingAddress, setEditingAddress] = useState(false);

  useEffect(() => {
    fetchZones().then(setZones).catch(() => setZones([]));
  }, []);

  const selectedZone = zones.find(z => z.id === formData.dropoffZoneId) ?? null;
  const hasPin = formData.latitude != null && formData.longitude != null;

  // Live, client-side mirror of the server's point-in-zone check, so the customer
  // gets instant feedback. The server re-validates authoritatively on submit.
  const pinOutsideZone =
    selectedZone != null && hasPin &&
    !pointInZone(selectedZone, formData.latitude as number, formData.longitude as number);

  // A saved default address exists when the profile carries a zone + a pin.
  const hasSavedAddress = !!originalData.dropoffZoneId &&
    originalData.latitude != null && originalData.longitude != null;

  // ── Auto-fill: pull the saved profile once when the page opens ─────────
  useEffect(() => {
    if (!customer) return; // checkout is customer-gated, but stay defensive
    let cancelled = false;

    (async () => {
      try {
        const profile = await fetchProfile();
        if (cancelled) return;
        // Normalise the saved phone into the split control's canonical form so
        // the recomposed value doesn't read as an "edit" against the baseline.
        const { code, local } = parsePhone(profile.phone);
        setPhoneCode(code);
        setPhoneLocal(local);
        const normalized = { ...profile, phone: local ? `${code}5${local}` : '' };
        setFormData(normalized);
        setOriginalData(normalized); // baseline for change detection
        // Start in "use saved address" mode only if a complete one exists.
        const savedComplete = !!profile.dropoffZoneId && profile.latitude != null && profile.longitude != null;
        setEditingAddress(!savedComplete);
      } catch {
        // No saved profile / network issue → leave the form blank; not fatal.
      }
      if (!cancelled && customer.email) setEmail(customer.email);
    })();

    return () => { cancelled = true; };
  }, [customer]);

  // Change detection: true the moment ANY monitored field diverges from the
  // originally fetched profile. Recomputed every render — cheap (7 string ==).
  // Drives whether we persist the form back to the profile on submit.
  const hasChanges = !profilesEqual(formData, originalData);

  // One-liner field updater for every shipping/contact input.
  const update = (field: keyof ProfileData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  // Zone dropdown → store both id and name (name groups shipments into batches).
  const onZoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const z = zones.find(zz => zz.id === e.target.value) ?? null;
    setFormData(prev => ({ ...prev, dropoffZoneId: z?.id ?? null, dropoffZone: z?.name ?? '' }));
  };

  // Map pin updates: store coordinates + any place metadata from a search.
  const onPinChange = (lat: number, lng: number, meta?: PlaceMeta) => {
    setFormData(prev => ({
      ...prev,
      latitude: lat,
      longitude: lng,
      placeId: meta?.placeId ?? '',
      formattedAddress: meta?.formattedAddress ?? prev.formattedAddress,
    }));
  };

  const handlePay = async () => {
    if (!customer) { navigate('/login'); return; }
    if (!payment)  { setPayError('الرجاء اختيار طريقة الدفع'); return; }
    if (activeItems.length === 0) { setPayError('لا توجد منتجات متاحة للشراء في سلتك'); return; }

    // Contact validation (fail fast for a better UX).
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setPayError('يرجى إدخال الاسم الأول والأخير');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setPayError('يرجى إدخال بريد إلكتروني صحيح (مثال: example@email.com)');
      return;
    }
    if (phoneLocal.length !== 8) {
      setPayError('رقم الهاتف غير صحيح — أدخل 8 أرقام بعد 05');
      return;
    }

    // Delivery destination is required + must be a pin inside the chosen zone
    // (the server re-validates, but fail fast for a better UX).
    if (!formData.dropoffZoneId || formData.latitude == null || formData.longitude == null) {
      setPayError('يرجى اختيار منطقة التوصيل وتحديد الموقع على الخريطة');
      return;
    }
    if (pinOutsideZone) {
      setPayError('الموقع المحدد خارج حدود المنطقة المختارة. يرجى تغيير المنطقة أو تعديل الموقع.');
      return;
    }
    if (!formData.deliveryDescription.trim()) {
      setPayError('يرجى إدخال تعليمات التوصيل لمساعدة المندوب في الوصول إليك');
      return;
    }

    setPaying(true);
    setPayError(null);

    // Build the contact + shipping payloads the order/payment APIs expect from
    // the profile-shaped form.
    const contact  = { firstName: formData.firstName, lastName: formData.lastName, email, phone: formData.phone };
    // Free-text snapshot (shown on order history / tracking). Derived from the new
    // structured fields: formatted address as the address line, zone as the city.
    const shipping = {
      address:    formData.formattedAddress || formData.deliveryDescription,
      apartment:  '',
      city:       formData.dropoffZone,
      postalCode: '',
    };
    // Structured delivery destination → drives zone-based batching + routing.
    const dropoff = {
      zone_id:           formData.dropoffZoneId,
      zone:              formData.dropoffZone,
      lat:               formData.latitude,
      lng:               formData.longitude,
      place_id:          formData.placeId,
      formatted_address: formData.formattedAddress,
      description:       formData.deliveryDescription,
    };

    // Always persist the contact + address back to the customer's profile so it
    // is kept in their personal settings for next time. Runs IN PARALLEL with
    // placing the order; best-effort — a save failure must never block the
    // purchase, so we swallow its error and only log it.
    const profileSave =
      hasChanges
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
          items:    activeItems.map(item => ({ product_id: String(item.productId), qty: item.quantity })),
          shipping,
          contact, // persisted with the order as the shipping-address snapshot
          dropoff,  // structured delivery zone + exact pin (validated server-side)
        }),
      });
      const orderJson = await orderResp.json().catch(() => ({}));
      if (!orderResp.ok || !orderJson.ok || !orderJson.order_id) {
        throw new Error(orderJson.error || 'فشل إنشاء الطلب');
      }
      const orderId = orderJson.order_id;

      // 2. Online card payment — hand off to the PayTabs Hosted Payment Page.
      //    This is the only supported payment method; COD is not offered.
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
      await profileSave; // let the parallel profile save settle before leaving
      window.location.href = json.redirect_url; // → PayTabs Hosted Payment Page
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
      <div className="co-shell">
        <nav className="co-breadcrumb">
          <a onClick={() => navigate('/home')}>الرئيسية</a>
          <span className="material-symbols-outlined">chevron_left</span>
          <a onClick={() => navigate('/cart')}>السلة</a>
          <span className="material-symbols-outlined">chevron_left</span>
          <span className="current">إتمام الطلب</span>
        </nav>
        <h1 className="co-page-title">إتمام الطلب</h1>
        <div className="co-wrap">

        {/* ── RIGHT: Form ── */}
        <div className="co-form-side">

          {/* Contact Info */}
          <section className="co-section">
            <h2 className="co-section-title">
              <span className="material-symbols-outlined">person</span>
              معلومات التواصل
            </h2>
            <div className="co-row">
              <div className="co-field">
                <label>الاسم الأول <span className="co-req">*</span></label>
                <input
                  placeholder="أدخل الاسم الأول"
                  value={formData.firstName}
                  onChange={e => {
                    const raw = e.target.value;
                    if (/[0-9]/.test(raw)) firstNameHint.show('لا يُسمح بالأرقام في هذا الحقل');
                    else firstNameHint.clear();
                    setFormData(prev => ({ ...prev, firstName: raw.replace(/[0-9]/g, '') }));
                  }}
                />
                {firstNameHint.hint && <p className="co-field-hint">{firstNameHint.hint}</p>}
              </div>
              <div className="co-field">
                <label>الاسم الأخير <span className="co-req">*</span></label>
                <input
                  placeholder="أدخل الاسم الأخير"
                  value={formData.lastName}
                  onChange={e => {
                    const raw = e.target.value;
                    if (/[0-9]/.test(raw)) lastNameHint.show('لا يُسمح بالأرقام في هذا الحقل');
                    else lastNameHint.clear();
                    setFormData(prev => ({ ...prev, lastName: raw.replace(/[0-9]/g, '') }));
                  }}
                />
                {lastNameHint.hint && <p className="co-field-hint">{lastNameHint.hint}</p>}
              </div>
            </div>
            <div className="co-field">
              <label>البريد الإلكتروني <span className="co-req">*</span></label>
              <input
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={e => {
                  const raw = e.target.value;
                  if (ARABIC_RE.test(raw)) emailHint.show('لا يُسمح بالأحرف العربية في البريد الإلكتروني');
                  else emailHint.clear();
                  setEmail(raw.replace(ARABIC_RE, ''));
                }}
                onBlur={() => {
                  if (email.trim() && !EMAIL_RE.test(email.trim())) {
                    emailHint.show('بريد إلكتروني غير صحيح — مثال: example@email.com');
                  } else {
                    emailHint.clear();
                  }
                }}
              />
              {emailHint.hint && <p className="co-field-hint">{emailHint.hint}</p>}
            </div>
            <div className="co-field">
              <label>رقم الهاتف <span className="co-req">*</span></label>
              <div className="co-phone-split" dir="ltr">
                <select
                  title="رمز الدولة"
                  className="co-phone-code"
                  value={phoneCode}
                  onChange={e => {
                    const code = e.target.value;
                    setPhoneCode(code);
                    setFormData(prev => ({ ...prev, phone: phoneLocal ? `${code}5${phoneLocal}` : '' }));
                  }}
                >
                  <option value="970">+970</option>
                  <option value="972">+972</option>
                </select>
                <span className="co-phone-prefix">05</span>
                <input
                  type="text"
                  className="co-phone-local"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="XXXXXXXX"
                  value={phoneLocal}
                  onChange={e => {
                    const raw = e.target.value;
                    const digits = raw.replace(/\D/g, '');
                    if (/[^\d]/.test(raw)) phoneHint.show('أرقام فقط');
                    else if (digits.length > 8) phoneHint.show('الحد الأقصى 8 أرقام');
                    else phoneHint.clear();
                    const local = digits.slice(0, 8);
                    setPhoneLocal(local);
                    setFormData(prev => ({ ...prev, phone: local ? `${phoneCode}5${local}` : '' }));
                  }}
                />
              </div>
              {phoneHint.hint && <p className="co-field-hint">{phoneHint.hint}</p>}
            </div>
          </section>

          {/* Delivery */}
          <section className="co-section">
            <h2 className="co-section-title">
              <span className="material-symbols-outlined">local_shipping</span>
              عنوان التوصيل
            </h2>

            {/* Saved default address — shown as a selectable card when complete. */}
            {hasSavedAddress && !editingAddress ? (
              <div className="co-saved-addr">
                <div className="co-saved-addr-main">
                  <span className="material-symbols-outlined co-saved-addr-icon">home_pin</span>
                  <div className="co-saved-addr-text">
                    <strong>{originalData.dropoffZone || 'العنوان المحفوظ'}</strong>
                    {originalData.formattedAddress && <span>{originalData.formattedAddress}</span>}
                    {originalData.deliveryDescription && (
                      <span className="co-saved-addr-note">{originalData.deliveryDescription}</span>
                    )}
                  </div>
                </div>
                <button type="button" className="co-addr-edit-btn" onClick={() => setEditingAddress(true)}>
                  <span className="material-symbols-outlined">edit_location_alt</span>
                  تغيير العنوان
                </button>
              </div>
            ) : (
              <>
                {hasSavedAddress && (
                  <button
                    type="button"
                    className="co-addr-back-btn"
                    onClick={() => { setFormData(originalData); setEditingAddress(false); }}
                  >
                    <span className="material-symbols-outlined">arrow_forward</span>
                    استخدام العنوان المحفوظ
                  </button>
                )}

                {/* 1. Zone — drives shipment grouping into delivery batches. */}
                <div className="co-field">
                  <label>المنطقة <span className="co-req">*</span></label>
                  <select
                    className="co-select"
                    title="منطقة التوصيل"
                    value={formData.dropoffZoneId ?? ''}
                    onChange={onZoneChange}
                  >
                    <option value="">اختر المنطقة</option>
                    {zones.map(z => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>

                {/* 2. Exact location — search a place, use my location, or pick on the map. */}
                <div className="co-field">
                  <label>الموقع على الخريطة <span className="co-req">*</span></label>
                  <LocationPicker
                    value={{ lat: formData.latitude, lng: formData.longitude }}
                    onChange={onPinChange}
                    recenterTo={selectedZone ? zoneCenter(selectedZone) : null}
                  />
                  {pinOutsideZone && (
                    <div className="co-zone-warning">
                      <span className="material-symbols-outlined">warning</span>
                      الموقع المحدد خارج حدود المنطقة المختارة. غيّر المنطقة أو حرّك المؤشر داخلها.
                    </div>
                  )}
                </div>

                {/* 3. Additional courier directions. */}
                <div className="co-field">
                  <label>تعليمات التوصيل <span className="co-req">*</span></label>
                  <textarea
                    className="co-textarea"
                    rows={3}
                    placeholder="اسم الشارع، رقم العمارة، أو أي وصف يساعد المندوب في الوصول إليك بسهولة"
                    value={formData.deliveryDescription}
                    onChange={update('deliveryDescription')}
                  />
                </div>

                {/* Details are always saved back to the customer's profile. */}
                <p className="co-save-note">
                  <span className="material-symbols-outlined">cloud_done</span>
                  سيتم حفظ هذه البيانات في إعداداتك الشخصية لاستخدامها في طلباتك القادمة
                </p>
              </>
            )}
          </section>

          {/* Payment */}
          <section className="co-section">
            <h2 className="co-section-title">
              <span className="material-symbols-outlined">payments</span>
              الدفع
            </h2>
            <div className="co-payment-options">
              <button
                type="button"
                className={`co-pay-opt ${payment === 'paytabs' ? 'active' : ''}`}
                onClick={() => setPayment('paytabs')}
              >
                <span className="material-symbols-outlined co-pay-icon">credit_card</span>
                <span>الدفع التجريبي عبر PayTabs<small>PayTabs Test Payment</small></span>
              </button>
            </div>

            {payment === 'paytabs' && (
              <div className="co-paypal-msg">
                <p>سيتم تحويلك إلى صفحة الدفع الآمنة الخاصة بـ PayTabs لإتمام عملية الدفع (وضع الاختبار).</p>
                <p><small>You will be redirected to the secure PayTabs page to complete your payment (test mode).</small></p>
              </div>
            )}
          </section>
        </div>

        {/* ── LEFT: Order Summary ── */}
        <div className="co-summary-side">
          <div className="co-summary-box">
            <h2 className="co-summary-title">
              <span className="material-symbols-outlined">receipt_long</span>
              ملخص الطلب
            </h2>

            {cartItems.length === 0 ? (
              <p className="co-empty">السلة فارغة</p>
            ) : (
              <>
                {hasDeleted && (
                  <div className="co-deleted-warning">
                    <span className="material-symbols-outlined">warning</span>
                    بعض المنتجات في سلتك لم تعد متاحة وستُستثنى من الطلب
                  </div>
                )}
                <ul className="co-items">
                  {cartItems.map(item => (
                    <li key={item.id} className={`co-item${item.isDeleted ? ' co-item--deleted' : ''}`}>
                      <div className="co-item-info">
                        <span className="co-item-name">{item.name}</span>
                        {item.isDeleted ? (
                          <span className="co-item-deleted-msg">
                            <span className="material-symbols-outlined">warning</span>
                            تم حذف هذا المنتج من قبل التاجر
                          </span>
                        ) : (
                          <>
                            <span className="co-item-price">{(item.price * item.quantity).toLocaleString('ar-SA')} ₪</span>
                            <div className="co-qty">
                              <button type="button" onClick={() => updateCartQty(item.id, item.quantity - 1)}
                                disabled={item.quantity <= 1} aria-label="إنقاص">
                                <span className="material-symbols-outlined">remove</span>
                              </button>
                              <span>{item.quantity}</span>
                              <button type="button" onClick={() => updateCartQty(item.id, item.quantity + 1)} aria-label="زيادة">
                                <span className="material-symbols-outlined">add</span>
                              </button>
                            </div>
                          </>
                        )}
                        <button type="button" className="co-remove" onClick={() => removeFromCart(item.id)}>
                          <span className="material-symbols-outlined">delete</span>
                          إزالة
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

          {payError && (
            <div className="co-pay-error">
              <span className="material-symbols-outlined">error</span>
              {payError}
            </div>
          )}
          <button type="button" className="co-pay-btn" onClick={handlePay} disabled={paying}>
            <span className="material-symbols-outlined">lock</span>
            {paying ? 'جارٍ المعالجة…' : 'ادفع الآن'}
          </button>
          <p className="co-trust">
            <span className="material-symbols-outlined">verified_user</span>
            دفع آمن ومشفّر — بياناتك محمية
          </p>
        </div>

        </div>
      </div>
    </div>
  );
}
