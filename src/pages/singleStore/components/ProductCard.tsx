import { useState } from 'react';
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
  const images = product.image_urls ?? [];
  const [index, setIndex] = useState(0);

  const prev = (e: MouseEvent) => {
    e.stopPropagation();
    setIndex(i => (i - 1 + images.length) % images.length);
  };
  const next = (e: MouseEvent) => {
    e.stopPropagation();
    setIndex(i => (i + 1) % images.length);
  };

  return (
    <div className="product-card" onClick={() => navigate(`/product/${product.id}`)}>
      <div className="product-img-wrap">
        {images.length > 0 ? (
          <img src={images[index]} alt={product.title} loading="lazy" />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: 'var(--green-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--green)', fontSize: '32px',
          }}>🛍</div>
        )}

        {images.length > 1 && (
          <>
            <button className="img-nav img-nav--prev" onClick={prev} aria-label="الصورة السابقة">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button className="img-nav img-nav--next" onClick={next} aria-label="الصورة التالية">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
            <div className="img-dots">
              {images.map((_, i) => (
                <span
                  key={i}
                  className={`img-dot${i === index ? ' img-dot--active' : ''}`}
                  onClick={e => { e.stopPropagation(); setIndex(i); }}
                />
              ))}
            </div>
          </>
        )}

        <button
          className={`wishlist-btn${inWishlist ? ' active' : ''}`}
          onClick={e => onToggleWishlist(e, product.id)}
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
