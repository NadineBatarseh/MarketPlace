import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Topbar from '../../components/Topbar';
import supabase from '../../lib/supabase';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { getProductBadge } from '../../lib/productBadge';
import '../../lib/productBadge.css';
import './HomePage.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  label: string;
  image_url: string;
  grad: string;
  sort_order: number;
}

interface Store {
  shop_id: string;
  name: string;
  shopLogo: string | null;
  location: string | null;
  avg_rating: number | null;
  review_count: number;
}

interface Product {
  id: string;
  title: string;
  price: number | null;
  image_urls: string[] | null;
  discount_pct: number | null;
  stock_Quantity: number | null;
  created_at: string | null;
  shop_id: string;
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function HeroSection() {
  const { t } = useTranslation('customer');
  const navigate = useNavigate();
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const SLIDES = t('home.slides', { returnObjects: true }) as { title: string; subtitle: string }[];

  useEffect(() => {
    timer.current = setInterval(() => setCur(c => (c + 1) % SLIDES.length), 5000);
    return () => clearInterval(timer.current);
  }, [SLIDES.length]);

  const slide = SLIDES[cur];

  return (
    <div className="hp-hero-wrap">
      <section className="hp-hero">
        <div className="hp-hero__overlay" />

        <div className="hp-hero__inner">
          <div className="hp-hero__content" key={cur}>
            <h1 className="hp-hero__title">{slide.title}</h1>
            <p className="hp-hero__subtitle">{slide.subtitle}</p>
            <button className="hp-hero__cta" onClick={() => navigate('/stores-list')}>{t('home.hero.shopNow')}</button>
          </div>
        </div>

        {/* Arrows */}
        <button type="button" aria-label={t('home.hero.prev')} title={t('home.hero.prev')} className="hp-hero__arr hp-hero__arr--r"
          onClick={() => setCur(c => (c - 1 + SLIDES.length) % SLIDES.length)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button type="button" aria-label={t('home.hero.next')} title={t('home.hero.next')} className="hp-hero__arr hp-hero__arr--l"
          onClick={() => setCur(c => (c + 1) % SLIDES.length)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>

        {/* Dots */}
        <div className="hp-hero__dots">
          {SLIDES.map((_, i) => (
            <button type="button" key={i} aria-label={t('home.hero.slideAria', { n: i + 1 })} title={t('home.hero.slideAria', { n: i + 1 })} className={`hp-hero__dot${i === cur ? ' hp-hero__dot--on' : ''}`} onClick={() => setCur(i)} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Categories ────────────────────────────────────────────────────────────────

function CategoryCard({ cat }: { cat: Category }) {
  const navigate = useNavigate();
  return (
    <button className="hp-cat-card" onClick={() => navigate(`/category/${cat.id}`)}>
      <div className="hp-cat-card__img-wrap">
        <img src={cat.image_url} alt={cat.label} className="hp-cat-card__img" loading="lazy" />
      </div>
      <span className="hp-cat-card__label">{cat.label}</span>
    </button>
  );
}

function CategoriesSection({ cats, loading }: { cats: Category[]; loading: boolean }) {
  const { t } = useTranslation('customer');
  return (
    <section className="hp-section" id="categories">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">{t('home.categories.title')}</h2>
        </div>

        {loading ? (
          <div className="hp-cat-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="hp-cat-card hp-cat-card--sk">
                <div className="hp-sk-circle" />
                <div className="hp-sk-line hp-sk-line--56" />
              </div>
            ))}
          </div>
        ) : cats.length === 0 ? (
          <p className="hp-empty">{t('home.categories.empty')}</p>
        ) : (
          <div className="hp-cat-grid">
            {cats.map(c => <CategoryCard key={c.id} cat={c} />)}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Stores ────────────────────────────────────────────────────────────────────

const STORES_INITIAL = 9;

function StoreCard({ store }: { store: Store }) {
  const navigate = useNavigate();
  return (
    <div className="hp-store-card" onClick={() => navigate(`/stores/${store.shop_id}`)}>
      <div className="hp-store-card__logo">
        {store.shopLogo ? (
          <img src={store.shopLogo} alt={store.name} className="hp-store-card__logo-img" loading="lazy" />
        ) : (
          <div className="hp-store-card__logo-ph">{store.name.charAt(0)}</div>
        )}
      </div>
      <p className="hp-store-card__name">{store.name}</p>
      {store.avg_rating ? (
        <div className="hp-store-card__rating">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#f5a623">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          <span className="hp-store-card__score">{Number(store.avg_rating).toFixed(1)}</span>
        </div>
      ) : null}
    </div>
  );
}

function StoresSection({ stores, loading }: { stores: Store[]; loading: boolean }) {
  const { t } = useTranslation('customer');
  return (
    <section className="hp-section hp-section--alt" id="stores">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">{t('home.stores.title')}</h2>
        </div>

        {loading ? (
          <div className="hp-store-grid">
            {Array.from({ length: STORES_INITIAL }).map((_, i) => (
              <div key={i} className="hp-store-card hp-store-card--sk">
                <div className="hp-sk-circle" />
                <div className="hp-sk-line hp-sk-line--70" />
                <div className="hp-sk-line hp-sk-line--44" />
              </div>
            ))}
          </div>
        ) : stores.length === 0 ? (
          <p className="hp-empty">{t('home.stores.empty')}</p>
        ) : (
          <div className="hp-store-grid">
            {stores.slice(0, STORES_INITIAL).map(s => <StoreCard key={s.shop_id} store={s} />)}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Products ──────────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
  const { t } = useTranslation('customer');
  const navigate = useNavigate();
  const { addToCart, isInCart, toggleFavorite, isFavorited } = useShop();
  const { customer } = useCustomerAuth();
  const isCustomer = customer?.role === 'customer';
  const images = product.image_urls?.filter(Boolean) ?? [];
  const hasMultiple = images.length > 1;
  const [idx, setIdx] = useState(0);
  const img = images[0] ?? '';
  const inCart = isInCart(product.id);
  const origPrice = product.discount_pct && product.price != null
    ? Math.round(product.price / (1 - product.discount_pct / 100))
    : null;

  const goPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIdx(i => (i - 1 + images.length) % images.length);
  };
  const goNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIdx(i => (i + 1) % images.length);
  };
  const goDot = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    setIdx(i);
  };

  // Touch swipe between images (mobile — there is no hover/arrow affordance)
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null || !hasMultiple) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 35) {
      // RTL layout: swipe-left advances, swipe-right goes back
      setIdx(i => (dx < 0 ? (i + 1) % images.length : (i - 1 + images.length) % images.length));
    }
    touchX.current = null;
  };

  const onCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isCustomer) { navigate('/login'); return; }
    if (!inCart) addToCart({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  const onFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isCustomer) { navigate('/login'); return; }
    toggleFavorite({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  const faved = isFavorited(product.id);
  const badge = getProductBadge(product);

  return (
    <div className="hp-prod-card" onClick={() => navigate(`/product/${product.id}`)}>
      {/* Favorite button */}
      <button type="button" className={`hp-prod-card__fav${faved ? ' hp-prod-card__fav--on' : ''}`} onClick={onFav} aria-label={t('home.products.addToFav')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill={faved ? '#136540' : 'none'} stroke={faved ? '#136540' : '#9ca3af'} strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </button>

      {/* Image + carousel */}
      <div className="hp-prod-card__img-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {badge && <span className={`pbadge pbadge--${badge.kind}`}>{badge.text}</span>}
        {images.length > 0
          ? <img src={images[idx]} alt={product.title} className="hp-prod-card__img" loading="lazy" />
          : <div className="hp-prod-card__img-ph">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
              </svg>
            </div>
        }

        {hasMultiple && (
          <>
            <button type="button" className="hp-prod-card__arrow hp-prod-card__arrow--prev" onClick={goPrev} aria-label={t('home.products.prevImg')}>‹</button>
            <button type="button" className="hp-prod-card__arrow hp-prod-card__arrow--next" onClick={goNext} aria-label={t('home.products.nextImg')}>›</button>
            <div className="hp-prod-card__dots">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`hp-prod-card__dot${i === idx ? ' hp-prod-card__dot--on' : ''}`}
                  onClick={e => goDot(e, i)}
                  aria-label={t('home.products.imgAria', { n: i + 1 })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Info */}
      <div className="hp-prod-card__body">
        <p className="hp-prod-card__title">{product.title}</p>
        <div className="hp-prod-card__meta">
          <span className="hp-prod-card__price">
            {product.price != null ? `₪ ${product.price.toLocaleString()}` : '—'}
          </span>
          {origPrice && <span className="hp-prod-card__orig">₪ {origPrice.toLocaleString()}</span>}
        </div>
        <div className="hp-prod-card__stars-row">
          {[1,2,3,4,5].map(s => (
            <svg key={s} width="10" height="10" viewBox="0 0 24 24" fill={s<=4?'#f5a623':'#e5e7eb'}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          ))}
        </div>
        <button className={`hp-prod-card__btn${inCart?' hp-prod-card__btn--in':''}`} onClick={onCart}>
          {inCart ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              {t('home.products.inCart')}
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
              </svg>
              {t('home.products.addToCart')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

const PRODUCTS_INITIAL = 10;

function ProductsSection({ products, loading }: { products: Product[]; loading: boolean }) {
  const { t } = useTranslation('customer');
  const [tab, setTab] = useState<'new'|'deals'>('new');
  const [showAll, setShowAll] = useState(false);
  const shown = tab === 'deals' ? products.filter(p => p.discount_pct != null) : products;
  const visible = showAll ? shown : shown.slice(0, PRODUCTS_INITIAL);
  const hasMore = shown.length > PRODUCTS_INITIAL;

  return (
    <section className="hp-section" id="deals">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">{t('home.products.title')}</h2>
          <div className="hp-tabs">
            <button type="button" className={`hp-tab${tab==='new'?' hp-tab--on':''}`} onClick={() => { setTab('new'); setShowAll(false); }}>{t('home.products.tabBestSelling')}</button>
            <button type="button" className={`hp-tab${tab==='deals'?' hp-tab--on':''}`} onClick={() => { setTab('deals'); setShowAll(false); }}>{t('home.products.tabDeals')}</button>
          </div>
        </div>

        {loading ? (
          <div className="hp-prod-grid">
            {Array.from({ length: PRODUCTS_INITIAL }).map((_, i) => (
              <div key={i} className="hp-prod-card hp-prod-card--sk">
                <div className="hp-sk-rect" />
                <div className="hp-prod-card-sk-body">
                  <div className="hp-sk-line hp-sk-line--80" />
                  <div className="hp-sk-line hp-sk-line--50" />
                  <div className="hp-sk-btn" />
                </div>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="hp-empty">{tab==='deals' ? t('home.products.emptyDeals') : t('home.products.emptyAll')}</p>
        ) : (
          <div className="hp-prod-grid">
            {visible.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )}

        {hasMore && !loading && (
          <div className="hp-center-action">
            <button type="button" className="hp-see-all-btn" onClick={() => setShowAll(v => !v)}>
              {showAll ? t('home.products.showLess') : t('home.products.showMore')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={showAll ? 'hp-chevron-up' : 'hp-chevron-down'}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}



// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { direction } = useLanguage();
  const [cats, setCats] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingProds, setLoadingProds] = useState(true);

  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order')
      .then(({ data, error }) => {
        if (error) console.error('[categories]', error.message, error.code);
        if (data) setCats(data);
        setLoadingCats(false);
      });

    (async () => {
      const { data: shops } = await supabase
        .from('shops')
        .select('shop_id, name, shopLogo, location')
        .order('created_at', { ascending: false });

      const { data: ratings } = await supabase
        .from('shop_ratings')
        .select('shop_id, avg_rating, review_count');

      if (shops) {
        const ratingsMap = new Map((ratings ?? []).map(r => [r.shop_id, r]));
        setStores(shops.map(s => ({
          ...s,
          avg_rating: ratingsMap.get(s.shop_id)?.avg_rating ?? null,
          review_count: ratingsMap.get(s.shop_id)?.review_count ?? 0,
        })));
      }
      setLoadingStores(false);
    })();

    supabase.from('products_with_avg_rating').select('id,title,price,image_urls,discount_pct,stock_Quantity,created_at,shop_id')
      .eq('isPublish', true).order('avg_rating', { ascending: false, nullsFirst: false }).limit(20)
      .then(({ data }) => { if (data) setProducts(data); setLoadingProds(false); });
  }, []);

  return (
    <div dir={direction} className="hp-page">
      <Topbar />
      <HeroSection />
      <CategoriesSection cats={cats} loading={loadingCats} />
      <StoresSection stores={stores} loading={loadingStores} />
      <ProductsSection products={products} loading={loadingProds} />
    </div>
  );
}
