import {
  useState, useEffect, useCallback, useMemo, type FormEvent, type ReactNode,
} from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import supabase from '../../lib/supabase';
import { useShop } from '../../context/ShopContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ProductCard, { ProductCardSkeleton } from '../../components/ProductCard';
import './SearchResultsPage.css';

/* ═══════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════ */
interface Product {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_urls: string[] | string | null;
  stock_Quantity: number | null;
  discount_pct: number | null;
  created_at: string | null;
  shops: { name: string; location: string | null } | null;
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
interface Zone { id: string; name: string; }
interface RatingData { avg: number; count: number; }
type RatingsMap = Record<string, RatingData>;
type SortOption = 'newest' | 'price_asc' | 'price_desc' | 'rating';

function firstImg(urls: Product['image_urls']): string | null {
  if (!urls) return null;
  return Array.isArray(urls) ? (urls[0] ?? null) : urls;
}

interface FilterState {
  rating4: boolean; rating3: boolean; rating5: boolean;
  inStock: boolean; outOfStock: boolean;
}

/* ═══════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════ */
const LIMIT     = 20;
const PRICE_MAX = 500;


const INIT_FILTERS: FilterState = {
  rating4: false, rating3: false, rating5: false,
  inStock: false, outOfStock: false,
};

/* ═══════════════════════════════════════════════
   DUAL RANGE SLIDER
═══════════════════════════════════════════════ */
function DualRange({
  minVal, maxVal,
  onMin, onMax,
}: {
  minVal: number; maxVal: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
}) {
  const pct = (v: number) => Math.round((v / PRICE_MAX) * 100);
  return (
    <div className="srp-dual-range" dir="ltr">
      <div className="srp-dr-bg" />
      <div
        className="srp-dr-fill"
        style={{ left: `${pct(minVal)}%`, right: `${100 - pct(maxVal)}%` }}
      />
      <input type="range" min={0} max={PRICE_MAX} value={minVal}
        className="srp-dr-input"
        style={{ zIndex: minVal > PRICE_MAX - 60 ? 5 : 3 }}
        aria-label="الحد الأدنى للسعر"
        onChange={e => onMin(Math.min(+e.target.value, maxVal - 10))}
      />
      <input type="range" min={0} max={PRICE_MAX} value={maxVal}
        className="srp-dr-input srp-dr-input--max"
        aria-label="الحد الأقصى للسعر"
        onChange={e => onMax(Math.max(+e.target.value, minVal + 10))}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   FILTER SECTION (collapsible)
═══════════════════════════════════════════════ */
function FSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="srp-fsec">
      <button type="button" className="srp-fsec-hdr" onClick={() => setOpen(v => !v)}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"
          className="srp-fsec-chevron"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span className="srp-fsec-title">{title}</span>
      </button>
      {open && <div className="srp-fsec-body">{children}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CHECKBOX
═══════════════════════════════════════════════ */
function CB({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: () => void;
}) {
  return (
    <label className="srp-cb">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

/* ═══════════════════════════════════════════════
   FILTER PANEL
═══════════════════════════════════════════════ */
interface FPProps {
  filters: FilterState;
  selectedCities: string[];
  toggle: (k: keyof FilterState) => void;
  toggleCity: (city: string) => void;
  zones: Zone[];
  localMin: number; localMax: number;
  setLocalMin: (v: number) => void;
  setLocalMax: (v: number) => void;
  onApply: (e: FormEvent) => void;
  onClear: () => void;
  activeCount: number;
}

function FilterPanel({
  filters, selectedCities, toggle, toggleCity, zones,
  localMin, localMax, setLocalMin, setLocalMax,
  onApply, onClear, activeCount,
}: FPProps) {
  const [minDraft, setMinDraft] = useState(String(localMin));
  const [maxDraft, setMaxDraft] = useState(String(localMax));

  useEffect(() => setMinDraft(String(localMin)), [localMin]);
  useEffect(() => setMaxDraft(String(localMax)), [localMax]);

  function commitMin(raw: string) {
    const v = Math.min(Math.max(0, parseInt(raw) || 0), localMax - 10);
    setLocalMin(v);
    setMinDraft(String(v));
  }
  function commitMax(raw: string) {
    const v = Math.max(Math.min(PRICE_MAX, parseInt(raw) || PRICE_MAX), localMin + 10);
    setLocalMax(v);
    setMaxDraft(String(v));
  }

  return (
    <div className="srp-filter">
      <div className="srp-filter-hdr">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#136540" strokeWidth="2">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/>
          <line x1="11" y1="18" x2="13" y2="18"/>
        </svg>
        <span className="srp-filter-title">تصفية النتائج</span>
        {activeCount > 0 && (
          <button type="button" className="srp-clear-btn" onClick={onClear}>
            مسح الكل
            <span className="srp-clear-badge">{activeCount}</span>
          </button>
        )}
      </div>

      {/* السعر */}
      <FSection title="السعر">
        <DualRange minVal={localMin} maxVal={localMax} onMin={setLocalMin} onMax={setLocalMax} />
        <form onSubmit={onApply} className="srp-price-row">
          <div className="srp-price-box">
            <span className="srp-price-lbl">من</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              dir="ltr"
              value={minDraft}
              onChange={e => setMinDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => commitMin(minDraft)}
              onKeyDown={e => e.key === 'Enter' && commitMin(minDraft)}
              className="srp-price-in"
              aria-label="الحد الأدنى للسعر"
              title="الحد الأدنى للسعر"
              placeholder="0"
            />
          </div>
          <div className="srp-price-box">
            <span className="srp-price-lbl">إلى</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              dir="ltr"
              value={maxDraft}
              onChange={e => setMaxDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => commitMax(maxDraft)}
              onKeyDown={e => e.key === 'Enter' && commitMax(maxDraft)}
              className="srp-price-in"
              aria-label="الحد الأقصى للسعر"
              title="الحد الأقصى للسعر"
              placeholder="200"
            />
            <span className="srp-price-cur">₪</span>
          </div>
        </form>
        <button type="button" onClick={e => onApply(e as unknown as FormEvent)}
          className="srp-apply-price">تطبيق</button>
      </FSection>

      {/* التقييم */}
      <FSection title="التقييم">
        <CB label="4★ فأعلى" checked={filters.rating4} onChange={() => toggle('rating4')} />
        <CB label="3★ فأعلى" checked={filters.rating3} onChange={() => toggle('rating3')} />
        <CB label="5★ فقط"   checked={filters.rating5} onChange={() => toggle('rating5')} />
      </FSection>

      {/* المنطقة */}
      <FSection title="المنطقة">
        {zones.map(zone => (
          <CB
            key={zone.id}
            label={zone.name}
            checked={selectedCities.includes(zone.name)}
            onChange={() => toggleCity(zone.name)}
          />
        ))}
      </FSection>

      {/* التوفر */}
      <FSection title="التوفر">
        <CB label="متوفر"       checked={filters.inStock}    onChange={() => toggle('inStock')} />
        <CB label="نفدت الكمية" checked={filters.outOfStock} onChange={() => toggle('outOfStock')} />
      </FSection>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════════ */
function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="srp-empty">
      <div className="srp-empty-ico">
        <svg viewBox="0 0 80 80" width="72" height="72" fill="none">
          <circle cx="40" cy="40" r="38" fill="#f0fdf4"/>
          <circle cx="35" cy="32" r="16" stroke="#136540" strokeWidth="2.5"/>
          <path d="M47 44l12 12" stroke="#136540" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M28 32h14M35 25v14" stroke="#136540" strokeWidth="2" strokeLinecap="round" opacity=".4"/>
        </svg>
      </div>
      <h3 className="srp-empty-title">لم نجد نتائج مطابقة</h3>
      <p className="srp-empty-sub">جرّب البحث بكلمة أخرى أو تصفح الفئات لاكتشاف منتجات من السوق المحلي</p>
      <button type="button" className="srp-empty-btn" onClick={onBrowse}>تصفح الفئات</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   PAGE NUMBERS helper
═══════════════════════════════════════════════ */
function pageNums(total: number, cur: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  if (cur > 3)           out.push('…');
  for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) out.push(i);
  if (cur < total - 2)   out.push('…');
  out.push(total);
  return out;
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════ */
export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  /* ── URL state ── */
  const q          = searchParams.get('q') ?? '';
  const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const minPrice   = searchParams.get('min_price') ?? '';
  const maxPrice   = searchParams.get('max_price') ?? '';
  const citiesParam = searchParams.get('cities') ?? '';
  // Memoised so the array reference stays stable between renders (avoids fetch loop)
  const selectedCities = useMemo(
    () => citiesParam.split(',').filter(Boolean),
    [citiesParam],
  );

  /* ── Server state ── */
  const [results, setResults]     = useState<SearchResponse | null>(null);
  const [ratingsMap, setRatingsMap] = useState<RatingsMap>({});
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  /* ── Zones (cities) ── */
  const [zones, setZones] = useState<Zone[]>([]);
  useEffect(() => {
    supabase.from('zones').select('id, name').order('name').then(({ data }) => {
      if (data) setZones(data);
    });
  }, []);

  /* ── Fetch ratings for current page of results ── */
  useEffect(() => {
    if (!results?.products.length) { setRatingsMap({}); return; }
    const ids = results.products.map(p => p.id);
    supabase
      .from('Reviews')
      .select('product_id, rating')
      .in('product_id', ids)
      .then(({ data }) => {
        if (!data) return;
        const acc: Record<string, { sum: number; count: number }> = {};
        for (const row of data) {
          if (!row.product_id) continue;
          if (!acc[row.product_id]) acc[row.product_id] = { sum: 0, count: 0 };
          acc[row.product_id].sum   += Number(row.rating);
          acc[row.product_id].count += 1;
        }
        const map: RatingsMap = {};
        for (const [id, { sum, count }] of Object.entries(acc)) {
          map[id] = { avg: sum / count, count };
        }
        setRatingsMap(map);
      });
  }, [results]);

  /* ── Price filter (local — applied on submit) ── */
  const [localMin, setLocalMin] = useState(parseInt(minPrice) || 0);
  const [localMax, setLocalMax] = useState(parseInt(maxPrice) || 200);

  /* ── Other filters (client-side) ── */
  const [filters, setFilters] = useState<FilterState>(INIT_FILTERS);

  const toggle = useCallback((k: keyof FilterState) => {
    setFilters(f => ({ ...f, [k]: !f[k] }));
  }, []);

  const toggleCity = useCallback((city: string) => {
    const next = new URLSearchParams(searchParams);
    const updated = selectedCities.includes(city)
      ? selectedCities.filter(c => c !== city)
      : [...selectedCities, city];
    updated.length > 0 ? next.set('cities', updated.join(',')) : next.delete('cities');
    next.set('page', '1');
    setSearchParams(next);
  }, [searchParams, setSearchParams, selectedCities]);

  const clearFilters = useCallback(() => {
    setFilters(INIT_FILTERS);
    setLocalMin(0);
    setLocalMax(200);
    const next = new URLSearchParams(searchParams);
    next.delete('min_price');
    next.delete('max_price');
    next.delete('cities');
    next.set('page', '1');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  /* ── UI state ── */
  const [sortBy, setSortBy]       = useState<SortOption>('newest');
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* ── Cart & favorites ── */
  const { addToCart, toggleFavorite, isFavorited } = useShop();
  const { customer } = useCustomerAuth();
  const isCustomer = customer?.role === 'customer';

  const onAddToCart = (e: React.MouseEvent, product: Product) => {
    if (!isCustomer) { navigate('/login'); return; }
    const img = firstImg(product.image_urls) ?? '';
    addToCart({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  const onToggleFavorite = (e: React.MouseEvent, product: Product) => {
    if (!isCustomer) { navigate('/login'); return; }
    const img = firstImg(product.image_urls) ?? '';
    toggleFavorite({ id: product.id, name: product.title, image: img, price: product.price ?? 0 });
  };

  /* ── Fetch ── */
  const fetchResults = useCallback(async () => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ q, page: String(page), limit: String(LIMIT) });
      if (minPrice) p.set('min_price', minPrice);
      if (maxPrice) p.set('max_price', maxPrice);
      if (citiesParam) p.set('cities', citiesParam);
      const res  = await fetch(`/api/search?${p}`);
      const data: SearchResponse = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'خطأ في البحث');
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في البحث');
    } finally {
      setLoading(false);
    }
  }, [q, page, minPrice, maxPrice, citiesParam]);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  /* ── Apply price filter ── */
  function applyPrice(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    next.set('page', '1');
    localMin > 0 ? next.set('min_price', String(localMin)) : next.delete('min_price');
    localMax < PRICE_MAX ? next.set('max_price', String(localMax)) : next.delete('max_price');
    setSearchParams(next);
  }

  /* ── Pagination ── */
  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Active filter count ── */
  const activeCount = useMemo(() =>
    selectedCities.length +
    (filters.rating4 ? 1 : 0) +
    (filters.rating3 ? 1 : 0) +
    (filters.rating5 ? 1 : 0) +
    (filters.inStock ? 1 : 0) +
    (filters.outOfStock ? 1 : 0) +
    (localMin > 0 || localMax < 200 ? 1 : 0),
  [filters, selectedCities, localMin, localMax]);

  /* ── Client filter + sort ── */
  const sorted = useMemo(() => {
    if (!results?.products) return [];

    const ratingActive = filters.rating4 || filters.rating3 || filters.rating5;
    const stockActive  = filters.inStock || filters.outOfStock;

    let ps = results.products.filter(p => {
      if (ratingActive) {
        const r = ratingsMap[p.id]?.avg ?? null;
        if (r === null) return false;
        const match =
          (filters.rating5 && r >= 4.5) ||
          (filters.rating4 && r >= 4.0 && r < 4.5) ||
          (filters.rating3 && r >= 3.0 && r < 4.0);
        if (!match) return false;
      }

      if (stockActive) {
        const oos = p.stock_Quantity === 0;
        const match =
          (filters.inStock    && !oos) ||
          (filters.outOfStock &&  oos);
        if (!match) return false;
      }

      return true;
    });

    if (sortBy === 'price_asc')  return [...ps].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    if (sortBy === 'price_desc') return [...ps].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    if (sortBy === 'rating')     return [...ps].sort((a, b) => (ratingsMap[b.id]?.avg ?? 0) - (ratingsMap[a.id]?.avg ?? 0));
    return ps;
  }, [results?.products, sortBy, filters, ratingsMap]);

  const totalPages = results ? Math.ceil(results.total / LIMIT) : 0;

  const fpProps: FPProps = {
    filters, selectedCities, toggle, toggleCity, zones,
    localMin, localMax, setLocalMin, setLocalMax,
    onApply: applyPrice,
    onClear: clearFilters,
    activeCount,
  };

  const hasProducts = !loading && !error && sorted.length > 0;

  return (
    <div dir="rtl" className="srp-page">
      <Topbar />

      <div className="srp-container">

        {/* ══ Title row ══ */}
        <div className="srp-title-row">
          <div className="srp-title-main">
            <h1 className="srp-h1">
              نتائج البحث عن: {q && <span className="srp-q"> {q}</span>}
            </h1>
            {q && <p className="srp-h1-sub">وجدنا لك منتجات ومتاجر مناسبة من السوق المحلي</p>}
          </div>
        </div>

        {/* ══ Two-column layout ══ */}
        <div className="srp-layout">

          {/* RIGHT col (RTL start): filter panel */}
          <aside className="srp-sidebar">
            <FilterPanel {...fpProps} />
          </aside>

          {/* LEFT col (RTL end): toolbar + grid */}
          <main className="srp-main">

            {/* Toolbar (desktop) */}
            <div className="srp-toolbar">
              <div className="srp-sort-grp">
                <span className="srp-sort-lbl">ترتيب حسب</span>
                <div className="srp-select-wrap">
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="srp-select"
                    aria-label="ترتيب النتائج"
                  >
                    <option value="newest">الأحدث</option>
                    <option value="price_asc">السعر الأقل</option>
                    <option value="price_desc">السعر الأعلى</option>
                    <option value="rating">الأعلى تقييمًا</option>
                  </select>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
                    stroke="currentColor" strokeWidth="2.5" className="srp-sel-chevron">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
              </div>

              {results && (
                <span className="srp-toolbar-count">عرض {sorted.length} نتيجة</span>
              )}
            </div>

            {/* Mobile bar */}
            <div className="srp-mobile-bar">
              <button type="button" className="srp-mob-filter" onClick={() => setDrawerOpen(true)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/>
                  <line x1="11" y1="18" x2="13" y2="18"/>
                </svg>
                الفلاتر
                {activeCount > 0 && <span className="srp-mob-badge">{activeCount}</span>}
              </button>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}
                className="srp-select srp-select--sm" aria-label="ترتيب النتائج">
                <option value="newest">الأحدث</option>
                <option value="price_asc">السعر ↑</option>
                <option value="price_desc">السعر ↓</option>
                <option value="rating">الأعلى تقييمًا</option>
              </select>
            </div>

            {/* Loading */}
            {loading && (
              <div className="srp-grid">
                {Array.from({ length: 10 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <EmptyState onBrowse={fetchResults} />
            )}

            {/* No results after filtering */}
            {!loading && !error && results && sorted.length === 0 && (
              <div className="srp-empty">
                <div className="srp-empty-ico">
                  <svg viewBox="0 0 80 80" width="72" height="72" fill="none">
                    <circle cx="40" cy="40" r="38" fill="#f0fdf4"/>
                    <circle cx="35" cy="32" r="16" stroke="#136540" strokeWidth="2.5"/>
                    <path d="M47 44l12 12" stroke="#136540" strokeWidth="2.5" strokeLinecap="round"/>
                    <path d="M28 32h14M35 25v14" stroke="#136540" strokeWidth="2" strokeLinecap="round" opacity=".4"/>
                  </svg>
                </div>
                <h3 className="srp-empty-title">لا توجد نتائج بهذه الفلاتر</h3>
                <p className="srp-empty-sub">جرّب تغيير الفلاتر أو مسحها للاطلاع على جميع النتائج</p>
                <button type="button" className="srp-empty-btn" onClick={clearFilters}>مسح الفلاتر</button>
              </div>
            )}

            {/* Product grid */}
            {hasProducts && (
              <div className="srp-grid">
                {sorted.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    storeName={p.shops?.name}
                    onAddToCart={onAddToCart}
                    onToggleFavorite={onToggleFavorite}
                    isFavorited={isFavorited(p.id)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <nav className="srp-pagination" aria-label="تنقل بين الصفحات">
                <button type="button" className="srp-pg-arrow" disabled={page <= 1}
                  aria-label="الصفحة السابقة" onClick={() => goToPage(page - 1)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                    stroke="currentColor" strokeWidth="2.2">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>

                {pageNums(totalPages, page).map((n, i) =>
                  n === '…'
                    ? <span key={`e${i}`} className="srp-pg-dots">...</span>
                    : <button
                        type="button"
                        key={n}
                        className={`srp-pg-num${n === page ? ' srp-pg-num--on' : ''}`}
                        onClick={() => goToPage(n as number)}
                      >{n}</button>
                )}

                <button type="button" className="srp-pg-arrow" disabled={page >= totalPages}
                  aria-label="الصفحة التالية" onClick={() => goToPage(page + 1)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                    stroke="currentColor" strokeWidth="2.2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </nav>
            )}
          </main>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="srp-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="srp-drawer" onClick={e => e.stopPropagation()}>
            <div className="srp-drawer-hdr">
              <span className="srp-drawer-title">تصفية النتائج</span>
              <button type="button" className="srp-drawer-x" onClick={() => setDrawerOpen(false)} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="srp-drawer-body">
              <FilterPanel {...fpProps} />
            </div>
            <div className="srp-drawer-foot">
              <button type="button" className="srp-drawer-apply" onClick={() => setDrawerOpen(false)}>
                عرض النتائج ({sorted.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
