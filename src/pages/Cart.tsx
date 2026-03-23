import { useState } from 'react';
import ProductListTemplate from '../components/ProductListTemplate';
import ProductRow from '../components/ProductRow';
import QuantitySelector from '../components/QuantitySelector';
import AppNav from '../components/AppNav';
import { useShop } from '../context/ShopContext';
import '../styles/productTable.css';

const SHIPPING_COST = 15;
const TAX_RATE = 0.1;

const VALID_COUPONS: Record<string, number> = {
  SAVE10: 10,
  SALE20: 20,
  'خصم15': 15,
};

export default function Cart() {
  const { cartItems, removeFromCart, updateCartQty, clearCart } = useShop();

  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [couponError, setCouponError] = useState('');

  const couponDiscount = appliedCoupon ? VALID_COUPONS[appliedCoupon] ?? 0 : 0;
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + SHIPPING_COST + tax - couponDiscount;
  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (VALID_COUPONS[code]) {
      setAppliedCoupon(code);
      setCouponError('');
    } else {
      setCouponError('كود الخصم غير صحيح');
      setAppliedCoupon('');
    }
  };

  /* ── Order Summary Panel ── */
  const sidePanel = (
    <div className="pt-summary">
      <h3 className="pt-summary-title">ملخص الطلب</h3>

      <div className="pt-summary-row">
        <span>عدد المنتجات</span>
        <span>{totalItems} قطعة</span>
      </div>

      <div className="pt-summary-row">
        <span>المجموع الجزئي</span>
        <span>{subtotal.toFixed(2)} ر.س</span>
      </div>

      <div className="pt-summary-row">
        <span>رسوم الشحن</span>
        <span>{SHIPPING_COST} ر.س</span>
      </div>

      <div className="pt-summary-row">
        <span>الضريبة (10%)</span>
        <span>{tax.toFixed(2)} ر.س</span>
      </div>

      {couponDiscount > 0 && (
        <div className="pt-summary-row pt-summary-discount">
          <span>خصم الكوبون ({appliedCoupon})</span>
          <span>−{couponDiscount} ر.س</span>
        </div>
      )}

      <div className="pt-summary-divider" />

      <div className="pt-summary-row pt-summary-total">
        <span>الإجمالي</span>
        <span>{total.toFixed(2)} ر.س</span>
      </div>

      <button type="button" className="pt-btn-checkout">
        المتابعة للدفع &larr;
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
          placeholder="أدخل كود الخصم..."
          value={couponCode}
          onChange={(e) => setCouponCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
        />
        <button type="button" className="pt-btn-coupon" onClick={applyCoupon}>
          تطبيق الكوبون
        </button>
        {couponError && (
          <span className="pt-coupon-error">{couponError}</span>
        )}
        {appliedCoupon && !couponError && (
          <span className="pt-coupon-success">✓ تم تطبيق الكوبون بنجاح</span>
        )}
      </div>

      <button type="button" className="pt-btn-clear" onClick={clearCart}>
        مسح السلة
      </button>
    </div>
  );

  /* ── Empty State ── */
  if (cartItems.length === 0) {
    return (
      <div className="pt-page">
        <AppNav />
        <div className="pt-empty">
          <div className="pt-empty-icon">🛒</div>
          <h2>سلة التسوق فارغة</h2>
          <p>لم تقم بإضافة أي منتجات بعد</p>
          <a href="/store" className="pt-btn-shop">تصفح المنتجات</a>
        </div>
      </div>
    );
  }

  return (
    <ProductListTemplate
      title="سلة التسوق"
      itemCount={cartItems.length}
      columns={['المنتج', 'السعر', 'الكمية', 'المجموع']}
      sidePanel={sidePanel}
      bottomBar={bottomBar}
    >
      {cartItems.map((item) => (
        <ProductRow
          key={item.id}
          image={item.image}
          name={item.name}
          onRemove={() => removeFromCart(item.id)}
        >
          <td className="pt-cell pt-cell-price">
            {item.price.toFixed(2)} ر.س
          </td>

          <td className="pt-cell pt-cell-qty">
            <QuantitySelector
              value={item.quantity}
              onChange={(qty) => updateCartQty(item.id, qty)}
            />
          </td>

          <td className="pt-cell pt-cell-subtotal">
            <strong>{(item.price * item.quantity).toFixed(2)} ر.س</strong>
          </td>
        </ProductRow>
      ))}
    </ProductListTemplate>
  );
}
