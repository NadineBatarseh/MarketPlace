import type { MouseEvent } from 'react';
import type { Product } from '../types';
import ProductCard from './ProductCard';

const SORT_OPTIONS = [
  { label: 'الأكثر مبيعاً', value: 'default' },
  { label: 'الأحدث', value: 'newest' },
  { label: 'السعر: من الأقل للأعلى', value: 'price_asc' },
  { label: 'السعر: من الأعلى للأقل', value: 'price_desc' },
  { label: 'التقييم', value: 'rating' },
];

interface Props {
  products: Product[];
  total: number;
  loading: boolean;
  sort: string;
  viewMode: 'grid' | 'list';
  wishlist: Set<string>;
  onSortChange: (sort: string) => void;
  onLoadMore: () => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onToggleWishlist: (e: MouseEvent, id: string) => void;
  onAddToCart: (e: MouseEvent) => void;
}

export default function ProductsSection({
  products, total, loading, sort, viewMode, wishlist,
  onSortChange, onLoadMore, onViewModeChange, onToggleWishlist, onAddToCart,
}: Props) {
  const hasMore = !loading && products.length < total;

  return (
    <main className="products-section">
      <div className="products-toolbar">
        <div className="label">عرض {products.length} من {total} منتج</div>
        <div className="toolbar-right">
          
<select
  title="ترتيب المنتجات"
  className="sort-select"
  value={sort}
 onChange={e => onSortChange(e.target.value)}
>
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="view-toggle">
            <button
              className={`view-btn${viewMode === 'grid' ? ' active' : ''}`}
              title="شبكة"
              onClick={() => onViewModeChange('grid')}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z" />
              </svg>
            </button>
            <button
              className={`view-btn${viewMode === 'list' ? ' active' : ''}`}
              title="قائمة"
              onClick={() => onViewModeChange('list')}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {loading && products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontFamily: 'Tajawal, sans-serif' }}>
          جاري تحميل المنتجات...
        </div>
      ) : products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontFamily: 'Tajawal, sans-serif' }}>
          لا توجد منتجات
        </div>
      ) : (
        <div className="products-grid">
          {products.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              inWishlist={wishlist.has(product.id)}
              onToggleWishlist={onToggleWishlist}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <button
            className="btn btn-outline"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? 'جاري التحميل...' : 'تحميل المزيد'}
          </button>
        </div>
      )}
    </main>
  );
}
