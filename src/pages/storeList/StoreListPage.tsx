import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import './StoreListPage.css';
import { supabase } from '../../lib/supabase';

/**
 * Explore Local Stores
 * ---------------------
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

const PAGE_SIZE = 8;

export default function StoreListPage() {
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

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setCity('');
    setSort('newest');
  };

  const shown = filtered.slice(0, visible);

  return (
    <div className="els" dir="rtl">
      <Topbar />

      {/* Hero */}
      <section className="els-hero">
        <div className="els-hero-inner">
          <h1>استكشف المتاجر المحلية</h1>
          <p>
            اكتشف المتاجر المحلية الموثوقة وتصفح منتجاتها بسهولة. ادعم مجتمعك من خلال
            التسوق من الأعمال المملوكة بشكل مستقل.
          </p>
        </div>
      </section>

      {/* Filter bar */}
      <section className="els-filters">
        <div className="els-filters-inner">
          <div className="els-search">
            <svg className="els-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="ابحث عن المتاجر..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="els-selects">
            <select className="els-select" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">الفئة</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="els-select" value={city} onChange={e => setCity(e.target.value)}>
              <option value="">المدينة</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="els-select" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
              <option value="newest">الأحدث</option>
              <option value="popular">الأكثر شهرة</option>
              <option value="az">أبجدياً</option>
            </select>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="els-grid-section">
        {loading && (
          <div className="els-grid">
            {Array.from({ length: 8 }).map((_, i) => (
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
            <h3>لم يتم العثور على متاجر</h3>
            <p>لم نتمكن من العثور على أي متاجر تطابق بحثك أو عوامل التصفية. حاول تعديل معاييرك.</p>
            <button className="els-btn" style={{ width: 'auto', padding: '12px 32px' }} onClick={clearFilters}>
              مسح كل عوامل التصفية
            </button>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="els-grid">
              {shown.map(store => (
                <article key={store.shop_id} className="els-card">
                  {/* Cover + logo */}
                  <div className="els-cover">
                    {store.shopLogo ? (
                      <img src={store.shopLogo} alt={store.name} loading="lazy" />
                    ) : (
                      <div className="els-cover-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 9l1-5h16l1 5" />
                          <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
                          <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
                        </svg>
                      </div>
                    )}
                    <div className="els-logo">
                      {store.shopLogo ? (
                        <img src={store.shopLogo} alt={`${store.name} logo`} loading="lazy" />
                      ) : (
                        <div className="els-logo-fallback">{store.name.charAt(0).toUpperCase()}</div>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  <div className="els-body">
                    <div className="els-head">
                      <div>
                        <h3 className="els-name">{store.name}</h3>
                        {store.category && <p className="els-category">{store.category}</p>}
                      </div>
                      <span className={`els-badge ${store.is_open ? 'els-badge--open' : 'els-badge--closed'}`}>
                        {store.is_open ? 'مفتوح' : 'مغلق'}
                      </span>
                    </div>

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
                      {store.description || 'متجر محلي على سوق لينك.'}
                    </p>

                    <button className="els-btn" onClick={() => navigate(`/stores/${store.shop_id}`)}>
                      عرض المتجر
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {visible < filtered.length && (
              <div className="els-more">
                <button className="els-more-btn" onClick={() => setVisible(v => v + PAGE_SIZE)}>
                  تحميل المزيد من المتاجر
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Footer */}
      <footer className="els-footer">
        <div className="els-footer-inner">
          <div>
            <span className="els-footer-brand">سوق لينك</span>
            <p>
              © 2024 سوق لينك ماركتبليس. نربط المجتمعات المحلية من خلال توفير منصة
              للمتاجر المحلية لتزدهر وللعملاء لاكتشاف منتجات فريدة.
            </p>
          </div>
          <div>
            <h4>السوق</h4>
            <nav>
              <a onClick={() => navigate('/home')}>من نحن</a>
              <a>شروط الخدمة</a>
              <a onClick={() => navigate('/privacy-policy')}>سياسة الخصوصية</a>
            </nav>
          </div>
          <div>
            <h4>الدعم</h4>
            <nav>
              <a>اتصل بالدعم</a>
              <a>الوظائف</a>
              <a>مركز المساعدة</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
