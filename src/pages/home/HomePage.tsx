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

// ── Secondary Nav ─────────────────────────────────────────────────────────────

function SecondaryNav() {
  const navigate = useNavigate();
  const links = [
    { label: 'الصفحة الرئيسية', href: '/store' },
    { label: 'الأقسام', anchor: 'categories' },
    { label: 'المتاجر', anchor: 'stores' },
    { label: 'العروض', anchor: 'deals' },
  ];
  const go = (e: React.MouseEvent<HTMLAnchorElement>, href?: string, anchor?: string) => {
    e.preventDefault();
    if (href) navigate(href);
    else if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
  };
  return (
    <nav className="hp-subnav">
      <div className="hp-subnav__inner">
        {links.map(l => (
          <a key={l.label} href={l.href ?? `#${l.anchor}`} className="hp-subnav__link"
            onClick={e => go(e, l.href, l.anchor)}>
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
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
        {/* Decorative shapes */}
        <div className="hp-hero__bg-circle hp-hero__bg-circle--1" />
        <div className="hp-hero__bg-circle hp-hero__bg-circle--2" />

        <div className="hp-hero__inner">
          {/* RIGHT — main content (RTL: flex-start = visual right) */}
          <div className="hp-hero__content" key={cur}>
            <h1 className="hp-hero__title">{slide.title}</h1>
            <p className="hp-hero__subtitle">{slide.subtitle}</p>
            <button className="hp-hero__cta" onClick={() => navigate('/store')}>تسوق الآن</button>
          </div>

          {/* CENTER — decorative logo mark */}
          <div className="hp-hero__center">
            <div className="hp-hero__emblem">
              <svg width="90" height="90" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="48" fill="rgba(19,101,64,0.08)" />
                <circle cx="50" cy="50" r="35" fill="rgba(19,101,64,0.12)" />
                <path d="M30 55 Q50 35 70 55" stroke="#136540" strokeWidth="3" fill="none" strokeLinecap="round"/>
                <circle cx="50" cy="58" r="10" fill="#136540" opacity="0.15"/>
                <path d="M43 48 L50 38 L57 48" stroke="#136540" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* LEFT — sale box (RTL: flex-end = visual left) */}
          <div className="hp-hero__sale">
            <div className="hp-hero__sale-tag">عروض حصرية!</div>
            <p className="hp-hero__sale-sub">لفترة محدودة</p>
            <p className="hp-hero__sale-pct">
              خصم حتى <strong>30%</strong>
            </p>
            <p className="hp-hero__sale-desc">على مجموعة مختارة</p>
            <button className="hp-hero__sale-btn"
              onClick={() => document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth' })}>
              تسوق الآن
            </button>
          </div>
        </div>

        {/* Arrows */}
        <button className="hp-hero__arr hp-hero__arr--r"
          onClick={() => setCur(c => (c - 1 + SLIDES.length) % SLIDES.length)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button className="hp-hero__arr hp-hero__arr--l"
          onClick={() => setCur(c => (c + 1) % SLIDES.length)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>

        {/* Dots */}
        <div className="hp-hero__dots">
          {SLIDES.map((_, i) => (
            <button key={i} className={`hp-hero__dot${i === cur ? ' hp-hero__dot--on' : ''}`} onClick={() => setCur(i)} />
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
  const navigate = useNavigate();
  return (
    <section className="hp-section" id="categories">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">الأقسام</h2>
        </div>

        {loading ? (
          <div className="hp-cat-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="hp-cat-card hp-cat-card--sk">
                <div className="hp-sk-circle" />
                <div className="hp-sk-line" style={{ width: 56 }} />
              </div>
            ))}
          </div>
        ) : cats.length === 0 ? (
          <p className="hp-empty">لا توجد أقسام حالياً</p>
        ) : (
          <div className="hp-cat-grid">
            {cats.slice(0, 6).map(c => <CategoryCard key={c.id} cat={c} />)}
          </div>
        )}

        <div className="hp-center-action">
          <button className="hp-see-all-btn" onClick={() => navigate('/store')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            عرض جميع الأقسام
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Stores ────────────────────────────────────────────────────────────────────

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
      <div className="hp-store-card__info">
        <p className="hp-store-card__name">{store.name}</p>
        <div className="hp-store-card__rating">
          <svg width="11" height="11" viewBox="0 0 24 24" fill={store.avg_rating ? '#f5a623' : '#d1d5db'}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          {store.avg_rating ? (
            <>
              <span className="hp-store-card__score">{Number(store.avg_rating).toFixed(1)}</span>
              <span className="hp-store-card__cnt">({store.review_count})</span>
            </>
          ) : (
            <span className="hp-store-card__cnt">جديد</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StoresSection({ stores, loading }: { stores: Store[]; loading: boolean }) {
  const navigate = useNavigate();
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => { rowRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' }); };

  return (
    <section className="hp-section hp-section--alt" id="stores">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">متاجر موثوقة</h2>
        </div>

        <div className="hp-store-carousel">
          <button className="hp-carousel-arr hp-carousel-arr--r" onClick={() => scrollBy(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>

          <div className="hp-store-row" ref={rowRef}>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="hp-store-card hp-store-card--sk">
                    <div className="hp-sk-circle hp-sk-circle--sm" />
                    <div style={{ flex: 1 }}>
                      <div className="hp-sk-line" style={{ width: 80 }} />
                      <div className="hp-sk-line" style={{ width: 55, marginTop: 5 }} />
                    </div>
                  </div>
                ))
              : stores.slice(0, 10).map(s => <StoreCard key={s.shop_id} store={s} />)
            }
          </div>

          <button className="hp-carousel-arr hp-carousel-arr--l" onClick={() => scrollBy(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>

        {stores.length === 0 && !loading && <p className="hp-empty">لا توجد متاجر حالياً</p>}

        <div className="hp-center-action">
          <button className="hp-see-all-btn" onClick={() => navigate('/store')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            عرض جميع المتاجر
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Products ──────────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
  const navigate = useNavigate();
  const { addToCart, isInCart } = useShop();
  const img = product.image_urls?.[0] ?? '';
  const inCart = isInCart(product.id);
  const origPrice = product.discount_pct && product.price != null
    ? Math.round(product.price / (1 - product.discount_pct / 100))
    : null;

  const onCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!inCart) addToCart({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  return (
    <div className="hp-prod-card" onClick={() => navigate(`/product/${product.id}`)}>
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

function ProductsSection({ products, loading }: { products: Product[]; loading: boolean }) {
  const [tab, setTab] = useState<'new'|'deals'>('new');
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => { rowRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' }); };
  const shown = tab === 'deals' ? products.filter(p => p.discount_pct != null) : products;

  return (
    <section className="hp-section" id="deals">
      <div className="hp-wrap">
        <div className="hp-section-hd">
          <h2 className="hp-section-title">منتجات حديثة وعروض مميزة</h2>
          <div className="hp-tabs">
            <button className={`hp-tab${tab==='new'?' hp-tab--on':''}`} onClick={() => setTab('new')}>جديدنا</button>
            <button className={`hp-tab${tab==='deals'?' hp-tab--on':''}`} onClick={() => setTab('deals')}>عروض خاصة</button>
          </div>
        </div>

        <div className="hp-prod-carousel">
          <button className="hp-carousel-arr hp-carousel-arr--r" onClick={() => scrollBy(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>

          {loading ? (
            <div className="hp-prod-row" ref={rowRef}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="hp-prod-card hp-prod-card--sk">
                  <div className="hp-sk-rect" />
                  <div style={{padding:'10px 12px'}}>
                    <div className="hp-sk-line" style={{width:'80%'}} />
                    <div className="hp-sk-line" style={{width:'50%',marginTop:6}} />
                    <div className="hp-sk-btn" />
                  </div>
                </div>
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="hp-empty">{tab==='deals'?'لا توجد عروض خاصة':'لا توجد منتجات'}</p>
          ) : (
            <div className="hp-prod-row" ref={rowRef}>
              {shown.slice(0, 10).map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          )}

          <button className="hp-carousel-arr hp-carousel-arr--l" onClick={() => scrollBy(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Newsletter ────────────────────────────────────────────────────────────────

function Newsletter() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const submit = () => { if (email.trim()) setDone(true); };

  return (
    <section className="hp-newsletter">
      <div className="hp-wrap hp-newsletter__inner">
        <div className="hp-newsletter__text">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.8" style={{flexShrink:0}}>
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          <div>
            <h2 className="hp-newsletter__title">اشترك في نشرتنا الإخبارية</h2>
            <p className="hp-newsletter__sub">احصل على أحدث العروض والخصومات مباشرة في بريدك الإلكتروني</p>
          </div>
        </div>
        {done ? (
          <div className="hp-newsletter__ok">✓ شكراً! تم الاشتراك بنجاح</div>
        ) : (
          <div className="hp-newsletter__form">
            <input type="email" className="hp-newsletter__input" placeholder="أدخل بريدك الإلكتروني"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} />
            <button className="hp-newsletter__btn" onClick={submit}>اشترك</button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  const navigate = useNavigate();
  const quick = [
    { l: 'الرئيسية', a: () => navigate('/store') },
    { l: 'المتاجر', a: () => document.getElementById('stores')?.scrollIntoView({behavior:'smooth'}) },
    { l: 'الأقسام', a: () => document.getElementById('categories')?.scrollIntoView({behavior:'smooth'}) },
    { l: 'العروض', a: () => document.getElementById('deals')?.scrollIntoView({behavior:'smooth'}) },
  ];
  const service = ['تواصل معنا', 'الأسئلة الشائعة', 'سياسة الاسترجاع', 'سياسة الشحن', 'تتبع الطلب'];
  const help = ['عن سوق لينك', 'الشروط والأحكام', 'سياسة الخصوصية'];

  return (
    <footer className="hp-footer">
      <div className="hp-wrap hp-footer__grid">
        {/* Brand */}
        <div>
          <div className="hp-footer__brand" onClick={() => navigate('/store')}>
            <img src="/logo.png" alt="Souq Link" className="hp-footer__logo"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div>
              <div className="hp-footer__name-ar">سوق لينك</div>
              <div className="hp-footer__name-en">SOUQ LINK</div>
            </div>
          </div>
          <p className="hp-footer__about">منصة تجمع أفضل المتاجر المحلية الموثوقة.<br />تجربة تسوق مميزة وآمنة.</p>
          <div className="hp-footer__socials">
            {/* Instagram */}
            <a href="#" className="hp-footer__social">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
              </svg>
            </a>
            {/* Facebook */}
            <a href="#" className="hp-footer__social">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
              </svg>
            </a>
            {/* Twitter/X */}
            <a href="#" className="hp-footer__social">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            {/* YouTube */}
            <a href="#" className="hp-footer__social">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.54C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
                <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>
              </svg>
            </a>
          </div>
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">روابط سريعة</h4>
          <ul className="hp-footer__links">{quick.map(x => <li key={x.l}><button className="hp-footer__lbtn" onClick={x.a}>{x.l}</button></li>)}</ul>
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">خدمة العملاء</h4>
          <ul className="hp-footer__links">{service.map(s => <li key={s}><button className="hp-footer__lbtn">{s}</button></li>)}</ul>
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">مساعدة</h4>
          <ul className="hp-footer__links">{help.map(s => <li key={s}><button className="hp-footer__lbtn">{s}</button></li>)}</ul>
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">طرق الدفع</h4>
          <div className="hp-footer__payments">
            {['VISA','MC','PayPal','Apple Pay'].map(p => (
              <span key={p} className="hp-footer__pay">{p}</span>
            ))}
          </div>
        </div>
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
      <SecondaryNav />
      <HeroSection />
      <CategoriesSection cats={cats} loading={loadingCats} />
      <StoresSection stores={stores} loading={loadingStores} />
      <ProductsSection products={products} loading={loadingProds} />
      <Newsletter />
      <Footer />
    </div>
  );
}
