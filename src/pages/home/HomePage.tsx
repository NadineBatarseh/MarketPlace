import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import supabase from '../../lib/supabase';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ProductCard, { ProductCardSkeleton } from '../../components/ProductCard';
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

const SLIDES = [
  { title: 'اكتشف متاجر موثوقة', subtitle: 'تسوق من أفضل المتاجر المحلية في مكان واحد' },
  { title: 'منتجات أصيلة بأسعار منافسة', subtitle: 'اختر من بين آلاف المنتجات من متاجر موثوقة' },
  { title: 'توصيل سريع إلى بابك', subtitle: 'خدمة توصيل احترافية لجميع مناطق فلسطين' },
];

function HeroSection() {
  const navigate = useNavigate();
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    timer.current = setInterval(() => setCur(c => (c + 1) % SLIDES.length), 5000);
    return () => clearInterval(timer.current);
  }, []);

  const slide = SLIDES[cur];

  return (
    <div className="hp-hero-wrap">
      <section className="hp-hero">
        <div className="hp-hero__overlay" />

        <div className="hp-hero__inner">
          <div className="hp-hero__content" key={cur}>
            <h1 className="hp-hero__title">{slide.title}</h1>
            <p className="hp-hero__subtitle">{slide.subtitle}</p>
            <button className="hp-hero__cta" onClick={() => navigate('/stores-list')}>تسوق الآن</button>
          </div>
        </div>

        {/* Arrows */}
        <button type="button" aria-label="السابق" title="السابق" className="hp-hero__arr hp-hero__arr--r"
          onClick={() => setCur(c => (c - 1 + SLIDES.length) % SLIDES.length)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button type="button" aria-label="التالي" title="التالي" className="hp-hero__arr hp-hero__arr--l"
          onClick={() => setCur(c => (c + 1) % SLIDES.length)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>

        {/* Dots */}
        <div className="hp-hero__dots">
          {SLIDES.map((_, i) => (
            <button type="button" key={i} aria-label={`الشريحة ${i + 1}`} title={`الشريحة ${i + 1}`} className={`hp-hero__dot${i === cur ? ' hp-hero__dot--on' : ''}`} onClick={() => setCur(i)} />
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
  return (
    <section className="hp-section" id="categories">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">الفئات</h2>
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
          <p className="hp-empty">لا توجد أقسام حالياً</p>
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
  return (
    <section className="hp-section hp-section--alt" id="stores">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">المتاجر الأعلى تقييما</h2>
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
          <p className="hp-empty">لا توجد متاجر حالياً</p>
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

const PRODUCTS_INITIAL = 10;

function ProductsSection({ products, loading, shopNameMap }: {
  products: Product[]; loading: boolean; shopNameMap: Map<string, string>;
}) {
  const navigate = useNavigate();
  const { addToCart, toggleFavorite, isFavorited } = useShop();
  const { customer } = useCustomerAuth();
  const isCustomer = customer?.role === 'customer';

  const [tab, setTab] = useState<'new'|'deals'>('new');
  const [showAll, setShowAll] = useState(false);
  const shown = tab === 'deals' ? products.filter(p => p.discount_pct != null) : products;
  const visible = showAll ? shown : shown.slice(0, PRODUCTS_INITIAL);
  const hasMore = shown.length > PRODUCTS_INITIAL;

  const onCart = (e: React.MouseEvent, product: Product) => {
    if (!isCustomer) { navigate('/login'); return; }
    const img = product.image_urls?.filter(Boolean)?.[0] ?? '';
    addToCart({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  const onFav = (e: React.MouseEvent, product: Product) => {
    if (!isCustomer) { navigate('/login'); return; }
    const img = product.image_urls?.filter(Boolean)?.[0] ?? '';
    toggleFavorite({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  return (
    <section className="hp-section" id="deals">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">منتجات و عروض مميزة</h2>
          <div className="hp-tabs">
            <button type="button" className={`hp-tab${tab==='new'?' hp-tab--on':''}`} onClick={() => { setTab('new'); setShowAll(false); }}>الاكثر مبيعا</button>
            <button type="button" className={`hp-tab${tab==='deals'?' hp-tab--on':''}`} onClick={() => { setTab('deals'); setShowAll(false); }}>عروض خاصة</button>
          </div>
        </div>

        {loading ? (
          <div className="hp-prod-grid">
            {Array.from({ length: PRODUCTS_INITIAL }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : shown.length === 0 ? (
          <p className="hp-empty">{tab==='deals'?'لا توجد عروض خاصة':'لا توجد منتجات'}</p>
        ) : (
          <div className="hp-prod-grid">
            {visible.map(p => (
              <ProductCard
                key={p.id}
                product={p}
                storeName={shopNameMap.get(p.shop_id)}
                onAddToCart={onCart}
                onToggleFavorite={onFav}
                isFavorited={isFavorited(p.id)}
              />
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <div className="hp-center-action">
            <button type="button" className="hp-see-all-btn" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'عرض أقل' : 'عرض المزيد من المنتجات'}
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

  const shopNameMap = useMemo(() => new Map(stores.map(s => [s.shop_id, s.name])), [stores]);

  return (
    <div dir="rtl" className="hp-page">
      <Topbar />
      <HeroSection />
      <CategoriesSection cats={cats} loading={loadingCats} />
      <StoresSection stores={stores} loading={loadingStores} />
      <ProductsSection products={products} loading={loadingProds} shopNameMap={shopNameMap} />
    </div>
  );
}
