import { useState, useEffect, useRef, useCallback } from "react";
import "./storePage.css";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Store {
  shop_id: string;
  name: string;
  description?: string;
  shopLogo?: string | null;
  created_at?: string;
  // Optional enrichment fields (add columns to DB later to enable these)
  rating?: number;
  review_count?: number;
  followers_count?: number;
  product_count?: number;
  is_verified?: boolean;
  member_since?: number | string;
}

interface Product {
  id: string | number;
  title?: string;
  name?: string;
  price?: string | number | null;
  old_price?: string | number | null;
  image_url?: string | null;
  rating?: number;
  review_count?: number;
  badge?: string;
  is_new?: boolean;
}

type Status = "loading" | "success" | "error";

const PAGE_SIZE = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsePrice(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const num = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return isNaN(num) ? "" : num.toLocaleString("ar-SA", { maximumFractionDigits: 2 });
}

function formatNumber(n: number | null | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "م";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("ar-SA");
}

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error;
    throw new Error(msg || (res.status === 404 ? "غير موجود (404)" : `خطأ ${res.status}`));
  }
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(json.error || "استجابة غير صالحة من الخادم");
  return json;
}

// ─── StarRating ───────────────────────────────────────────────────────────────
function StarRating({ rating, variant = "card" }: { rating: number; variant?: "store" | "card" }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i + 1 <= Math.round(rating);
        return variant === "store" ? (
          <span key={i} className={`sp-star ${filled ? "filled" : "empty"}`}>★</span>
        ) : (
          <span key={i} className="sp-card-star">{filled ? "★" : "☆"}</span>
        );
      })}
    </>
  );
}

