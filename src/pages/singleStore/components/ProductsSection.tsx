import type { MouseEvent } from 'react';
import type { Product } from '../types';
import ProductCard, { ProductCardSkeleton } from '../../../components/ProductCard';

const SORT_OPTIONS = [
  { label: 'الأكثر مبيعاً', value: 'best_selling' },
  { label: 'الأحدث', value: 'newest' },
  { label: 'السعر: من الأقل للأعلى', value: 'price_asc' },
  { label: 'السعر: من الأعلى للأقل', value: 'price_desc' },
  { label: 'التقييم', value: 'rating' },
];

interface Props {
  products: Product[];
  total: number;
  totalPages: number;
  page: number;
  loading: boolean;
  sort: string;
  viewMode: 'grid' | 'list';
  wishlist: Set<string>;
  onSortChange: (sort: string) => void;
  onPageChange: (page: number) => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onToggleWishlist: (e: MouseEvent, id: string) => void;
  onAddToCart: (e: MouseEvent, product: Product) => void;
}

function Pagination({ page, totalPages, onPageChange }: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | '…')[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="pagination">
      <button
        type="button"
        className="page-btn page-btn--nav"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        aria-label="الصفحة السابقة"
        title="الصفحة السابقة"
      >
        ‹
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="page-ellipsis">…</span>
        ) : (
          <button
            type="button"
            key={p}
            className={`page-btn${p === page ? ' active' : ''}`}
            onClick={() => onPageChange(p)}
            aria-label={`صفحة ${p}`}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        className="page-btn page-btn--nav"
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        aria-label="الصفحة التالية"
        title="الصفحة التالية"
      >
        ›
      </button>
    </div>
  );
}

export default function ProductsSection({
  products, total, totalPages, page, loading, sort, wishlist,
  onSortChange, onPageChange, onToggleWishlist, onAddToCart,
}: Props) {
  return (
    <main className="products-section">
      <div className="products-toolbar">
        <div className="label">عرض {products.length} من {total} منتج</div>
        <div className="toolbar-right">
          <select
            title="ترتيب المنتجات"
            aria-label="ترتيب المنتجات"
            className="sort-select"
            value={sort}
            onChange={e => onSortChange(e.target.value)}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && products.length === 0 ? (
        <div className="products-grid">
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : products.length === 0 ? (
        <div className="products-empty">لا توجد منتجات</div>
      ) : (
        <div className="products-grid">
          {products.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              isFavorited={wishlist.has(product.id)}
              onToggleFavorite={(e, p) => onToggleWishlist(e, p.id)}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </main>
  );
}
