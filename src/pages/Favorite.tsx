import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProductListTemplate from '../components/ProductListTemplate';
import ProductRow from '../components/ProductRow';
import Topbar from '../components/Topbar';
import CartConfirmModal from '../components/CartConfirmModal';
import { useShop } from '../context/ShopContext';
import type { FavoriteItem } from '../context/ShopContext';
import i18n from '../i18n/config';
import '../styles/productTable.css';

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString(i18n.language === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export default function Favorite() {
  const { t } = useTranslation('cart-checkout');
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
        {t('favorites.actions.addAllToCart')}
      </button>
      <button type="button" className="pt-btn-clear" onClick={() => setShowClearConfirm(true)}>
        {t('favorites.actions.clear')}
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
            <h2>{t('favorites.empty.title')}</h2>
            <p>{t('favorites.empty.subtitle')}</p>
            <a href="/store" className="pt-btn-shop">{t('favorites.empty.browse')}</a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ProductListTemplate
        title={t('favorites.title')}
        itemCount={favoriteItems.length}
        columns={[
          t('favorites.columns.product'),
          t('favorites.columns.price'),
          t('favorites.columns.dateAdded'),
          t('favorites.columns.stock'),
          t('favorites.columns.action'),
        ]}
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
                {item.inStock ? t('favorites.stock.inStock') : t('favorites.stock.outOfStock')}
              </span>
            </td>

            <td className="pt-cell pt-cell-action">
              <button
                type="button"
                className={`pt-btn-add-cart${addedToCart.has(item.id) ? ' added' : ''}`}
                onClick={() => handleAddToCart(item.id)}
                disabled={!item.inStock}
              >
                {addedToCart.has(item.id) ? t('favorites.actions.added') : t('favorites.actions.addToCart')}
              </button>
            </td>
          </ProductRow>
        ))}
      </ProductListTemplate>

      {pendingRemove && (
        <CartConfirmModal
          message={t('favorites.confirm.removeItem', { name: pendingRemove.name })}
          confirmLabel={t('favorites.confirm.delete')}
          cancelLabel={t('favorites.confirm.cancel')}
          confirmDanger
          onConfirm={() => { removeFromFavorites(pendingRemove.id); setPendingRemove(null); }}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {showClearConfirm && (
        <CartConfirmModal
          message={t('favorites.confirm.clearAll')}
          confirmLabel={t('favorites.confirm.clearAllBtn')}
          cancelLabel={t('favorites.confirm.cancel')}
          confirmDanger
          onConfirm={() => { clearFavorites(); setShowClearConfirm(false); }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}
