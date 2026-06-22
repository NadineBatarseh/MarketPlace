import {
  useState, useEffect, useCallback, useMemo, type FormEvent, type ReactNode,
} from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import supabase from '../../lib/supabase';
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
type ViewMode   = 'grid'   | 'list';

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
   HELPERS
═══════════════════════════════════════════════ */
function firstImg(urls: Product['image_urls']): string | null {
  if (!urls) return null;
  return Array.isArray(urls) ? (urls[0] ?? null) : urls;
}

/* ═══════════════════════════════════════════════
   STARS
═══════════════════════════════════════════════ */
function Stars({ value, count }: { value: number | null; count: number }) {
  if (value === null) return null;
  return (
    <span className="srp-stars">
      {[1,2,3,4,5].map(i => (
        <svg key={i} viewBox="0 0 20 20" width="12" height="12"
          fill={i <= Math.round(value) ? '#f59e0b' : 'none'}
          stroke="#f59e0b" strokeWidth="1.3">
          <polygon points="10 1 12.94 7.26 20 8.18 15 13.13 16.18 20 10 16.77 3.82 20 5 13.13 0 8.18 7.06 7.26"/>
        </svg>
      ))}
      <span className="srp-stars-val">{value.toFixed(1)}</span>
      <span className="srp-stars-cnt">({count})</span>
    </span>
  );
}

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
   PRODUCT CARD
═══════════════════════════════════════════════ */
function ProductCard({ product, rating, onView }: {
  product: Product; rating: RatingData | null; onView: (id: string) => void;
}) {
  const [liked, setLiked] = useState(false);
  const img = firstImg(product.image_urls);
  const oos = product.stock_Quantity === 0;

  return (
    <article className="srp-card" onClick={() => onView(product.id)}>
      {/* ── Image ── */}
      <div className="srp-card-img">
        {img
          ? <img src={img} alt={product.title} className="srp-card-photo" loading="lazy" />
          : <div className="srp-card-no-img">
              <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
                <rect x="4" y="8" width="40" height="32" rx="4" fill="#f3f4f6"/>
                <rect x="14" y="14" width="20" height="20" rx="3" fill="#e5e7eb"/>
              </svg>
            </div>
        }

        <button
          type="button"
          className={`srp-heart${liked ? ' srp-heart--on' : ''}`}
          onClick={e => { e.stopPropagation(); setLiked(v => !v); }}
          aria-label="أضف للمفضلة"
        >
          <svg viewBox="0 0 24 24" width="15" height="15"
            fill={liked ? '#ef4444' : 'none'}
            stroke={liked ? '#ef4444' : '#9ca3af'} strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>

        {oos && <span className="srp-oos-badge">نفدت الكمية</span>}
      </div>

      {/* ── Body ── */}
      <div className="srp-card-body">
        <h3 className="srp-card-name">{product.title}</h3>

        <div className="srp-card-store">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
          {product.shops?.name ?? '—'}
        </div>

        <Stars value={rating?.avg ?? null} count={rating?.count ?? 0} />

        <div className="srp-price-line" dir="ltr">
          {product.price != null
            ? <span className="srp-cur-price">₪{product.price.toFixed(0)}</span>
            : <span className="srp-price-na" dir="rtl">السعر عند الطلب</span>}
        </div>

        {oos
          ? <button type="button" className="srp-btn srp-btn--oos" disabled onClick={e => e.stopPropagation()}>
              نفدت الكمية
            </button>
          : <button type="button" className="srp-btn srp-btn--add" onClick={e => e.stopPropagation()}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
              أضف للسلة
            </button>
        }
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════
   SKELETON CARD
═══════════════════════════════════════════════ */
function SkeletonCard() {
  return (
    <div className="srp-card srp-card--skel" aria-hidden>
      <div className="srp-card-img srp-card-img--skel srp-shimmer" />
      <div className="srp-card-body">
        <div className="srp-skel srp-shimmer srp-skel--name" />
        <div className="srp-skel srp-shimmer srp-skel--store" />
        <div className="srp-skel srp-shimmer srp-skel--rating" />
        <div className="srp-skel srp-shimmer srp-skel--price" />
        <div className="srp-skel srp-shimmer srp-skel--btn" />
      </div>
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
  const [viewMode, setViewMode]   = useState<ViewMode>('grid');
  const [drawerOpen, setDrawerOpen] = useState(false);

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
              <div className="srp-view-grp">
                <button
                  type="button"
                  className={`srp-view-btn${viewMode === 'grid' ? ' srp-view-btn--on' : ''}`}
                  onClick={() => setViewMode('grid')} title="شبكة"
                >
                  <svg viewBox="0 0 18 18" width="14" height="14" fill="currentColor">
                    <rect width="7" height="7" rx="1.2"/><rect x="11" width="7" height="7" rx="1.2"/>
                    <rect y="11" width="7" height="7" rx="1.2"/><rect x="11" y="11" width="7" height="7" rx="1.2"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className={`srp-view-btn${viewMode === 'list' ? ' srp-view-btn--on' : ''}`}
                  onClick={() => setViewMode('list')} title="قائمة"
                >
                  <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <line x1="0" y1="4"  x2="18" y2="4"/>
                    <line x1="0" y1="9"  x2="18" y2="9"/>
                    <line x1="0" y1="14" x2="18" y2="14"/>
                  </svg>
                </button>
              </div>

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
              <div className={`srp-grid${viewMode === 'list' ? ' srp-grid--list' : ''}`}>
                {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
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
              <div className={`srp-grid${viewMode === 'list' ? ' srp-grid--list' : ''}`}>
                {sorted.map(p => (
                  <ProductCard key={p.id} product={p} rating={ratingsMap[p.id] ?? null} onView={id => navigate(`/product/${id}`)} />
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
