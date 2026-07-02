import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProductListTemplate from '../components/ProductListTemplate';
import ProductRow from '../components/ProductRow';
import QuantitySelector from '../components/QuantitySelector';
import Topbar from '../components/Topbar';
import CartConfirmModal from '../components/CartConfirmModal';
import { useShop } from '../context/ShopContext';
import type { CartItem } from '../context/ShopContext';
import '../styles/productTable.css';

const SHIPPING_COST = 15;
const TAX_RATE = 0.1;

const VALID_COUPONS: Record<string, number> = {
  SAVE10: 10,
  SALE20: 20,
  'خصم15': 15,
};

export default function Cart() {
  const { t } = useTranslation('cart-checkout');
  const { cartItems, removeFromCart, updateCartQty, clearCart } = useShop();
  const navigate = useNavigate();

  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [couponError, setCouponError] = useState('');
  const [pendingRemove, setPendingRemove] = useState<CartItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const activeItems = cartItems.filter((item) => !item.isDeleted);
  const deletedItems = cartItems.filter((item) => item.isDeleted);

  const couponDiscount = appliedCoupon ? VALID_COUPONS[appliedCoupon] ?? 0 : 0;
  const subtotal = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + SHIPPING_COST + tax - couponDiscount;
  const totalItems = activeItems.reduce((sum, item) => sum + item.quantity, 0);

  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (VALID_COUPONS[code]) {
      setAppliedCoupon(code);
      setCouponError('');
    } else {
      setCouponError(t('cart.coupon.invalid'));
      setAppliedCoupon('');
    }
  };

  /* ── Order Summary Panel ── */
  const sidePanel = (
    <div className="pt-summary">
      <h3 className="pt-summary-title">{t('cart.summary.title')}</h3>

      <div className="pt-summary-row">
        <span>{t('cart.summary.itemCount')}</span>
        <span>{totalItems} {t('cart.summary.itemUnit')}</span>
      </div>

      <div className="pt-summary-row">
        <span>{t('cart.summary.subtotal')}</span>
        <span>{subtotal.toFixed(2)} ₪</span>
      </div>

      <div className="pt-summary-row">
        <span>{t('cart.summary.shipping')}</span>
        <span>{SHIPPING_COST} ₪</span>
      </div>

      <div className="pt-summary-row">
        <span>{t('cart.summary.tax')}</span>
        <span>{tax.toFixed(2)} ₪</span>
      </div>

      {couponDiscount > 0 && (
        <div className="pt-summary-row pt-summary-discount">
          <span>{t('cart.summary.couponDiscount', { code: appliedCoupon })}</span>
          <span>−{couponDiscount} ₪</span>
        </div>
      )}

      <div className="pt-summary-divider" />

      <div className="pt-summary-row pt-summary-total">
        <span>{t('cart.summary.total')}</span>
        <span>{total.toFixed(2)} ₪</span>
      </div>

      <button
        type="button"
        className="pt-btn-checkout"
        onClick={() => navigate('/checkout')}
        disabled={activeItems.length === 0}
      >
        {t('cart.summary.checkout')}
      </button>
    </div>
  );

  /* ── Bottom Bar ── */
  const bottomBar = (
    <div className="pt-bottom-actions">
      <div className="pt-coupon-wrap">
        <input
          className="pt-coupon-input"
          type="text"
          placeholder={t('cart.coupon.placeholder')}
          value={couponCode}
          onChange={(e) => setCouponCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
        />
        <button type="button" className="pt-btn-coupon" onClick={applyCoupon}>
          {t('cart.coupon.apply')}
        </button>
        {couponError && (
          <span className="pt-coupon-error">{couponError}</span>
        )}
        {appliedCoupon && !couponError && (
          <span className="pt-coupon-success">{t('cart.coupon.success')}</span>
        )}
      </div>

      <button type="button" className="pt-btn-clear" onClick={() => setShowClearConfirm(true)}>
        {t('cart.actions.clear')}
      </button>
    </div>
  );

  /* ── Empty State ── */
  if (cartItems.length === 0 || (activeItems.length === 0 && deletedItems.length === 0)) {
    return (
      <>
        <Topbar />
        <div className="pt-page">
          <div className="pt-empty">
            <div className="pt-empty-icon">🛒</div>
            <h2>{t('cart.empty.title')}</h2>
            <p>{t('cart.empty.subtitle')}</p>
            <a href="/store" className="pt-btn-shop">{t('cart.empty.browse')}</a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ProductListTemplate
        title={t('cart.title')}
        itemCount={cartItems.length}
        columns={[
          t('cart.columns.product'),
          t('cart.columns.price'),
          t('cart.columns.qty'),
          t('cart.columns.total'),
        ]}
        sidePanel={sidePanel}
        bottomBar={bottomBar}
      >
        {cartItems.map((item) => (
          <ProductRow
            key={item.id}
            image={item.image}
            name={item.name}
            color={item.color}
            size={item.size}
            isDeleted={item.isDeleted}
            onRemove={() => setPendingRemove(item)}
          >
            {item.isDeleted ? (
              <td className="pt-cell pt-cell-deleted-msg" colSpan={3}>
                <span className="pt-deleted-badge">⚠️ {t('cart.item.deleted')}</span>
              </td>
            ) : (
              <>
                <td className="pt-cell pt-cell-price">
                  {item.price.toFixed(2)} ₪
                </td>

                <td className="pt-cell pt-cell-qty">
                  <QuantitySelector
                    value={item.quantity}
                    onChange={(qty) => updateCartQty(item.id, qty)}
                  />
                </td>

                <td className="pt-cell pt-cell-subtotal">
                  <strong>{(item.price * item.quantity).toFixed(2)} ₪</strong>
                </td>
              </>
            )}
          </ProductRow>
        ))}
      </ProductListTemplate>

      {pendingRemove && (
        <CartConfirmModal
          message={t('cart.confirm.removeItem', { name: pendingRemove.name })}
          confirmLabel={t('cart.confirm.delete')}
          cancelLabel={t('cart.confirm.cancel')}
          confirmDanger
          onConfirm={() => { removeFromCart(pendingRemove.id); setPendingRemove(null); }}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {showClearConfirm && (
        <CartConfirmModal
          message={t('cart.confirm.clearCart')}
          confirmLabel={t('cart.confirm.clearAll')}
          cancelLabel={t('cart.confirm.cancel')}
          confirmDanger
          onConfirm={() => { clearCart(); setShowClearConfirm(false); }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}
