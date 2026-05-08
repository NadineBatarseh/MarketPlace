import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import supabase from '../../lib/supabase';
import { useShop } from '../../context/ShopContext';
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
    <button className="hp-cat-card" onClick={() => navigate(`/search?category=${cat.id}`)}>
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
          <h2 className="hp-section-title">المتاجر الأعلى تقييماً</h2>
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
            {stores.map(s => <StoreCard key={s.shop_id} store={s} />)}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Products ──────────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
  const navigate = useNavigate();
  const { addToCart, isInCart, toggleFavorite, isFavorited } = useShop();
  const img = product.image_urls?.[0] ?? '';
  const inCart = isInCart(product.id);
  const origPrice = product.discount_pct && product.price != null
    ? Math.round(product.price / (1 - product.discount_pct / 100))
    : null;

  const onCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!inCart) addToCart({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  const onFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  const faved = isFavorited(product.id);

  return (
    <div className="hp-prod-card" onClick={() => navigate(`/product/${product.id}`)}>
      {/* Favorite button */}
      <button type="button" className={`hp-prod-card__fav${faved ? ' hp-prod-card__fav--on' : ''}`} onClick={onFav} aria-label="أضف للمفضلة">
        <svg width="15" height="15" viewBox="0 0 24 24" fill={faved ? '#136540' : 'none'} stroke={faved ? '#136540' : '#9ca3af'} strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </button>
      {/* Badges */}
      <div className="hp-prod-card__badges">
        {product.discount_pct != null ? (
          <span className="hp-prod-badge hp-prod-badge--disc">خصم {product.discount_pct}%</span>
        ) : (
          <span className="hp-prod-badge hp-prod-badge--new">جديد</span>
        )}
      </div>

      {/* Image */}
      <div className="hp-prod-card__img-wrap">
        {img
          ? <img src={img} alt={product.title} className="hp-prod-card__img" loading="lazy" />
          : <div className="hp-prod-card__img-ph">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
              </svg>
            </div>
        }
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
              في السلة
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
              </svg>
              أضف إلى السلة
            </>
          )}
        </button>
      </div>
    </div>
  );
}

const PRODUCTS_INITIAL = 10;

function ProductsSection({ products, loading }: { products: Product[]; loading: boolean }) {
  const [tab, setTab] = useState<'new'|'deals'>('new');
  const [showAll, setShowAll] = useState(false);
  const shown = tab === 'deals' ? products.filter(p => p.discount_pct != null) : products;
  const visible = showAll ? shown : shown.slice(0, PRODUCTS_INITIAL);
  const hasMore = shown.length > PRODUCTS_INITIAL;

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
          <p className="hp-empty">{tab==='deals'?'لا توجد عروض خاصة':'لا توجد منتجات'}</p>
        ) : (
          <div className="hp-prod-grid">
            {visible.map(p => <ProductCard key={p.id} product={p} />)}
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

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const quick = [
    { l: 'الرئيسية', a: () => navigate('/store') },
    { l: 'المتاجر', a: () => document.getElementById('stores')?.scrollIntoView({behavior:'smooth'}) },
    { l: 'الفئات', a: () => document.getElementById('categories')?.scrollIntoView({behavior:'smooth'}) },
    { l: 'العروض', a: () => document.getElementById('deals')?.scrollIntoView({behavior:'smooth'}) },
  ];
  const service = ['تواصل معنا', 'الأسئلة الشائعة', 'سياسة الاسترجاع', 'سياسة الشحن', 'تتبع الطلب'];
  const help = ['عن سوق لينك', 'الشروط والأحكام', 'سياسة الخصوصية'];

  return (
    <footer className="hp-footer">
      <div className="hp-wrap hp-footer__grid">
        {/* Brand — always visible */}
        <div>
          <div className="hp-footer__brand" onClick={() => navigate('/store')}>
            <img src="/logo.png" alt="Souq Link" className="hp-footer__logo"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div>
              <div className="hp-footer__name-ar">سوق لينك</div>
              <div className="hp-footer__name-en">SOUQ LINK</div>
            </div>
          </div>
          {open && (
            <>
              <p className="hp-footer__about">منصة تجمع أفضل المتاجر المحلية الموثوقة.<br />تجربة تسوق مميزة وآمنة.</p>
              <div className="hp-footer__socials">
                <a href="#" className="hp-footer__social" title="Instagram" aria-label="Instagram">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                </a>
                <a href="#" className="hp-footer__social" title="Facebook" aria-label="Facebook">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
                  </svg>
                </a>
                <a href="#" className="hp-footer__social" title="Twitter / X" aria-label="Twitter / X">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
                <a href="#" className="hp-footer__social" title="YouTube" aria-label="YouTube">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.54C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
                    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>
                  </svg>
                </a>
              </div>
            </>
          )}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">روابط سريعة</h4>
          {open && <ul className="hp-footer__links">{quick.map(x => <li key={x.l}><button type="button" className="hp-footer__lbtn" onClick={x.a}>{x.l}</button></li>)}</ul>}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">خدمة العملاء</h4>
          {open && <ul className="hp-footer__links">{service.map(s => <li key={s}><button type="button" className="hp-footer__lbtn">{s}</button></li>)}</ul>}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">مساعدة</h4>
          {open && <ul className="hp-footer__links">{help.map(s => <li key={s}><button type="button" className="hp-footer__lbtn">{s}</button></li>)}</ul>}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">طرق الدفع</h4>
          {open && (
            <div className="hp-footer__payments">
              {['VISA','MC','PayPal','Apple Pay'].map(p => (
                <span key={p} className="hp-footer__pay">{p}</span>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="hp-footer__toggle" onClick={() => setOpen(o => !o)} aria-label="تبديل الفوتر">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={open ? 'hp-footer__toggle-icon hp-footer__toggle-icon--open' : 'hp-footer__toggle-icon'}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
      </div>

      <div className="hp-footer__bottom">
        <div className="hp-wrap hp-footer__bottom-inner">
          <p>جميع الحقوق محفوظة © 2026 سوق لينك</p>
        </div>
      </div>
    </footer>
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

    fetch('/api/stores').then(r => r.json())
      .then(d => { if (d.ok) setStores(d.stores); })
      .catch(() => {})
      .finally(() => setLoadingStores(false));

    supabase.from('products').select('id,title,price,image_urls,discount_pct,shop_id')
      .eq('isPublish', true).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) setProducts(data); setLoadingProds(false); });
  }, []);

  return (
    <div dir="rtl" className="hp-page">
      <Topbar />
      <HeroSection />
      <CategoriesSection cats={cats} loading={loadingCats} />
      <StoresSection stores={stores} loading={loadingStores} />
      <ProductsSection products={products} loading={loadingProds} />
      <Footer />
    </div>
  );
}
