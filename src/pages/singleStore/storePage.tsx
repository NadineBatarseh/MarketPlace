import { useState, useEffect, useRef, useCallback } from "react";
import { Store, Product, Status, PAGE_SIZE } from "./types";
import { apiFetch } from "./api";
import StoreNav from "./components/StoreNav";
import StoreHeader from "./components/StoreHeader";
import ProductsSection from "./components/ProductsSection";
import "./storePage.css";

export default function StorePage({ shopId }: { shopId: string }) {
  // ── Store state ──
  const [storeStatus, setStoreStatus] = useState<Status>("loading");
  const [store, setStore]             = useState<Store | null>(null);
  const [storeError, setStoreError]   = useState("");

  // ── Products state ──
  const [productsStatus, setProductsStatus] = useState<Status>("loading");
  const [products, setProducts]             = useState<Product[]>([]);
  const [productsError, setProductsError]   = useState("");
  const [total, setTotal]                   = useState(0);
  const [page, setPage]                     = useState(1);
  const [sort, setSort]                     = useState("default");
  const [loadingMore, setLoadingMore]       = useState(false);

  // ── UI interaction state ──
  const [cartCount, setCartCount]   = useState(0);
  const [addedSet, setAddedSet]     = useState<Set<string | number>>(new Set());
  const [favSet, setFavSet]         = useState<Set<string | number>>(new Set());
  const [toast, setToast]           = useState({ show: false, msg: "" });
  const [searchQuery, setSearchQuery] = useState("");

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
      setAddedSet((s) => { const next = new Set(s); next.delete(id); return next; });
    }, 2500);
  }

  // ── Fav ──
  function toggleFav(id: string | number) {
    setFavSet((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Fetch products ──
  const loadProducts = useCallback(
    async (pg: number, sortKey: string, append: boolean) => {
      try {
        const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE), sort: sortKey });
        const data = await apiFetch<{ ok: true; products: Product[]; total: number; page: number; limit: number }>(
          `/api/stores/${shopId}/products?${params}`
        );
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

  return (
    <div dir="rtl" style={{ fontFamily: "'Cairo', sans-serif", background: "var(--bg)", minHeight: "100vh", color: "var(--text-main)" }}>

      <StoreNav cartCount={cartCount} searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* Banner */}
      <div className="sp-banner">
        <div className="sp-banner-accent" />
      </div>

      <StoreHeader
        status={storeStatus}
        store={store}
        error={storeError}
      />

      <ProductsSection
        status={productsStatus}
        products={products}
        searchQuery={searchQuery}
        error={productsError}
        total={total}
        sort={sort}
        loadingMore={loadingMore}
        addedSet={addedSet}
        favSet={favSet}
        onSortChange={onSortChange}
        onLoadMore={loadMoreProducts}
        onAddToCart={addToCart}
        onToggleFav={toggleFav}
        onRetry={() => loadProducts(1, sort, false)}
      />

      {/* Toast */}
      <div className={`sp-toast${toast.show ? " show" : ""}`}>
        <div className="sp-toast-dot" />
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
