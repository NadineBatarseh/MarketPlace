import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Heart } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import './ProductCard.css';

export interface ProductCardData {
  id: string;
  title: string;
  price: number | null;
  image_urls?: string[] | string | null;
  discount_pct?: number | null;
  stock_Quantity?: number | null;
}

interface ProductCardProps<T extends ProductCardData> {
  product: T;
  storeName?: string | null;
  isFavorited?: boolean;
  onToggleFavorite?: (e: MouseEvent, product: T) => void;
  onAddToCart: (e: MouseEvent, product: T) => void;
}

function firstImage(v?: string[] | string | null): string {
  if (!v) return '';
  return Array.isArray(v) ? (v.filter(Boolean)[0] ?? '') : v;
}

/** Unified product card — same box, colors and add-to-cart behavior everywhere
 * a product is listed (home, search, store, category, offers). */
export default function ProductCard<T extends ProductCardData>({
  product, storeName, isFavorited = false, onToggleFavorite, onAddToCart,
}: ProductCardProps<T>) {
  const navigate = useNavigate();
  const { isInCart } = useShop();
  const inCart = isInCart(product.id);
  const oos = product.stock_Quantity === 0;
  const img = firstImage(product.image_urls);
  const hasDiscount = product.discount_pct != null && product.discount_pct > 0;
  const origPrice = hasDiscount && product.price != null
    ? Math.round(product.price / (1 - (product.discount_pct as number) / 100))
    : null;

  return (
    <div className="spc-card" onClick={() => navigate(`/product/${product.id}`)}>
      <div className="spc-card__img-wrap">
        {hasDiscount && <span className="spc-card__badge">-{product.discount_pct}%</span>}

        {onToggleFavorite && (
          <button
            type="button"
            className={`spc-card__fav${isFavorited ? ' spc-card__fav--on' : ''}`}
            onClick={e => { e.stopPropagation(); onToggleFavorite(e, product); }}
            aria-label={isFavorited ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
          >
            <Heart size={14} fill={isFavorited ? 'currentColor' : 'none'} />
          </button>
        )}

        {img
          ? <img src={img} alt={product.title} className="spc-card__img" loading="lazy" />
          : (
            <div className="spc-card__img-ph">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
              </svg>
            </div>
          )}
      </div>

      <div className="spc-card__body">
        <p className="spc-card__title">{product.title}</p>
        {storeName && <p className="spc-card__store">{storeName}</p>}
        <div className="spc-card__price-row">
          {product.price != null && <span className="spc-card__price">₪{product.price.toLocaleString('en-US')}</span>}
          {origPrice != null && <span className="spc-card__orig">₪{origPrice.toLocaleString('en-US')}</span>}
        </div>
        <button
          type="button"
          className={`spc-card__btn${inCart ? ' spc-card__btn--in' : ''}${oos ? ' spc-card__btn--oos' : ''}`}
          onClick={e => { e.stopPropagation(); onAddToCart(e, product); }}
          disabled={oos}
        >
          <ShoppingCart size={13} />
          {oos ? 'نفدت الكمية' : inCart ? 'في السلة' : 'أضف للسلة'}
        </button>
      </div>
    </div>
  );
}

/** Loading placeholder matching the card's exact box, for use while data fetches. */
export function ProductCardSkeleton() {
  return (
    <div className="spc-card spc-card--sk" aria-hidden>
      <div className="spc-sk-rect" />
      <div className="spc-card__body">
        <div className="spc-sk-line spc-sk-line--80" />
        <div className="spc-sk-line spc-sk-line--50" />
        <div className="spc-sk-line spc-sk-line--60" />
        <div className="spc-sk-btn" />
      </div>
    </div>
  );
}
