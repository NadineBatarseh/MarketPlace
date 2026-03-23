import { useState } from 'react';
import ProductListTemplate from '../components/ProductListTemplate';
import ProductRow from '../components/ProductRow';
import AppNav from '../components/AppNav';
import { useShop } from '../context/ShopContext';
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
      <button type="button" className="pt-btn-clear" onClick={clearFavorites}>
        مسح المفضلة
      </button>
    </div>
  );

  /* ── Empty State ── */
  if (favoriteItems.length === 0) {
    return (
      <div className="pt-page">
        <AppNav />
        <div className="pt-empty">
          <div className="pt-empty-icon">♡</div>
          <h2>قائمة المفضلة فارغة</h2>
          <p>لم تقم بإضافة أي منتجات للمفضلة بعد</p>
          <a href="/store" className="pt-btn-shop">تصفح المنتجات</a>
        </div>
      </div>
    );
  }

  return (
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
          onRemove={() => removeFromFavorites(item.id)}
        >
          <td className="pt-cell pt-cell-price">
            {item.price.toFixed(2)} ر.س
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
  );
}
