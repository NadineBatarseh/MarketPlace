import { useState } from 'react';
import ProductListTemplate from '../components/ProductListTemplate';
import ProductRow from '../components/ProductRow';
import Topbar from '../components/Topbar';
import CartConfirmModal from '../components/CartConfirmModal';
import { useShop } from '../context/ShopContext';
import type { FavoriteItem } from '../context/ShopContext';
import '../styles/productTable.css';

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export default function Favorite() {
  const {
    favoriteItems,
    removeFromFavorites,
    clearFavorites,
    addToCart,
  } = useShop();

  const [addedToCart, setAddedToCart] = useState<Set<string | number>>(new Set());
  const [pendingRemove, setPendingRemove] = useState<FavoriteItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleAddToCart = (id: string | number) => {
    const item = favoriteItems.find((f) => f.id === id);
    if (!item) return;
    addToCart({ id: item.id, name: item.name, image: item.image, price: item.price });
    setAddedToCart((prev) => new Set([...prev, id]));
  };

  const handleAddAllToCart = () => {
    const inStock = favoriteItems.filter((i) => i.inStock);
    inStock.forEach((item) =>
      addToCart({ id: item.id, name: item.name, image: item.image, price: item.price })
    );
    setAddedToCart(new Set(inStock.map((i) => i.id)));
  };

  /* ── Bottom Bar ── */
  const bottomBar = (
    <div className="pt-bottom-actions">
      <button type="button" className="pt-btn-add-all" onClick={handleAddAllToCart}>
        إضافة الكل للسلة
      </button>
      <button type="button" className="pt-btn-clear" onClick={() => setShowClearConfirm(true)}>
        مسح المفضلة
      </button>
    </div>
  );

  /* ── Empty State ── */
  if (favoriteItems.length === 0) {
    return (
      <>
        <Topbar />
        <div className="pt-page">
          <div className="pt-empty">
            <div className="pt-empty-icon">♡</div>
            <h2>قائمة المفضلة فارغة</h2>
            <p>لم تقم بإضافة أي منتجات للمفضلة بعد</p>
            <a href="/store" className="pt-btn-shop">تصفح المنتجات</a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ProductListTemplate
        title="المفضلة"
        itemCount={favoriteItems.length}
        columns={['المنتج', 'السعر', 'تاريخ الإضافة', 'المخزون', 'الإجراء']}
        bottomBar={bottomBar}
      >
        {favoriteItems.map((item) => (
          <ProductRow
            key={item.id}
            image={item.image}
            name={item.name}
            onRemove={() => setPendingRemove(item)}
          >
            <td className="pt-cell pt-cell-price">
              {item.price.toFixed(2)} ₪
            </td>

            <td className="pt-cell pt-cell-date">
              {formatDate(item.dateAdded)}
            </td>

            <td className="pt-cell pt-cell-stock">
              <span className={`pt-stock-badge ${item.inStock ? 'in-stock' : 'out-of-stock'}`}>
                {item.inStock ? 'متوفر' : 'نفذ المخزون'}
              </span>
            </td>

            <td className="pt-cell pt-cell-action">
              <button
                type="button"
                className={`pt-btn-add-cart${addedToCart.has(item.id) ? ' added' : ''}`}
                onClick={() => handleAddToCart(item.id)}
                disabled={!item.inStock}
              >
                {addedToCart.has(item.id) ? '✓ أُضيف للسلة' : 'أضف للسلة'}
              </button>
            </td>
          </ProductRow>
        ))}
      </ProductListTemplate>

      {pendingRemove && (
        <CartConfirmModal
          message={`هل أنت متأكد أنك تريد حذف "${pendingRemove.name}" من المفضلة؟`}
          confirmLabel="حذف"
          cancelLabel="إلغاء"
          confirmDanger
          onConfirm={() => { removeFromFavorites(pendingRemove.id); setPendingRemove(null); }}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {showClearConfirm && (
        <CartConfirmModal
          message="هل أنت متأكد أنك تريد مسح جميع المنتجات من المفضلة؟"
          confirmLabel="مسح الكل"
          cancelLabel="إلغاء"
          confirmDanger
          onConfirm={() => { clearFavorites(); setShowClearConfirm(false); }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}
