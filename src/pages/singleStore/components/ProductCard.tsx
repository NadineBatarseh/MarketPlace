import { useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Product } from '../types';
import { getProductBadge } from '../../../lib/productBadge';
import '../../../lib/productBadge.css';

interface Props {
  product: Product;
  inWishlist: boolean;
  onToggleWishlist: (e: MouseEvent, id: string) => void;
  onAddToCart: (e: MouseEvent, product: Product) => void;
}

export default function ProductCard({ product, inWishlist, onToggleWishlist, onAddToCart }: Props) {
  const { t } = useTranslation('customer');
  const navigate = useNavigate();
  const images = product.image_urls?.filter(Boolean) ?? [];
  const hasMultiple = images.length > 1;
  const [idx, setIdx] = useState(0);

  const goPrev = (e: MouseEvent) => {
    e.stopPropagation();
    setIdx(i => (i - 1 + images.length) % images.length);
  };

  const goDot = (e: MouseEvent, i: number) => {
    e.stopPropagation();
    setIdx(i);
  };

  const goNext = (e: MouseEvent) => {
    e.stopPropagation();
    setIdx(i => (i + 1) % images.length);
  };

  const imgSrc = images[idx] ?? null;
  const badge = getProductBadge(product);

  return (
    <div className="product-card" onClick={() => navigate(`/product/${product.id}`)}>
      <div className="product-img-wrap">
        {badge && <span className={`pbadge pbadge--${badge.kind}`}>{badge.text}</span>}
        {images.length > 0 ? (
          <img src={images[idx]} alt={product.title} loading="lazy" />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: 'var(--green-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--green)', fontSize: '32px',
          }}>🛍</div>
        )}

        {/* Wishlist */}
        <button
          type="button"
          className={`wishlist-btn${inWishlist ? ' active' : ''}`}
          onClick={e => onToggleWishlist(e, product.id)}
          aria-label={inWishlist ? t('productCard.removeWishlist') : t('productCard.addWishlist')}
        >
          <svg fill={inWishlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Prev / Next arrows — only when multiple images */}
        {hasMultiple && (
          <>
            <button className="pc-arrow pc-arrow-prev" onClick={goPrev} aria-label={t('productCard.prevImage')}>‹</button>
            <button className="pc-arrow pc-arrow-next" onClick={goNext} aria-label={t('productCard.nextImage')}>›</button>

            {/* Dot indicators */}
            <div className="pc-dots">
              {images.map((_, i) => (
                <button
                  key={i}
                  className={`pc-dot${i === idx ? ' active' : ''}`}
                  onClick={e => goDot(e, i)}
                  aria-label={t('productCard.imageAria', { n: i + 1 })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="product-body">
        <div className="product-name">{product.title}</div>
        {product.price !== null && (
          <div className="product-price">
            <span className="currency">₪</span> {product.price}
          </div>
        )}
        <button className="add-to-cart" onClick={e => onAddToCart(e, product)}>{t('productCard.addToCart')}</button>
      </div>
    </div>
  );
}
