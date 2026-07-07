import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight,
  ArrowUpDown, Store, LayoutGrid, Search,
} from 'lucide-react';
import Topbar from '../../components/Topbar';
import supabase from '../../lib/supabase';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ProductCard, { ProductCardSkeleton } from '../../components/ProductCard';
import './OffersPage.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  label: string;
}

interface Shop {
  shop_id: string;
  name: string;
  Type_of_store: string | null;
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
  avg_rating: number | null;
  review_count: number;
}

type SortKey = 'discount_desc' | 'discount_asc' | 'price_asc' | 'price_desc' | 'newest' | 'bestselling';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'discount_desc', label: 'الأكثر خصماً' },
  { value: 'discount_asc', label: 'الأقل خصماً' },
  { value: 'price_asc', label: 'السعر: من الأقل إلى الأعلى' },
  { value: 'price_desc', label: 'السعر: من الأعلى إلى الأقل' },
  { value: 'newest', label: 'الأحدث' },
  { value: 'bestselling', label: 'الأكثر مبيعاً' },
];

// ── Hero ──────────────────────────────────────────────────────────────────────

const HERO_ILLUSTRATION_URL = 'https://mcwyxtfpbugatggbrgba.supabase.co/storage/v1/object/public/Offer_heroSection_image/icon1.png';

const OFFER_SLIDES = [
  { badge: 'عروض حصرية', heading: 'خصم حتى', pct: '25%', subtitle: 'على مجموعة مختارة من المنتجات لفترة محدودة' },
  { badge: 'عروض الصيف', heading: 'خصم حتى', pct: '40%', subtitle: 'خصومات مميزة على منتجات الموسم' },
  { badge: 'العودة للمدارس', heading: 'خصم حتى', pct: '30%', subtitle: 'جهّز مستلزمات العام الدراسي بأفضل الأسعار' },
  { badge: 'شحن مجاني', heading: 'شحن مجاني', pct: 'فوق ₪150', subtitle: 'اطلب الآن واستمتع بتوصيل مجاني لباب البيت' },
  { badge: 'عروض نهاية الأسبوع', heading: 'خصم حتى', pct: '20%', subtitle: 'خصومات إضافية لفترة محدودة فقط' },
];

function OffersHero({ onShopNow }: { onShopNow: () => void }) {
  const navigate = useNavigate();
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    timer.current = setInterval(() => setCur(c => (c + 1) % OFFER_SLIDES.length), 4500);
    return () => clearInterval(timer.current);
  }, []);

  const slide = OFFER_SLIDES[cur];

  return (
    <section className="ofr-hero-section">
      <nav className="ofr-breadcrumb">
        <a href="#" onClick={e => { e.preventDefault(); navigate('/home'); }}>الرئيسية</a>
        <ChevronLeft size={13} />
        <span className="ofr-breadcrumb-current">العروض</span>
      </nav>

      <div className="ofr-hero-card">
        <div className="ofr-hero-card__confetti" aria-hidden>
          <span /><span /><span /><span /><span /><span />
        </div>

        <div className="ofr-hero-card__content" key={cur}>
          <span className="ofr-hero-card__badge">{slide.badge}</span>
          <p className="ofr-hero-card__heading-line">
            <span className="ofr-hero-card__heading">{slide.heading}</span>
            <span className="ofr-hero-card__pct">{slide.pct}</span>
          </p>
          <p className="ofr-hero-card__subtitle">{slide.subtitle}</p>
          <button type="button" className="ofr-hero-card__cta" onClick={onShopNow}>
            تسوق الآن
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="ofr-hero-card__illustration" aria-hidden>
          <img src={HERO_ILLUSTRATION_URL} alt="" className="ofr-hero-card__illustration-img" />
        </div>

        <button type="button" aria-label="السابق" title="السابق" className="ofr-hero-card__arr ofr-hero-card__arr--r"
          onClick={() => setCur(c => (c - 1 + OFFER_SLIDES.length) % OFFER_SLIDES.length)}>
          <ChevronRight size={18} />
        </button>
        <button type="button" aria-label="التالي" title="التالي" className="ofr-hero-card__arr ofr-hero-card__arr--l"
          onClick={() => setCur(c => (c + 1) % OFFER_SLIDES.length)}>
          <ChevronLeft size={18} />
        </button>
      </div>

      <div className="ofr-hero-dots">
        {OFFER_SLIDES.map((_, i) => (
          <button type="button" key={i} aria-label={`الشريحة ${i + 1}`} title={`الشريحة ${i + 1}`}
            className={`ofr-hero-dot${i === cur ? ' ofr-hero-dot--on' : ''}`} onClick={() => setCur(i)} />
        ))}
      </div>
    </section>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  categories: Category[];
  stores: { shop_id: string; name: string }[];
  categoryId: string;
  storeId: string;
  sortBy: SortKey;
  search: string;
  resultCount: number;
  onCategoryChange: (v: string) => void;
  onStoreChange: (v: string) => void;
  onSortChange: (v: SortKey) => void;
  onSearchChange: (v: string) => void;
}

