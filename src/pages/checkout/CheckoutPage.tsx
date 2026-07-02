import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useLanguage } from '../../context/LanguageContext';
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
  const { t } = useTranslation('cart-checkout');
  const { direction } = useLanguage();
  const { cartItems, removeFromCart, updateCartQty } = useShop();
  const { customer } = useCustomerAuth();
  const navigate     = useNavigate();

  const [formData, setFormData]         = useState<ProfileData>(emptyProfile());
  const [originalData, setOriginalData] = useState<ProfileData>(emptyProfile());
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phoneCode, setPhoneCode]   = useState('970');
  const [phoneLocal, setPhoneLocal] = useState('');
  const phoneHint     = useFieldHint();
  const firstNameHint = useFieldHint();
  const lastNameHint  = useFieldHint();
  const emailHint     = useFieldHint();

  const [payment, setPayment] = useState<PaymentMethod>(null);
  const [paying, setPaying]   = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [editingAddress, setEditingAddress] = useState(false);

  useEffect(() => {
    fetchZones().then(setZones).catch(() => setZones([]));
  }, []);

  const selectedZone = zones.find(z => z.id === formData.dropoffZoneId) ?? null;
  const hasPin = formData.latitude != null && formData.longitude != null;

  const pinOutsideZone =
    selectedZone != null && hasPin &&
    !pointInZone(selectedZone, formData.latitude as number, formData.longitude as number);

  const hasSavedAddress = !!originalData.dropoffZoneId &&
    originalData.latitude != null && originalData.longitude != null;

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await fetchProfile();
        if (cancelled) return;
        const { code, local } = parsePhone(profile.phone);
        setPhoneCode(code);
        setPhoneLocal(local);
        const normalized = { ...profile, phone: local ? `${code}5${local}` : '' };
        setFormData(normalized);
        setOriginalData(normalized);
        const savedComplete = !!profile.dropoffZoneId && profile.latitude != null && profile.longitude != null;
        setEditingAddress(!savedComplete);
      } catch {
        // No saved profile / network issue → leave the form blank; not fatal.
      }
      if (!cancelled && customer.email) setEmail(customer.email);
    })();

    return () => { cancelled = true; };
  }, [customer]);

  const hasChanges = !profilesEqual(formData, originalData);

  const update = (field: keyof ProfileData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const onZoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const z = zones.find(zz => zz.id === e.target.value) ?? null;
    setFormData(prev => ({ ...prev, dropoffZoneId: z?.id ?? null, dropoffZone: z?.name ?? '' }));
  };

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
    if (!payment)  { setPayError(t('checkout.errors.selectPayment')); return; }
    if (activeItems.length === 0) { setPayError(t('checkout.errors.noItems')); return; }

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setPayError(t('checkout.errors.nameRequired'));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setPayError(t('checkout.errors.emailInvalid'));
      return;
    }
    if (phoneLocal.length !== 8) {
      setPayError(t('checkout.errors.phoneInvalid'));
      return;
    }

    if (!formData.dropoffZoneId || formData.latitude == null || formData.longitude == null) {
      setPayError(t('checkout.errors.locationRequired'));
      return;
    }
    if (pinOutsideZone) {
      setPayError(t('checkout.errors.pinOutsideZone'));
      return;
    }
    if (!formData.deliveryDescription.trim()) {
      setPayError(t('checkout.errors.instructionsRequired'));
      return;
    }

    setPaying(true);
    setPayError(null);

    const contact  = { firstName: formData.firstName, lastName: formData.lastName, email, phone: formData.phone };
    const shipping = {
      address:    formData.formattedAddress || formData.deliveryDescription,
      apartment:  '',
      city:       formData.dropoffZone,
      postalCode: '',
    };
    const dropoff = {
      zone_id:           formData.dropoffZoneId,
      zone:              formData.dropoffZone,
      lat:               formData.latitude,
      lng:               formData.longitude,
      place_id:          formData.placeId,
      formatted_address: formData.formattedAddress,
      description:       formData.deliveryDescription,
    };

    const profileSave =
      hasChanges
        ? saveProfile(formData)
            .then(() => setOriginalData(formData))
            .catch((err) => console.error('[checkout] profile save failed:', err))
        : Promise.resolve();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const authHeaders = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const orderResp = await fetch('/api/orders/create', {
        method:  'POST',
        headers: authHeaders,
        body: JSON.stringify({
          items:    activeItems.map(item => ({ product_id: String(item.productId), qty: item.quantity })),
          shipping,
          contact,
          dropoff,
        }),
      });
      const orderJson = await orderResp.json().catch(() => ({}));
      if (!orderResp.ok || !orderJson.ok || !orderJson.order_id) {
        throw new Error(orderJson.error || t('checkout.errors.orderFailed'));
      }
      const orderId = orderJson.order_id;

      const resp = await fetch('/api/payments/paytabs/create', {
        method:  'POST',
        headers: authHeaders,
        body: JSON.stringify({ order_id: orderId, contact, shipping }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok || !json.redirect_url) {
        throw new Error(json.error || t('checkout.errors.paymentFailed'));
      }

      localStorage.setItem('paytabs_pending_order_id', String(orderId));
      localStorage.setItem(
        'paytabs_pending_item_ids',
        JSON.stringify(activeItems.map(item => item.id)),
      );
      await profileSave;
      window.location.href = json.redirect_url;
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : t('checkout.errors.genericError'));
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
    <div className="co-page" dir={direction}>
      <Topbar />
      <div className="co-shell">
        <nav className="co-breadcrumb">
          <a onClick={() => navigate('/home')}>{t('checkout.breadcrumb.home')}</a>
          <span className="material-symbols-outlined">chevron_left</span>
          <a onClick={() => navigate('/cart')}>{t('checkout.breadcrumb.cart')}</a>
          <span className="material-symbols-outlined">chevron_left</span>
          <span className="current">{t('checkout.breadcrumb.current')}</span>
        </nav>
        <h1 className="co-page-title">{t('checkout.title')}</h1>
        <div className="co-wrap">

        {/* ── RIGHT: Form ── */}
        <div className="co-form-side">

          {/* Contact Info */}
          <section className="co-section">
            <h2 className="co-section-title">
              <span className="material-symbols-outlined">person</span>
              {t('checkout.contact.title')}
            </h2>
            <div className="co-row">
              <div className="co-field">
                <label>{t('checkout.contact.firstName')} <span className="co-req">*</span></label>
                <input
                  placeholder={t('checkout.contact.firstNamePlaceholder')}
                  value={formData.firstName}
                  onChange={e => {
                    const raw = e.target.value;
                    if (/[0-9]/.test(raw)) firstNameHint.show(t('checkout.errors.noNumbers'));
                    else firstNameHint.clear();
                    setFormData(prev => ({ ...prev, firstName: raw.replace(/[0-9]/g, '') }));
                  }}
                />
                {firstNameHint.hint && <p className="co-field-hint">{firstNameHint.hint}</p>}
              </div>
              <div className="co-field">
                <label>{t('checkout.contact.lastName')} <span className="co-req">*</span></label>
                <input
                  placeholder={t('checkout.contact.lastNamePlaceholder')}
                  value={formData.lastName}
                  onChange={e => {
                    const raw = e.target.value;
                    if (/[0-9]/.test(raw)) lastNameHint.show(t('checkout.errors.noNumbers'));
                    else lastNameHint.clear();
                    setFormData(prev => ({ ...prev, lastName: raw.replace(/[0-9]/g, '') }));
                  }}
                />
                {lastNameHint.hint && <p className="co-field-hint">{lastNameHint.hint}</p>}
              </div>
            </div>
            <div className="co-field">
              <label>{t('checkout.contact.email')} <span className="co-req">*</span></label>
              <input
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={e => {
                  const raw = e.target.value;
                  if (ARABIC_RE.test(raw)) emailHint.show(t('checkout.errors.noArabic'));
                  else emailHint.clear();
                  setEmail(raw.replace(ARABIC_RE, ''));
                }}
                onBlur={() => {
                  if (email.trim() && !EMAIL_RE.test(email.trim())) {
                    emailHint.show(t('checkout.errors.emailFormat'));
                  } else {
                    emailHint.clear();
                  }
                }}
              />
              {emailHint.hint && <p className="co-field-hint">{emailHint.hint}</p>}
            </div>
            <div className="co-field">
              <label>{t('checkout.contact.phone')} <span className="co-req">*</span></label>
              <div className="co-phone-split" dir="ltr">
                <select
                  title={t('checkout.contact.countryCode')}
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
                    if (/[^\d]/.test(raw)) phoneHint.show(t('checkout.errors.digitsOnly'));
                    else if (digits.length > 8) phoneHint.show(t('checkout.errors.maxDigits'));
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
              {t('checkout.delivery.title')}
            </h2>

            {hasSavedAddress && !editingAddress ? (
              <div className="co-saved-addr">
                <div className="co-saved-addr-main">
                  <span className="material-symbols-outlined co-saved-addr-icon">home_pin</span>
                  <div className="co-saved-addr-text">
                    <strong>{originalData.dropoffZone || t('checkout.delivery.savedAddress')}</strong>
                    {originalData.formattedAddress && <span>{originalData.formattedAddress}</span>}
                    {originalData.deliveryDescription && (
                      <span className="co-saved-addr-note">{originalData.deliveryDescription}</span>
                    )}
                  </div>
                </div>
                <button type="button" className="co-addr-edit-btn" onClick={() => setEditingAddress(true)}>
                  <span className="material-symbols-outlined">edit_location_alt</span>
                  {t('checkout.delivery.changeAddress')}
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
                    {t('checkout.delivery.useSavedAddress')}
                  </button>
                )}

                <div className="co-field">
                  <label>{t('checkout.delivery.zone')} <span className="co-req">*</span></label>
                  <select
                    className="co-select"
                    title={t('checkout.delivery.zone')}
                    value={formData.dropoffZoneId ?? ''}
                    onChange={onZoneChange}
                  >
                    <option value="">{t('checkout.delivery.zoneSelect')}</option>
                    {zones.map(z => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>

                <div className="co-field">
                  <label>{t('checkout.delivery.mapLocation')} <span className="co-req">*</span></label>
                  <LocationPicker
                    value={{ lat: formData.latitude, lng: formData.longitude }}
                    onChange={onPinChange}
                    recenterTo={selectedZone ? zoneCenter(selectedZone) : null}
                  />
                  {pinOutsideZone && (
                    <div className="co-zone-warning">
                      <span className="material-symbols-outlined">warning</span>
                      {t('checkout.delivery.outsideZone')}
                    </div>
                  )}
                </div>

                <div className="co-field">
                  <label>{t('checkout.delivery.instructions')} <span className="co-req">*</span></label>
                  <textarea
                    className="co-textarea"
                    rows={3}
                    placeholder={t('checkout.delivery.instructionsPlaceholder')}
                    value={formData.deliveryDescription}
                    onChange={update('deliveryDescription')}
                  />
                </div>

                <p className="co-save-note">
                  <span className="material-symbols-outlined">cloud_done</span>
                  {t('checkout.delivery.saveNote')}
                </p>
              </>
            )}
          </section>

          {/* Payment */}
          <section className="co-section">
            <h2 className="co-section-title">
              <span className="material-symbols-outlined">payments</span>
              {t('checkout.payment.title')}
            </h2>
            <div className="co-payment-options">
              <button
                type="button"
                className={`co-pay-opt ${payment === 'paytabs' ? 'active' : ''}`}
                onClick={() => setPayment('paytabs')}
              >
                <span className="material-symbols-outlined co-pay-icon">credit_card</span>
                <span>{t('checkout.payment.paytabsLabel')}<small>PayTabs Test Payment</small></span>
              </button>
            </div>

            {payment === 'paytabs' && (
              <div className="co-paypal-msg">
                <p>{t('checkout.payment.paytabsNote')}</p>
                <p><small>{t('checkout.payment.paytabsNoteEn')}</small></p>
              </div>
            )}
          </section>
        </div>

        {/* ── LEFT: Order Summary ── */}
        <div className="co-summary-side">
          <div className="co-summary-box">
            <h2 className="co-summary-title">
              <span className="material-symbols-outlined">receipt_long</span>
              {t('checkout.summary.title')}
            </h2>

            {cartItems.length === 0 ? (
              <p className="co-empty">{t('checkout.summary.empty')}</p>
            ) : (
              <>
                {hasDeleted && (
                  <div className="co-deleted-warning">
                    <span className="material-symbols-outlined">warning</span>
                    {t('checkout.summary.deletedWarning')}
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
                            {t('checkout.summary.deletedByMerchant')}
                          </span>
                        ) : (
                          <>
                            <span className="co-item-price">{(item.price * item.quantity).toLocaleString()} ₪</span>
                            <div className="co-qty">
                              <button type="button" onClick={() => updateCartQty(item.id, item.quantity - 1)}
                                disabled={item.quantity <= 1} aria-label={t('checkout.summary.decrement')}>
                                <span className="material-symbols-outlined">remove</span>
                              </button>
                              <span>{item.quantity}</span>
                              <button type="button" onClick={() => updateCartQty(item.id, item.quantity + 1)} aria-label={t('checkout.summary.increment')}>
                                <span className="material-symbols-outlined">add</span>
                              </button>
                            </div>
                          </>
                        )}
                        <button type="button" className="co-remove" onClick={() => removeFromCart(item.id)}>
                          <span className="material-symbols-outlined">delete</span>
                          {t('checkout.summary.removeItem')}
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
                <span className="co-total-label">{t('checkout.summary.subtotal')}</span>
                <span className="co-total-val">{subtotal.toLocaleString()} ₪</span>
              </div>
              <div className="co-total-row">
                <span className="co-total-label">{t('checkout.summary.delivery')}</span>
                <span className="co-total-val">{DELIVERY_COST.toLocaleString()} ₪</span>
              </div>
              <div className="co-total-row">
                <span className="co-total-label">{t('checkout.summary.discount')}</span>
                <span className="co-total-val co-discount">— ₪</span>
              </div>
              <div className="co-divider" />
              <div className="co-total-row co-grand">
                <span className="co-total-label">{t('checkout.summary.total')}</span>
                <span className="co-total-val">{total.toLocaleString()} ₪</span>
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
            {paying ? t('checkout.actions.paying') : t('checkout.actions.pay')}
          </button>
          <p className="co-trust">
            <span className="material-symbols-outlined">verified_user</span>
            {t('checkout.actions.secure')}
          </p>
        </div>

        </div>
      </div>
    </div>
  );
}
