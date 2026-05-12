import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import './StoreListPage.css';
import SearchInput from '../../components/SearchInput';
import { supabase } from '../../lib/supabase';

interface StoreItem {
  shop_id: string;
  name: string;
  shopLogo: string | null;
  location: string | null;
  avg_rating: number | null;
  review_count: number;
}

const PAGE_SIZE = 8;
const CITIES = ['رام الله', 'القدس', 'الخليل', 'بيت لحم', 'العيزرية', 'عناتا'];

export default function StoreListPage() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [heroSearch, setHeroSearch] = useState('');
  const navigate = useNavigate();

  const handleHeroSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && heroSearch.trim()) {
      navigate(`/search?q=${encodeURIComponent(heroSearch.trim())}`);
    }
  };

  useEffect(() => {
    async function fetchStores() {
      const { data: shops, error: shopsErr } = await supabase
        .from('shops')
        .select('shop_id, name, shopLogo, location')
        .order('created_at', { ascending: false });

      if (shopsErr) {
        setError(shopsErr.message);
        setLoading(false);
        return;
      }

      const { data: ratings } = await supabase
        .from('shop_ratings')
        .select('shop_id, avg_rating, review_count');

      const ratingsMap = new Map(
        (ratings ?? []).map(r => [r.shop_id, r])
      );

      const merged: StoreItem[] = (shops ?? []).map(s => ({
        shop_id: s.shop_id,
        name: s.name,
        shopLogo: s.shopLogo,
        location: s.location,
        avg_rating: ratingsMap.get(s.shop_id)?.avg_rating ?? null,
        review_count: ratingsMap.get(s.shop_id)?.review_count ?? 0,
      }));

      setStores(merged);
      setLoading(false);
    }

    fetchStores().catch(() => {
      setError('فشل في تحميل المتاجر');
      setLoading(false);
    });
  }, []);

  return (
    <div dir="rtl">
      <Topbar />
      <StoreNav />

      <div className="sl-hero">
        <div className="sl-hero-circle sl-hero-circle--1" />
        <div className="sl-hero-circle sl-hero-circle--2" />
        <h1 className="sl-hero-title">استكشف متاجرنا</h1>
        <SearchInput
          className="sl-hero-search"
          value={heroSearch}
          onChange={setHeroSearch}
          onKeyDown={handleHeroSearch}
          placeholder="...ابحث عن منتج "
        />
        <p className="sl-hero-hint">اضغط Enter للبحث</p>
      </div>

      <div className="sl-page">
        {loading && (
          <div className="sl-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="sl-card sl-card--skeleton">
                <div className="sl-logo-wrap sl-skeleton-circle" />
                <div className="sl-skeleton-line sl-skeleton-line--wide" />
                <div className="sl-skeleton-line sl-skeleton-line--narrow" />
                <div className="sl-skeleton-btn" />
              </div>
            ))}
          </div>
        )}

        {error && <p className="sl-error">{error}</p>}

        {!loading && !error && stores.length === 0 && (
          <p className="sl-empty">لا توجد متاجر حالياً</p>
        )}

        {!loading && !error && stores.length > 0 && (
          <>
            <div className="sl-cities">
              <button
                className={`sl-city-btn${activeCity === null ? ' sl-city-btn--active' : ''}`}
                onClick={() => { setActiveCity(null); setVisible(PAGE_SIZE); }}
              >الكل</button>
              {CITIES.map(city => (
                <button
                  key={city}
                  className={`sl-city-btn${activeCity === city ? ' sl-city-btn--active' : ''}`}
                  onClick={() => { setActiveCity(city); setVisible(PAGE_SIZE); }}
                >{city}</button>
              ))}
            </div>

            <div className="sl-grid">
              {stores.filter(s => !activeCity || s.location?.includes(activeCity)).slice(0, visible).map(store => (
                <div key={store.shop_id} className="sl-card">
                  <div className="sl-logo-wrap">
                    {store.shopLogo ? (
                      <img src={store.shopLogo} alt={store.name} className="sl-logo" />
                    ) : (
                      <div className="sl-logo-placeholder">{store.name.charAt(0)}</div>
                    )}
                    <div className="sl-badge">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <path d="M16 10a4 4 0 0 1-8 0" />
                      </svg>
                    </div>
                  </div>

                  <div className="sl-rating">
                    <svg className="sl-star" viewBox="0 0 24 24" fill={store.avg_rating ? "#f5a623" : "#ccc"}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {store.avg_rating ? (
                      <>
                        <span className="sl-rating-score">{store.avg_rating}</span>
                        <span className="sl-rating-count">({store.review_count})</span>
                      </>
                    ) : (
                      <span className="sl-rating-count">لا توجد تقييمات</span>
                    )}
                  </div>

                  <div className="sl-info">
                    <h2 className="sl-name">{store.name}</h2>
                    {store.location && (
                      <p className="sl-location">
                        <svg className="sl-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        {store.location}
                      </p>
                    )}
                  </div>

                  <button
                    className="sl-visit-btn"
                    onClick={() => navigate(`/stores/${store.shop_id}`)}
                  >
                    زيارة المتجر
                  </button>
                </div>
              ))}
            </div>

            {visible < stores.filter(s => !activeCity || s.location?.includes(activeCity)).length && (
              <div className="sl-more-wrap">
                <button className="sl-more-btn" onClick={() => setVisible(v => v + PAGE_SIZE)}>
                  عرض المزيد من المتاجر
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
