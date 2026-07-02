import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Topbar from '../../components/Topbar';
import '../singleStore/storePage.css';
import '../categoryListing/categoryListing.css';
import './StoreListPage.css';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Explore Local Stores
 * ---------------------
 * Re-skinned to mirror the Category Listing page: faded hero, a left filter
 * rail (reusing the category `sp-*` sidebar classes) and a white toolbar on
 * the beige / green palette. Layout/aesthetic is scoped under `.cat-page`.
 *
 * Field mapping (design field -> shops table column):
 *   store_name   -> name
 *   category     -> Type_of_store
 *   city         -> location
 *   rating       -> shop_ratings.avg_rating
 *   description  -> description
 *   image_url    -> shopLogo            (no dedicated cover column exists)
 *   is_open      -> status === 'published'  (no is_open column exists)
 */
interface StoreItem {
  shop_id: string;
  name: string;
  category: string | null;
  city: string | null;
  description: string | null;
  shopLogo: string | null;
  is_open: boolean;
  avg_rating: number | null;
  review_count: number;
  created_at: string;
}

type SortKey = 'newest' | 'popular' | 'az';

const PAGE_SIZE = 9;

export default function StoreListPage() {
  const { t } = useTranslation('customer');
  const { direction } = useLanguage();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  const navigate = useNavigate();

  useEffect(() => {
    async function fetchStores() {
      // Exclude archived / suspended shops from the public listing.
      const { data: shops, error: shopsErr } = await supabase
        .from('shops')
        .select('shop_id, name, Type_of_store, location, description, shopLogo, status, created_at')
        .neq('status', 'suspended')
        .not('is_archived', 'eq', true)
        .order('created_at', { ascending: false });

      if (shopsErr) {
        setError(shopsErr.message);
        setLoading(false);
        return;
      }

      const { data: ratings } = await supabase
        .from('shop_ratings')
        .select('shop_id, avg_rating, review_count');

      const ratingsMap = new Map((ratings ?? []).map(r => [r.shop_id, r]));

      const merged: StoreItem[] = (shops ?? []).map((s: any) => ({
        shop_id: s.shop_id,
        name: s.name,
        category: s.Type_of_store ?? null,
        city: s.location ?? null,
        description: s.description ?? null,
        shopLogo: s.shopLogo ?? null,
        // status may arrive quote-wrapped from legacy rows — strip quotes before comparing.
        is_open: String(s.status ?? '').replace(/^'|'$/g, '') === 'published',
        avg_rating: ratingsMap.get(s.shop_id)?.avg_rating ?? null,
        review_count: ratingsMap.get(s.shop_id)?.review_count ?? 0,
        created_at: s.created_at,
      }));

      setStores(merged);
      setLoading(false);
    }

    fetchStores().catch(() => {
      setError('Failed to load stores');
      setLoading(false);
    });

    const channel = supabase
      .channel('stores-explore-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, () => {
        fetchStores().catch(() => {});
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Dropdown options derived from the loaded data so they always match reality.
  const categories = useMemo(
    () => [...new Set(stores.map(s => s.category).filter(Boolean) as string[])].sort(),
    [stores],
  );
  const cities = useMemo(
    () => [...new Set(stores.map(s => s.city).filter(Boolean) as string[])].sort(),
    [stores],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = stores.filter(s => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (category && s.category !== category) return false;
      if (city && s.city !== city) return false;
      return true;
    });

    result.sort((a, b) => {
      if (sort === 'az') return a.name.localeCompare(b.name);
      if (sort === 'popular') {
        const ra = a.avg_rating ?? 0;
        const rb = b.avg_rating ?? 0;
        if (rb !== ra) return rb - ra;
        return b.review_count - a.review_count;
      }
      // newest
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [stores, search, category, city, sort]);

  // Reset pagination whenever filters change.
  useEffect(() => { setVisible(PAGE_SIZE); }, [search, category, city, sort]);

  const hasActiveFilters = !!(search || category || city);

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setCity('');
    setSort('newest');
  };

  const shown = filtered.slice(0, visible);

  // Active filter chips shown above the rail sections.
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (search) chips.push({ key: 'q', label: `"${search}"`, onRemove: () => setSearch('') });
  if (category) chips.push({ key: 'cat', label: category, onRemove: () => setCategory('') });
  if (city) chips.push({ key: 'city', label: city, onRemove: () => setCity('') });

  return (
    <div className="cat-page els" dir={direction}>
      <Topbar />

      {/* ── Hero — faded banner fading into the page surface ── */}
      <section className="cat-hero">
        <div className="cat-hero-bg" aria-hidden="true">
          <div className="cat-hero-fade" />
        </div>
        <div className="cat-hero-content">
          <h1 className="cat-hero-title">{t('storeList.hero.title')}</h1>
          <p className="cat-hero-desc">{t('storeList.hero.desc')}</p>
        </div>
      </section>

      <div className="page-body">
        {/* ── Filter rail ── */}
        <aside className="sidebar-panel">
          <div className="sp-header">
            <span className="sp-header-title">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              {t('storeList.filters.title')}
            </span>
            {hasActiveFilters && (
              <button type="button" className="sp-clear-all" onClick={clearFilters}>{t('storeList.filters.clearAll')}</button>
            )}
          </div>

          {chips.length > 0 && (
            <div className="sp-active-chips">
              {chips.map(chip => (
                <span key={chip.key} className="sp-chip">
                  {chip.label}
                  <button type="button" className="sp-chip-x" onClick={chip.onRemove}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="sp-section">
            <div className="sp-section-header" style={{ cursor: 'default', paddingBottom: 12 }}>
              <span className="sp-section-title">{t('storeList.filters.search')}</span>
            </div>
            <div className="els-side-search">
              <svg className="els-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder={t('storeList.filters.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div className="sp-section">
              <div className="sp-section-header" style={{ cursor: 'default' }}>
                <span className="sp-section-title">{t('storeList.filters.category')}</span>
              </div>
              <div className="sp-check-list">
                {categories.map(c => {
                  const active = category === c;
                  return (
                    <label key={c} className={`sp-check-item${active ? ' sp-check-item--active' : ''}`}>
                      <input
                        type="radio"
                        className="sp-check-input"
                        checked={active}
                        onChange={() => setCategory(active ? '' : c)}
                      />
                      <span className={`sp-check-box sp-check-box--radio${active ? ' sp-check-box--on' : ''}`}>
                        {active && <span className="sp-radio-dot" />}
                      </span>
                      <span className="sp-check-label">{c}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* City */}
          {cities.length > 0 && (
            <div className="sp-section">
              <div className="sp-section-header" style={{ cursor: 'default' }}>
                <span className="sp-section-title">{t('storeList.filters.city')}</span>
              </div>
              <div className="sp-check-list">
                {cities.map(c => {
                  const active = city === c;
                  return (
                    <label key={c} className={`sp-check-item${active ? ' sp-check-item--active' : ''}`}>
                      <input
                        type="radio"
                        className="sp-check-input"
                        checked={active}
                        onChange={() => setCity(active ? '' : c)}
                      />
                      <span className={`sp-check-box sp-check-box--radio${active ? ' sp-check-box--on' : ''}`}>
                        {active && <span className="sp-radio-dot" />}
                      </span>
                      <span className="sp-check-label">{c}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* ── Content ── */}
        <section className="products-section">
          {/* Toolbar */}
          <div className="products-toolbar">
            <span className="label">
              {loading ? t('storeList.toolbar.loading') : t('storeList.toolbar.storeCount', { count: filtered.length })}
            </span>
            <div className="toolbar-right">
              <select
                className="sort-select"
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                aria-label={t('storeList.toolbar.sortAria')}
              >
                <option value="newest">{t('storeList.sort.newest')}</option>
                <option value="popular">{t('storeList.sort.popular')}</option>
                <option value="az">{t('storeList.sort.az')}</option>
              </select>
            </div>
          </div>

          {loading && (
            <div className="els-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="els-skel-card">
                  <div className="els-skel els-skel-cover" />
                  <div className="els-skel els-skel-line w70" />
                  <div className="els-skel els-skel-line w45" />
                  <div className="els-skel els-skel-line w100" />
                  <div className="els-skel els-skel-line w100" />
                  <div className="els-skel els-skel-btn" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && <p className="els-error">{error}</p>}

          {!loading && !error && filtered.length === 0 && (
            <div className="els-empty">
              <div className="els-empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l1-5h16l1 5" />
                  <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
                  <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
                </svg>
              </div>
              <h3>{t('storeList.empty.title')}</h3>
              <p>{t('storeList.empty.desc')}</p>
              <button className="els-btn" style={{ width: 'auto', padding: '12px 32px' }} onClick={clearFilters}>
                {t('storeList.empty.clearFilters')}
              </button>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <>
              <div className="els-grid">
                {shown.map(store => (
                  <article
                    key={store.shop_id}
                    className="els-card"
                    onClick={() => navigate(`/stores/${store.shop_id}`)}
                  >
                    {/* Image canvas (beige) — mirrors the category product card */}
                    <div className="els-img-wrap">
                      {store.shopLogo ? (
                        <img src={store.shopLogo} alt={store.name} loading="lazy" />
                      ) : (
                        <div className="els-img-fallback">
                          <span>{store.name.charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                      <span className={`els-badge ${store.is_open ? 'els-badge--open' : 'els-badge--closed'}`}>
                        {store.is_open ? t('storeList.badge.open') : t('storeList.badge.closed')}
                      </span>
                    </div>

                    {/* Body */}
                    <div className="els-body">
                      <h3 className="els-name">{store.name}</h3>
                      {store.category && <p className="els-category">{store.category}</p>}

                      <div className="els-meta">
                        {store.city && (
                          <>
                            <svg className="els-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                              <circle cx="12" cy="10" r="3" />
                            </svg>
                            <span>{store.city}</span>
                          </>
                        )}
                        {store.city && store.avg_rating != null && <span className="els-dot">•</span>}
                        {store.avg_rating != null && (
                          <>
                            <svg className="els-star" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                            <span className="els-rating-val">{store.avg_rating}</span>
                          </>
                        )}
                      </div>

                      <p className="els-desc">
                        {store.description || t('storeList.card.fallbackDesc')}
                      </p>

                      <button className="els-btn" onClick={() => navigate(`/stores/${store.shop_id}`)}>
                        {t('storeList.card.viewStore')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {visible < filtered.length && (
                <div className="els-more">
                  <button className="els-more-btn" onClick={() => setVisible(v => v + PAGE_SIZE)}>
                    {t('storeList.loadMore')}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Footer */}
      <footer className="els-footer">
        <div className="els-footer-inner">
          <div>
            <span className="els-footer-brand">{t('storeList.footer.brand')}</span>
            <p>{t('storeList.footer.copyright')}</p>
          </div>
          <div>
            <h4>{t('storeList.footer.marketplace')}</h4>
            <nav>
              <a onClick={() => navigate('/home')}>{t('storeList.footer.aboutUs')}</a>
              <a>{t('storeList.footer.terms')}</a>
              <a onClick={() => navigate('/privacy-policy')}>{t('storeList.footer.privacy')}</a>
            </nav>
          </div>
          <div>
            <h4>{t('storeList.footer.support')}</h4>
            <nav>
              <a>{t('storeList.footer.contactSupport')}</a>
              <a>{t('storeList.footer.careers')}</a>
              <a>{t('storeList.footer.helpCenter')}</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
