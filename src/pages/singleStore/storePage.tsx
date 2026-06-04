import type { MouseEvent } from 'react';
import { useState, useEffect, useRef } from 'react';
import './storePage.css';

import { useStore } from './hooks/useStore';
import { useProducts } from './hooks/useProducts';
import { useToast } from './hooks/useToast';
import { useSidebarData } from './hooks/useSidebarData';
import { useSharedAuth } from '../../context/AuthContext';
import { useShop } from '../../context/ShopContext';
import type { Product } from './types';
import supabase from '../../lib/supabase';

import StoreNav from '../../components/StoreNav';
import StoreHero from './components/StoreHero';
import Sidebar from './components/Sidebar';
import type { GeneralFilters } from './components/Sidebar';
import ProductsSection from './components/ProductsSection';
import Toast from './components/Toast';
import Topbar from '../../components/Topbar';
import CartConfirmModal from '../../components/CartConfirmModal';

interface Props {
  shopId: string;
}

export default function StorePage({ shopId }: Props) {
  const { store, loading: storeLoading, error: storeError } = useStore(shopId);
  const { products, total, totalPages, page, loading: productsLoading, sort, setPage, handleSortChange } = useProducts(shopId);
  const { toast, toastVisible, showToast } = useToast();
  const { rawUser, role } = useSharedAuth();
  const { addToCart: addToCartCtx, isInCart, toggleFavorite, isFavorited, favoriteItems } = useShop();

  const wishlist = new Set(favoriteItems.map(item => String(item.id)));
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // ── Sidebar filter state ──────────────────────────────────────
  const [filterValues, setFilterValues] = useState<Record<string, string[]>>({});
  const [generalFilters, setGeneralFilters] = useState<GeneralFilters>({
    priceMin: '',
    priceMax: '',
    inStockOnly: false,
  });
  const [filteredProducts, setFilteredProducts] = useState<Product[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  const { shopCategoryId, filterDefs, availableColors, loadingFilters } =
    useSidebarData(shopId);

  // ── Auto-apply filters on any change (debounced 400ms) ──────────
  useEffect(() => {
    const activeFilterEntries = Object.entries(filterValues).filter(([, v]) => v.length > 0);
    const hasGeneral = !!generalFilters.priceMin || !!generalFilters.priceMax || generalFilters.inStockOnly;
    const hasDynamic = activeFilterEntries.length > 0;

    if (!hasDynamic && !hasGeneral) {
      setFilteredProducts(null);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setFilterLoading(true);
      try {
        let matchingIds: string[] | null = null;

        if (hasDynamic) {
          // Fetch all published product IDs for this shop once (needed for color variant lookup)
          const { data: shopProductRows } = await supabase
            .from('products').select('id').eq('shop_id', shopId).eq('isPublish', true).not('is_deleted', 'eq', true).not('is_archived', 'eq', true);
          const shopProductIds = (shopProductRows ?? []).map(r => r.id as string);

          for (const [filterId, values] of activeFilterEntries) {
            const filterDef = filterDefs.find(f => f.id === filterId);
            let data: { product_id: string }[] | null = null;

            if (filterDef?.filter_type === 'color') {
              // Colors live in product_variants, not product_filter_values
              const { data: variantRows } = await supabase
                .from('product_variants')
                .select('product_id')
                .in('color', values)
                .in('product_id', shopProductIds);
              data = (variantRows ?? []) as { product_id: string }[];
            } else {
              const { data: pfvRows } = await supabase
                .from('product_filter_values')
                .select('product_id')
                .eq('filter_id', filterId)
                .in('value', values);
              data = (pfvRows ?? []) as { product_id: string }[];
            }

            if (controller.signal.aborted) return;

            const ids = new Set((data ?? []).map(r => r.product_id as string));
            matchingIds = matchingIds === null
              ? [...ids]
              : matchingIds.filter(id => ids.has(id));

            if (matchingIds.length === 0) break;
          }

          if (matchingIds !== null && matchingIds.length === 0) {
            setFilteredProducts([]);
            setFilterLoading(false);
            return;
          }
        }

        let query = supabase
          .from('products')
          .select('id, title, description, price, image_urls, stock_Quantity')
          .eq('shop_id', shopId)
          .eq('isPublish', true)
          .not('is_deleted', 'eq', true)
          .not('is_archived', 'eq', true);

        if (matchingIds !== null) query = query.in('id', matchingIds.slice(0, 500));
        if (shopCategoryId) query = query.eq('category_id', shopCategoryId);
        if (generalFilters.priceMin) query = query.gte('price', parseFloat(generalFilters.priceMin));
        if (generalFilters.priceMax) query = query.lte('price', parseFloat(generalFilters.priceMax));
        if (generalFilters.inStockOnly) query = query.gt('stock_Quantity', 0);

        if (controller.signal.aborted) return;
        const { data } = await query.limit(200);
        setFilteredProducts((data ?? []) as Product[]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } finally {
        if (!controller.signal.aborted) setFilterLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filterValues, generalFilters, shopId, shopCategoryId]);

  // ── In-store search ───────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearchTotal(0); return; }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&shop_id=${shopId}&limit=50`);
        const data = await res.json();
        if (data.ok) { setSearchResults(data.products); setSearchTotal(data.total); }
      } catch { /* silent */ } finally {
        setSearchLoading(false);
      }
    }, 350);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, shopId]);

  // ── Derived display state ─────────────────────────────────────
  const isSearching = searchQuery.trim().length > 0;
  const isFiltered  = filteredProducts !== null;

  const displayedProducts = isSearching ? searchResults
    : isFiltered            ? filteredProducts
    : products;

  const displayedTotal   = isSearching ? searchTotal
    : isFiltered          ? filteredProducts.length
    : total;

  const displayedLoading = isSearching ? searchLoading
    : isFiltered          ? filterLoading
    : productsLoading;

  const displayedTotalPages = (isSearching || isFiltered) ? 1 : totalPages;
  const displayedPage       = (isSearching || isFiltered) ? 1 : page;

  // ── Cart & wishlist ───────────────────────────────────────────
  function toggleWishlist(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (!rawUser) { showToast('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
    if (role !== 'customer') { showToast('متاح للعملاء فقط'); return; }
    const product = displayedProducts.find(p => p.id === id);
    if (!product) return;
    const price = typeof product.price === 'number' ? product.price : parseFloat(String(product.price ?? '0')) || 0;
    toggleFavorite({ id: product.id, name: product.title, image: product.image_urls?.[0] ?? '', price, inStock: true });
    showToast(isFavorited(id) ? 'تمت الإزالة من المفضلة' : '❤ تمت الإضافة للمفضلة');
  }

  function addToCart(e: MouseEvent, product: Product) {
    e.stopPropagation();
    if (!rawUser) { showToast('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
    if (role !== 'customer') { showToast('متاح للعملاء فقط'); return; }
    if (isInCart(product.id)) { setConfirmProduct(product); return; }
    addToCartCtx({
      id: product.id,
      name: product.title,
      image: product.image_urls?.[0] ?? '',
      price: typeof product.price === 'number' ? product.price : parseFloat(String(product.price ?? '0')) || 0,
    });
    showToast('✓ تمت الإضافة إلى السلة');
  }

  return (
    <>
      <Topbar />
      <StoreNav />
      <StoreHero store={store} loading={storeLoading} error={storeError} productCount={total} />

      <div className="page-body">
        <Sidebar
          filterDefs={filterDefs}
          filterValues={filterValues}
          onFilterValuesChange={setFilterValues}
          availableColors={availableColors}
          generalFilters={generalFilters}
          onGeneralFiltersChange={setGeneralFilters}
          loadingFilters={loadingFilters}
        />

        <ProductsSection
          products={displayedProducts}
          total={displayedTotal}
          totalPages={displayedTotalPages}
          page={displayedPage}
          loading={displayedLoading}
          sort={sort}
          viewMode={viewMode}
          wishlist={wishlist}
          onSortChange={s => { handleSortChange(s); setFilteredProducts(null); }}
          onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onViewModeChange={setViewMode}
          onToggleWishlist={toggleWishlist}
          onAddToCart={addToCart}
        />
      </div>

      <Toast message={toast} visible={toastVisible} />

      {confirmProduct && (
        <CartConfirmModal
          onConfirm={() => {
            addToCartCtx({
              id: confirmProduct.id,
              name: confirmProduct.title,
              image: confirmProduct.image_urls?.[0] ?? '',
              price: typeof confirmProduct.price === 'number' ? confirmProduct.price : parseFloat(String(confirmProduct.price ?? '0')) || 0,
            });
            showToast('✓ تمت إضافة قطعة أخرى إلى السلة');
            setConfirmProduct(null);
          }}
          onCancel={() => setConfirmProduct(null)}
        />
      )}
    </>
  );
}
