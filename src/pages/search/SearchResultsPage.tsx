import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import './SearchResultsPage.css';

interface Product {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_urls: string[] | string | null;
  stock_Quantity: number | null;
}

interface SearchResponse {
  ok: boolean;
  products: Product[];
  total: number;
  page: number;
  limit: number;
  query: string;
  terms: string[];
  error?: string;
}

const LIMIT = 20;

function getFirstImage(image_urls: Product['image_urls']): string | null {
  if (!image_urls) return null;
  if (Array.isArray(image_urls)) return image_urls[0] ?? null;
  return image_urls;
}

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const q         = searchParams.get('q') ?? '';
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const minPrice  = searchParams.get('min_price') ?? '';
  const maxPrice  = searchParams.get('max_price') ?? '';

  const [results, setResults]   = useState<SearchResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Local price filter state (applied on submit)
  const [priceMin, setPriceMin] = useState(minPrice);
  const [priceMax, setPriceMax] = useState(maxPrice);

  const fetchResults = useCallback(async () => {
    if (!q.trim()) { setResults(null); return; }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ q, page: String(page), limit: String(LIMIT) });
      if (minPrice) params.set('min_price', minPrice);
      if (maxPrice) params.set('max_price', maxPrice);

      const res  = await fetch(`/api/search?${params.toString()}`);
      const data: SearchResponse = await res.json();

      if (!data.ok) throw new Error(data.error ?? 'خطأ في البحث');
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل في البحث');
    } finally {
      setLoading(false);
    }
  }, [q, page, minPrice, maxPrice]);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  function applyPriceFilter(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    next.set('page', '1');
    priceMin ? next.set('min_price', priceMin) : next.delete('min_price');
    priceMax ? next.set('max_price', priceMax) : next.delete('max_price');
    setSearchParams(next);
  }

  function clearFilters() {
    setPriceMin('');
    setPriceMax('');
    const next = new URLSearchParams({ q });
    setSearchParams(next);
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const totalPages = results ? Math.ceil(results.total / LIMIT) : 0;
  const hasFilters = !!minPrice || !!maxPrice;

  return (
    <div dir="rtl" className="sr-root">
      <Topbar />

      <div className="sr-container">
        {/* ── Header ── */}
        <div className="sr-header">
          {q ? (
            <>
              <h1 className="sr-title">نتائج البحث عن: <span className="sr-query">"{q}"</span></h1>
              {results && (
                <p className="sr-count">
                  {results.total === 0
                    ? 'لا توجد نتائج'
                    : `${results.total} نتيجة`}
                </p>
              )}
            </>
          ) : (
            <h1 className="sr-title">ابدأ بالبحث عن منتج</h1>
          )}
        </div>

        <div className="sr-body">
          {/* ── Filters sidebar ── */}
          <aside className="sr-filters">
            <h2 className="sr-filters-title">تصفية النتائج</h2>

            <form onSubmit={applyPriceFilter} className="sr-price-form">
              <label className="sr-filter-label">نطاق السعر (₪)</label>
              <div className="sr-price-row">
                <input
                  type="number"
                  placeholder="من"
                  min={0}
                  value={priceMin}
                  onChange={e => setPriceMin(e.target.value)}
                  className="sr-price-input"
                />
                <span className="sr-price-sep">—</span>
                <input
                  type="number"
                  placeholder="إلى"
                  min={0}
                  value={priceMax}
                  onChange={e => setPriceMax(e.target.value)}
                  className="sr-price-input"
                />
              </div>
              <button type="submit" className="sr-apply-btn">تطبيق</button>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="sr-clear-btn">
                  مسح الفلاتر
                </button>
              )}
            </form>

            {/* Matched terms chip list */}
            {results && results.terms.length > 0 && (
              <div className="sr-terms">
                <p className="sr-terms-label">مصطلحات البحث:</p>
                <div className="sr-terms-list">
                  {results.terms.map(t => (
                    <span key={t} className="sr-term-chip">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* ── Results grid ── */}
          <section className="sr-results">
            {loading && (
              <div className="sr-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="sr-card sr-card--skeleton">
                    <div className="sr-skeleton-img" />
                    <div className="sr-skeleton-line sr-skeleton-line--wide" />
                    <div className="sr-skeleton-line sr-skeleton-line--narrow" />
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="sr-empty">
                <p className="sr-empty-text">{error}</p>
                <button className="sr-retry-btn" onClick={fetchResults}>إعادة المحاولة</button>
              </div>
            )}

            {!loading && !error && results && results.products.length === 0 && (
              <div className="sr-empty">
                <div className="sr-empty-icon">🔍</div>
                <p className="sr-empty-title">لم يتم العثور على نتائج</p>
                <p className="sr-empty-sub">جرب كلمات مختلفة أو أقل تفصيلاً</p>
              </div>
            )}

            {!loading && !error && results && results.products.length > 0 && (
              <>
                <div className="sr-grid">
                  {results.products.map(product => {
                    const img = getFirstImage(product.image_urls);
                    return (
                      <div
                        key={product.id}
                        className="sr-card"
                        onClick={() => navigate(`/product/${product.id}`)}
                      >
                        <div className="sr-card-img-wrap">
                          {img ? (
                            <img src={img} alt={product.title} className="sr-card-img" />
                          ) : (
                            <div className="sr-card-img-placeholder">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <polyline points="21 15 16 10 5 21" />
                              </svg>
                            </div>
                          )}
                          {product.stock_Quantity === 0 && (
                            <span className="sr-out-of-stock">نفذ المخزون</span>
                          )}
                        </div>

                        <div className="sr-card-body">
                          <h3 className="sr-card-title">{product.title}</h3>
                          <div className="sr-card-footer">
                            {product.price != null && (
                              <span className="sr-card-price">₪{product.price.toFixed(2)}</span>
                            )}
                            <button
                              className="sr-card-btn"
                              onClick={e => { e.stopPropagation(); navigate(`/stores/${product.shop_id}`); }}
                            >
                              زيارة المتجر
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="sr-pagination">
                    <button
                      className="sr-page-btn"
                      disabled={page <= 1}
                      onClick={() => goToPage(page - 1)}
                    >
                      ‹ السابق
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => Math.abs(p - page) <= 2)
                      .map(p => (
                        <button
                          key={p}
                          className={`sr-page-btn${p === page ? ' sr-page-btn--active' : ''}`}
                          onClick={() => goToPage(p)}
                        >
                          {p}
                        </button>
                      ))}

                    <button
                      className="sr-page-btn"
                      disabled={page >= totalPages}
                      onClick={() => goToPage(page + 1)}
                    >
                      التالي ›
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
