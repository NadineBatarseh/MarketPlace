import type { MouseEvent } from 'react';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import '../singleStore/storePage.css';
import './categoryListing.css';

import { useCategoryData } from './hooks/useCategoryData';
import { useCategoryProducts } from './hooks/useCategoryProducts';
import { useToast } from '../singleStore/hooks/useToast';
import { useSharedAuth } from '../../context/AuthContext';
import { useShop } from '../../context/ShopContext';
import type { Product } from '../singleStore/types';
import type { GeneralFilters } from '../singleStore/components/Sidebar';
import supabase from '../../lib/supabase';

import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import ProductsSection from '../singleStore/components/ProductsSection';
import Toast from '../singleStore/components/Toast';
import CartConfirmModal from '../../components/CartConfirmModal';
import CategorySidebar from './components/CategorySidebar';

export default function CategoryListingPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const id = categoryId ?? '';

  const { category, stores, filterDefs, availableColors, loading: dataLoading } = useCategoryData(id);

  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);

  useEffect(() => {
    if (stores.length > 0 && selectedShopIds.length === 0) {
      setSelectedShopIds(stores.map(s => s.shop_id));
    }
  }, [stores]);

  const {
    products, total, totalPages, page, loading: productsLoading,
    sort, setPage, handleSortChange,
  } = useCategoryProducts(selectedShopIds);

  const { toast, toastVisible, showToast } = useToast();
  const { rawUser } = useSharedAuth();
  const { addToCart: addToCartCtx, isInCart, toggleFavorite, isFavorited, favoriteItems } = useShop();

  const wishlist = new Set(favoriteItems.map(item => String(item.id)));
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [filterValues, setFilterValues] = useState<Record<string, string[]>>({});
  const [generalFilters, setGeneralFilters] = useState<GeneralFilters>({
    priceMin: '',
    priceMax: '',
    inStockOnly: false,
  });
  const [filteredProducts, setFilteredProducts] = useState<Product[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  // Reset filtered results when stores change
  useEffect(() => {
    setFilteredProducts(null);
  }, [selectedShopIds.join(',')]);

  // Auto-apply filters (debounced 400ms)
  useEffect(() => {
    if (selectedShopIds.length === 0) {
      setFilteredProducts(null);
      return;
    }

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
          const { data: shopProductRows } = await supabase
            .from('products').select('id')
            .in('shop_id', selectedShopIds).eq('isPublish', true);
          const shopProductIds = (shopProductRows ?? []).map((r: { id: string }) => r.id);

          for (const [filterId, values] of activeFilterEntries) {
            const filterDef = filterDefs.find(f => f.id === filterId);
            let data: { product_id: string }[] | null = null;

            if (filterDef?.filter_type === 'color') {
              const { data: variantRows } = await supabase
                .from('product_variants').select('product_id')
                .in('color', values).in('product_id', shopProductIds);
              data = (variantRows ?? []) as { product_id: string }[];
            } else {
              const { data: pfvRows } = await supabase
                .from('product_filter_values').select('product_id')
                .eq('filter_id', filterId).in('value', values);
              data = (pfvRows ?? []) as { product_id: string }[];
            }

            if (controller.signal.aborted) return;

            const ids = new Set((data ?? []).map(r => r.product_id));
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
          .in('shop_id', selectedShopIds)
          .eq('isPublish', true);

        if (matchingIds !== null) query = query.in('id', matchingIds.slice(0, 500));
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

    return () => { clearTimeout(timer); controller.abort(); };
  }, [filterValues, generalFilters, selectedShopIds.join(','), filterDefs]);

  const isFiltered = filteredProducts !== null;
  const displayedProducts = isFiltered ? filteredProducts : products;
  const displayedTotal = isFiltered ? filteredProducts.length : total;
  const displayedLoading = isFiltered ? filterLoading : productsLoading;
  const displayedTotalPages = isFiltered ? 1 : totalPages;
  const displayedPage = isFiltered ? 1 : page;

  function toggleWishlist(e: MouseEvent, pid: string) {
    e.stopPropagation();
    if (!rawUser) { showToast('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
    const product = displayedProducts.find(p => p.id === pid);
    if (!product) return;
    const price = typeof product.price === 'number' ? product.price : parseFloat(String(product.price ?? '0')) || 0;
    toggleFavorite({ id: product.id, name: product.title, image: product.image_urls?.[0] ?? '', price, inStock: true });
    showToast(isFavorited(pid) ? 'تمت الإزالة من المفضلة' : '❤ تمت الإضافة للمفضلة');
  }

  function addToCart(e: MouseEvent, product: Product) {
    e.stopPropagation();
    if (!rawUser) { showToast('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
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

      {/* ── Category Hero ── matches store-hero layout ── */}
      <section className="store-hero cat-hero-section">

        {/* RIGHT: title + subtitle */}
        <div className="sh-identity">
          <div className="sh-name-group">
            <div className="sh-name">
              {dataLoading ? '...' : (category?.label ?? '')}
            </div>
            <div className="sh-desc">اكتشف المنتجات والمتاجر المتوفرة ضمن هذه الفئة</div>
          </div>
        </div>

        {/* CENTER: stats */}
        {!dataLoading && (
          <div className="sh-stats">
            <div className="sh-stat">
              <svg className="sh-stat-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span className="sh-stat-value">{stores.length}</span>
              <span className="sh-stat-label">متجر</span>
            </div>

            <span className="sh-stat-divider" />

            <div className="sh-stat">
              <svg className="sh-stat-icon" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,3 22,8 12,13 2,8" opacity="0.7"/>
                <polygon points="2,8 12,13 12,21 2,16"/>
                <polygon points="22,8 12,13 12,21 22,16" opacity="0.85"/>
              </svg>
              <span className="sh-stat-value">{total}</span>
              <span className="sh-stat-label">منتج</span>
            </div>
          </div>
        )}

        {/* LEFT: placeholder to balance layout */}
        <div className="sh-actions" />

      </section>

      <div className="page-body">
        <CategorySidebar
          stores={stores}
          selectedShopIds={selectedShopIds}
          onShopsChange={ids => {
            setSelectedShopIds(ids);
            setFilteredProducts(null);
          }}
          filterDefs={filterDefs}
          filterValues={filterValues}
          onFilterValuesChange={setFilterValues}
          availableColors={availableColors}
          generalFilters={generalFilters}
          onGeneralFiltersChange={setGeneralFilters}
          loadingFilters={dataLoading}
        />

        <ProductsSection
          products={displayedProducts}
          total={displayedTotal}
          totalPages={displayedTotalPages}
          page={displayedPage}
          loading={displayedLoading || (dataLoading && products.length === 0)}
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
