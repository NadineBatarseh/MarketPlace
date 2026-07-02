import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product } from '../types';
import ProductCard from './ProductCard';

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
  const { t } = useTranslation('customer');

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
        aria-label={t('productsSection.pagination.prev')}
        title={t('productsSection.pagination.prev')}
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
            aria-label={t('productsSection.pagination.pageAria', { n: p })}
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
        aria-label={t('productsSection.pagination.next')}
        title={t('productsSection.pagination.next')}
      >
        ›
      </button>
    </div>
  );
}

export default function ProductsSection({
  products, total, totalPages, page, loading, sort, viewMode, wishlist,
  onSortChange, onPageChange, onViewModeChange, onToggleWishlist, onAddToCart,
}: Props) {
  const { t } = useTranslation('customer');

  const SORT_OPTIONS = [
    { label: t('productsSection.sort.bestSelling'), value: 'best_selling' },
    { label: t('productsSection.sort.newest'), value: 'newest' },
    { label: t('productsSection.sort.priceAsc'), value: 'price_asc' },
    { label: t('productsSection.sort.priceDesc'), value: 'price_desc' },
    { label: t('productsSection.sort.rating'), value: 'rating' },
  ];

  return (
    <main className="products-section">
      <div className="products-toolbar">
        <div className="label">{t('productsSection.toolbar.showing', { shown: products.length, total })}</div>
        <div className="toolbar-right">
          <select
            title={t('productsSection.toolbar.sortAria')}
            aria-label={t('productsSection.toolbar.sortAria')}
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
              type="button"
              className={`view-btn${viewMode === 'grid' ? ' active' : ''}`}
              title={t('productsSection.toolbar.gridTitle')}
              aria-label={t('productsSection.toolbar.gridAria')}
              onClick={() => onViewModeChange('grid')}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z" />
              </svg>
            </button>
            <button
              type="button"
              className={`view-btn${viewMode === 'list' ? ' active' : ''}`}
              title={t('productsSection.toolbar.listTitle')}
              aria-label={t('productsSection.toolbar.listAria')}
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
        <div className="products-empty">{t('productsSection.loading')}</div>
      ) : products.length === 0 ? (
        <div className="products-empty">{t('productsSection.empty')}</div>
      ) : (
        <div className={`products-grid${viewMode === 'list' ? ' products-grid--list' : ''}`}>
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

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </main>
  );
}