function FilterBar({
  categories, stores, categoryId, storeId, sortBy, search,
  onCategoryChange, onStoreChange, onSortChange, onSearchChange,
}: FilterBarProps) {
  return (
    <div className="ofr-filterbar">
      <div className="ofr-filterbar__inner">
        <div className="ofr-pill">
          <LayoutGrid size={14} className="ofr-pill-icon" />
          <select className="ofr-pill-select" value={categoryId} onChange={e => onCategoryChange(e.target.value)} aria-label="الفئات">
            <option value="all">الفئات</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="ofr-pill-chevron"><polyline points="6 9 12 15 18 9" /></svg>
        </div>

        <div className="ofr-pill">
          <Store size={14} className="ofr-pill-icon" />
          <select className="ofr-pill-select" value={storeId} onChange={e => onStoreChange(e.target.value)} aria-label="المحلات">
            <option value="all">المحلات</option>
            {stores.map(s => <option key={s.shop_id} value={s.shop_id}>{s.name}</option>)}
          </select>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="ofr-pill-chevron"><polyline points="6 9 12 15 18 9" /></svg>
        </div>

        <div className="ofr-pill">
          <ArrowUpDown size={14} className="ofr-pill-icon" />
          <select className="ofr-pill-select" value={sortBy} onChange={e => onSortChange(e.target.value as SortKey)} aria-label="ترتيب حسب">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="ofr-pill-chevron"><polyline points="6 9 12 15 18 9" /></svg>
        </div>

        <div className="ofr-search-wrap">
          <Search size={14} className="ofr-search-icon" />
          <input
            type="text"
            className="ofr-search-input"
            placeholder="ابحث في العروض..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="ofr-empty">
      <div className="ofr-empty__ico">
        <svg viewBox="0 0 80 80" width="72" height="72" fill="none">
          <circle cx="40" cy="40" r="38" fill="#f0fdf4" />
          <circle cx="35" cy="32" r="16" stroke="#136540" strokeWidth="2.5" />
          <path d="M47 44l12 12" stroke="#136540" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M28 32h14M35 25v14" stroke="#136540" strokeWidth="2" strokeLinecap="round" opacity=".4" />
        </svg>
      </div>
      <h3 className="ofr-empty__title">لا توجد عروض مطابقة للفلاتر المحددة</h3>
      <button type="button" className="ofr-empty__btn" onClick={onReset}>إعادة تعيين الفلاتر</button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OffersPage() {
  const navigate = useNavigate();
  const { addToCart } = useShop();
  const { customer } = useCustomerAuth();
  const isCustomer = customer?.role === 'customer';

  const [cats, setCats] = useState<Category[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [categoryId, setCategoryId] = useState('all');
  const [storeId, setStoreId] = useState('all');
  const [sortBy, setSortBy] = useState<SortKey>('discount_desc');
  const [search, setSearch] = useState('');

  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('categories').select('id,label').order('sort_order')
      .then(({ data }) => { if (data) setCats(data); });

    supabase.from('shops').select('shop_id, name, Type_of_store')
      .neq('status', 'suspended').not('is_archived', 'eq', true)
      .then(({ data }) => { if (data) setShops(data as Shop[]); });

    supabase.from('products_with_avg_rating')
      .select('id,title,price,image_urls,discount_pct,stock_Quantity,created_at,shop_id,avg_rating,review_count')
      .eq('isPublish', true).gt('discount_pct', 0)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setProducts(data as Product[]); setLoading(false); });
  }, []);

  const shopMap = useMemo(() => new Map(shops.map(s => [s.shop_id, s])), [shops]);

  const allStores = useMemo(() => (
    shops
      .map(s => ({ shop_id: s.shop_id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  ), [shops]);

  const selectedCategoryLabel = useMemo(
    () => cats.find(c => c.id === categoryId)?.label ?? null,
    [cats, categoryId],
  );

  const filteredSorted = useMemo(() => {
    let list = products;

    if (selectedCategoryLabel) {
      list = list.filter(p => shopMap.get(p.shop_id)?.Type_of_store === selectedCategoryLabel);
    }
    if (storeId !== 'all') {
      list = list.filter(p => p.shop_id === storeId);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(p => p.title.toLowerCase().includes(q));
    }

    const sorted = [...list];
    switch (sortBy) {
      case 'discount_desc': sorted.sort((a, b) => (b.discount_pct ?? 0) - (a.discount_pct ?? 0)); break;
      case 'discount_asc': sorted.sort((a, b) => (a.discount_pct ?? 0) - (b.discount_pct ?? 0)); break;
      case 'price_asc': sorted.sort((a, b) => (a.price ?? 0) - (b.price ?? 0)); break;
      case 'price_desc': sorted.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)); break;
      case 'newest': sorted.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()); break;
      case 'bestselling': sorted.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || (b.review_count ?? 0) - (a.review_count ?? 0)); break;
    }
    return sorted;
  }, [products, shopMap, selectedCategoryLabel, storeId, search, sortBy]);

  function resetFilters() {
    setCategoryId('all');
    setStoreId('all');
    setSortBy('discount_desc');
    setSearch('');
  }

  function scrollToGrid() {
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onAddToCart(e: React.MouseEvent, product: Product) {
    if (!isCustomer) { navigate('/login'); return; }
    const img = product.image_urls?.filter(Boolean)?.[0] ?? '';
    addToCart({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  }

  return (
    <div dir="rtl" className="ofr-page">
      <Topbar />

      <OffersHero onShopNow={scrollToGrid} />

      <FilterBar
        categories={cats}
        stores={allStores}
        categoryId={categoryId}
        storeId={storeId}
        sortBy={sortBy}
        search={search}
        resultCount={filteredSorted.length}
        onCategoryChange={setCategoryId}
        onStoreChange={setStoreId}
        onSortChange={setSortBy}
        onSearchChange={setSearch}
      />

      <div className="ofr-wrap" ref={gridRef}>
        <div className="ofr-result-count">{filteredSorted.length} عرض متاح</div>

        {loading ? (
          <div className="ofr-grid">
            {Array.from({ length: 12 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : filteredSorted.length === 0 ? (
          <EmptyState onReset={resetFilters} />
        ) : (
          <div className="ofr-grid">
            {filteredSorted.map(p => (
              <ProductCard key={p.id} product={p} storeName={shopMap.get(p.shop_id)?.name} onAddToCart={onAddToCart} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