// ─── SkeletonHeader ───────────────────────────────────────────────────────────
function SkeletonHeader() {
  return (
    <div className="sp-store-header">
      <div className="sp-skeleton" style={{ width: 110, height: 110, borderRadius: 14, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="sp-skeleton" style={{ height: 28, width: "55%", marginBottom: ".6rem" }} />
        <div className="sp-skeleton" style={{ height: 16, width: "25%", marginBottom: ".6rem" }} />
        <div className="sp-skeleton" style={{ height: 13, width: "95%", marginBottom: ".3rem" }} />
        <div className="sp-skeleton" style={{ height: 13, width: "70%", marginBottom: "1rem" }} />
        <div style={{ display: "flex", gap: ".75rem" }}>
          <div className="sp-skeleton" style={{ height: 38, width: 110, borderRadius: 50 }} />
          <div className="sp-skeleton" style={{ height: 38, width: 100, borderRadius: 50 }} />
        </div>
      </div>
    </div>
  );
}

// ─── SkeletonCards ────────────────────────────────────────────────────────────
function SkeletonCards({ count = PAGE_SIZE }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sp-card-skeleton">
          <div className="sp-card-skeleton-img sp-skeleton" />
          <div className="sp-card-skeleton-body">
            <div className="sp-skeleton" style={{ height: 13, marginBottom: ".4rem" }} />
            <div className="sp-skeleton" style={{ height: 13, width: "65%", marginBottom: ".75rem" }} />
            <div className="sp-skeleton" style={{ height: 20, width: "40%", marginBottom: ".75rem" }} />
            <div className="sp-skeleton" style={{ height: 36, borderRadius: 9 }} />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── ProductCard ──────────────────────────────────────────────────────────────
function ProductCard({
  product,
  index,
  isAdded,
  isFaved,
  onAddToCart,
  onToggleFav,
}: {
  product: Product;
  index: number;
  isAdded: boolean;
  isFaved: boolean;
  onAddToCart: (id: string | number, name: string) => void;
  onToggleFav: (id: string | number) => void;
}) {
  const name     = product.title || product.name || "منتج";
  const price    = parsePrice(product.price);
 // const oldPrice = parsePrice(product.old_price);
  const delay    = `${(index * 0.07).toFixed(2)}s`;

  return (
    <div className="sp-card" style={{ animation: `sp-fadeUp .35s ease ${delay} both` }}>
      {product.badge && (
        <div className={`sp-card-badge${product.is_new ? " new" : ""}`}>{product.badge}</div>
      )}
      {product.is_new && !product.badge && (
        <div className="sp-card-badge new">جديد</div>
      )}

      <div
        className="sp-card-fav"
        onClick={() => onToggleFav(product.id)}
        title="أضف للمفضلة"
        style={{ background: isFaved ? "#fee2e2" : undefined }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13" height="13"
          fill={isFaved ? "#ef4444" : "none"}
          viewBox="0 0 24 24"
          stroke={isFaved ? "#ef4444" : "currentColor"}
          strokeWidth="2"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </div>

      <div className="sp-card-img">
        {product.image_url ? (
          <>
            <img
              src={product.image_url}
              alt={name}
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = "none";
                const fallback = img.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <span style={{ display: "none", fontSize: "3.5rem", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
              📦
            </span>
          </>
        ) : (
          <span style={{ fontSize: "3.5rem" }}>📦</span>
        )}
      </div>

      <div className="sp-card-body">
        <p className="sp-card-name">{name}</p>
        <div className="sp-card-rating">
          <StarRating rating={product.rating || 0} variant="card" />
          <span className="sp-card-rating-num">
            {(product.rating || 0).toFixed(1)} ({product.review_count || 0})
          </span>
        </div>
        <div className="sp-card-price-row">
          <span className="sp-card-price">{price || "—"}</span>
          <span className="sp-card-currency">ر.س</span>
          {product.old_price && <span className="sp-card-price-old">{parsePrice(product.old_price)}</span>}
        </div>
        <button
          className={`sp-btn-cart${isAdded ? " added" : ""}`}
          onClick={() => onAddToCart(product.id, name)}
        >
          {isAdded ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              تمت الإضافة
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
              إضافة للسلة
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── StorePage ────────────────────────────────────────────────────────────────
export default function StorePage({ shopId }: { shopId: string }) {
  // Store
  const [storeStatus, setStoreStatus] = useState<Status>("loading");
  const [store, setStore]             = useState<Store | null>(null);
  const [storeError, setStoreError]   = useState("");

  // Products
  const [productsStatus, setProductsStatus] = useState<Status>("loading");
  const [products, setProducts]             = useState<Product[]>([]);
  const [productsError, setProductsError]   = useState("");
  const [total, setTotal]                   = useState(0);
  const [page, setPage]                     = useState(1);
  const [sort, setSort]                     = useState("default");
  const [loadingMore, setLoadingMore]       = useState(false);

  // UI interactions
  const [following, setFollowing]   = useState(false);
  const [cartCount, setCartCount]   = useState(0);
  const [addedSet, setAddedSet]     = useState<Set<string | number>>(new Set());
  const [favSet, setFavSet]         = useState<Set<string | number>>(new Set());
  const [toast, setToast]           = useState({ show: false, msg: "" });
  const [activeTab, setActiveTab]   = useState(0);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Toast ──
  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, msg });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2800);
  }

  // ── Cart ──
  function addToCart(id: string | number, name: string) {
    setCartCount((c) => c + 1);
    setAddedSet((s) => new Set([...s, id]));
    showToast(`✅ أُضيف "${name}" للسلة`);
    setTimeout(() => {
      setAddedSet((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 2500);
  }

  // ── Fav ──
  function toggleFav(id: string | number) {
    setFavSet((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Follow ──
  function toggleFollow() {
    const nowFollowing = !following;
    setFollowing(nowFollowing);
    if (nowFollowing) showToast("✔ أصبحت تتابع هذا المتجر");
  }

  // ── Fetch products ──
  const loadProducts = useCallback(
    async (pg: number, sortKey: string, append: boolean) => {
      try {
        const params = new URLSearchParams({
          page:  String(pg),
          limit: String(PAGE_SIZE),
          sort:  sortKey,
        });
        const data = await apiFetch<{
          ok: true;
          products: Product[];
          total: number;
          page: number;
          limit: number;
        }>(`/api/stores/${shopId}/products?${params}`);

        setProducts((prev) => (append ? [...prev, ...data.products] : data.products));
        setTotal(data.total);
        setProductsStatus("success");
      } catch (err) {
        setProductsError((err as Error).message);
        setProductsStatus("error");
      }
    },
    [shopId]
  );

  // ── Load more ──
  async function loadMoreProducts() {
    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    await loadProducts(nextPage, sort, true);
    setLoadingMore(false);
  }

  // ── Sort change ──
  async function onSortChange(newSort: string) {
    setSort(newSort);
    setPage(1);
    setProducts([]);
    setProductsStatus("loading");
    await loadProducts(1, newSort, false);
  }

  // ── Initial load ──
  useEffect(() => {
    async function init() {
      setStoreStatus("loading");
      setProductsStatus("loading");
      try {
        const [storeRes, productsRes] = await Promise.all([
          apiFetch<{ ok: true; store: Store }>(`/api/stores/${shopId}`),
          apiFetch<{ ok: true; products: Product[]; total: number; page: number; limit: number }>(
            `/api/stores/${shopId}/products?page=1&limit=${PAGE_SIZE}&sort=default`
          ),
        ]);
        setStore(storeRes.store);
        setStoreStatus("success");
        setProducts(productsRes.products);
        setTotal(productsRes.total);
        setProductsStatus("success");
      } catch (err) {
        const msg = (err as Error).message;
        setStoreError(msg);
        setStoreStatus("error");
        setProductsError(msg);
        setProductsStatus("error");
      }
    }
    init();
  }, [shopId]);

  const TABS = ["المنتجات", "التقييمات", "عن المتجر", "العروض"];

  return (
    <div style={{ fontFamily: "'Cairo', sans-serif", background: "var(--bg)", minHeight: "100vh", color: "var(--text-main)" }}>

      {/* ── NAV ── */}
      <nav className="sp-nav">
        <div className="sp-nav-logo">سوق <span>لينك</span></div>
        <div className="sp-nav-search">
          <svg className="sp-search-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input type="text" placeholder="ابحث في المتجر..." />
        </div>
        <div className="sp-nav-actions">
          <div className="sp-nav-icon-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
          <div className="sp-nav-icon-btn">
            <div className="sp-badge">{cartCount}</div>
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
        </div>
      </nav>

      {/* ── BANNER ── */}
      <div className="sp-banner">
        <div className="sp-banner-accent" />
      </div>

      {/* ── STORE HEADER ── */}
      <div className="sp-store-header-wrap">
        {storeStatus === "loading" && <SkeletonHeader />}

        {storeStatus === "error" && (
          <div className="sp-error-wrap" style={{ marginTop: "-60px", position: "relative", zIndex: 10 }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🏪</div>
            <h2>تعذّر تحميل المتجر</h2>
            <p>{storeError}</p>
            <button className="sp-btn-retry" onClick={() => window.location.reload()}>
              إعادة المحاولة
            </button>
          </div>
        )}

        {storeStatus === "success" && store && (
          <div className="sp-store-header">
            {/* Logo */}
            <div className="sp-store-logo-wrap">
              {store.shopLogo ? (
                <img src={store.shopLogo} alt={store.name} />
              ) : (
                <div className="sp-store-logo-placeholder">{store.name.charAt(0)}</div>
              )}
            </div>

            {/* Info */}
            <div className="sp-store-info">
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".4rem", marginBottom: ".3rem" }}>
                <h1 className="sp-store-name">{store.name}</h1>
                {store.is_verified && (
                  <span className="sp-store-verified">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                    موثّق
                  </span>
                )}
              </div>

              <div className="sp-stars">
                <StarRating rating={store.rating || 0} variant="store" />
                <span className="sp-rating-count">
                  ({(store.rating || 0).toFixed(1)}) · {formatNumber(store.review_count)} تقييم
                </span>
              </div>

              {store.description && <p className="sp-store-desc">{store.description}</p>}

              <div className="sp-store-meta">
                <span className="sp-meta-item">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  {formatNumber(store.product_count)} منتج
                </span>
                <span className="sp-meta-item">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {formatNumber(store.followers_count)} متابع
                </span>
                {store.member_since && (
                  <span className="sp-meta-item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    عضو منذ {store.member_since}
                  </span>
                )}
              </div>

              <div className="sp-store-actions">
                <button
                  className={`sp-btn-follow${following ? " following" : ""}`}
                  onClick={toggleFollow}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    {following
                      ? <path d="M20 6 9 17l-5-5" />
                      : <path d="M12 5v14M5 12h14" />}
                  </svg>
                  {following ? "متابَق" : "متابعة"}
                </button>
                <button className="sp-btn-msg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  مراسلة
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── TABS ── */}
      <div className="sp-tabs-wrap">
        <div className="sp-tabs">
          {TABS.map((tab, i) => (
            <div
              key={i}
              className={`sp-tab${activeTab === i ? " active" : ""}`}
              onClick={() => setActiveTab(i)}
            >
              {tab}
            </div>
          ))}
        </div>
      </div>

      {/* ── PRODUCTS ── */}
      <div className="sp-products-wrap">
        <div className="sp-products-toolbar">
          <div>
            <span className="sp-products-title">جميع المنتجات</span>
            {productsStatus === "success" && (
              <span className="sp-products-count">({formatNumber(total)} منتج)</span>
            )}
          </div>
          <div className="sp-toolbar-right">
            <select
              className="sp-select-sort"
              value={sort}
              onChange={(e) => onSortChange(e.target.value)}
            >
              <option value="default">الأكثر مبيعاً</option>
              <option value="price_asc">السعر: الأقل أولاً</option>
              <option value="price_desc">السعر: الأعلى أولاً</option>
              <option value="newest">الأحدث</option>
              <option value="rating">الأعلى تقييماً</option>
            </select>
          </div>
        </div>

        <div className="sp-products-grid">
          {productsStatus === "loading" && <SkeletonCards />}

          {productsStatus === "error" && (
            <div style={{ gridColumn: "1/-1" }} className="sp-error-wrap">
              <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⚠️</div>
              <h3>تعذّر تحميل المنتجات</h3>
              <p>{productsError}</p>
              <button className="sp-btn-retry" onClick={() => loadProducts(1, sort, false)}>
                إعادة المحاولة
              </button>
            </div>
          )}

          {productsStatus === "success" && products.length === 0 && (
            <div style={{ gridColumn: "1/-1" }} className="sp-error-wrap">
              <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📦</div>
              <h3>لا توجد منتجات</h3>
              <p>لم يتم إضافة منتجات لهذا المتجر بعد.</p>
            </div>
          )}

          {productsStatus === "success" &&
            products.map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                index={i}
                isAdded={addedSet.has(p.id)}
                isFaved={favSet.has(p.id)}
                onAddToCart={addToCart}
                onToggleFav={toggleFav}
              />
            ))}
        </div>

        {productsStatus === "success" && products.length < total && (
          <div className="sp-load-more-wrap">
            <button
              className="sp-btn-load"
              disabled={loadingMore}
              onClick={loadMoreProducts}
            >
              {loadingMore ? "جاري التحميل..." : "تحميل المزيد"}
            </button>
          </div>
        )}
      </div>

      {/* ── TOAST ── */}
      <div className={`sp-toast${toast.show ? " show" : ""}`}>
        <div className="sp-toast-dot" />
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
