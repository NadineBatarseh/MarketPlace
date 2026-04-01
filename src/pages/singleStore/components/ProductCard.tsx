import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Product } from '../types';

interface Props {
  product: Product;
  inWishlist: boolean;
  onToggleWishlist: (e: MouseEvent, id: string) => void;
  onAddToCart: (e: MouseEvent) => void;
}

export default function ProductCard({ product, inWishlist, onToggleWishlist, onAddToCart }: Props) {
  const navigate = useNavigate();
  const imgSrc = product.image_urls?.[0] ?? null;

  return (
    <div className="product-card" onClick={() => navigate(`/product/${product.id}`)}>
      <div className="product-img-wrap">
        {imgSrc ? (
          <img src={imgSrc} alt={product.title} loading="lazy" />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: 'var(--green-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--green)', fontSize: '32px',
          }}>🛍</div>
        )}
        <button
         type="button"
          className={`wishlist-btn${inWishlist ? ' active' : ''}`}
          onClick={e => onToggleWishlist(e, product.id)}
          title={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <svg
            fill={inWishlist ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      <div className="product-body">
        <div className="product-name">{product.title}</div>
        {product.description && (
          <div className="product-desc">{product.description}</div>
        )}
        {product.price !== null && (
          <div className="product-price">
            <span className="currency">₪</span> {product.price}
          </div>
        )}
        <button className="add-to-cart" onClick={onAddToCart}>أضف للسلة</button>
      </div>
    </div>
  );
}
