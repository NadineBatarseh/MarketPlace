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
  const { rawUser, role } = useSharedAuth();
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
            .in('shop_id', selectedShopIds).eq('isPublish', true)
            .not('is_deleted', 'eq', true).not('is_archived', 'eq', true);
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
          .eq('isPublish', true)
          .not('is_deleted', 'eq', true)
          .not('is_archived', 'eq', true);

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
    if (role !== 'customer') { showToast('متاح للعملاء فقط'); return; }
    const product = displayedProducts.find(p => p.id === pid);
    if (!product) return;
    const price = typeof product.price === 'number' ? product.price : parseFloat(String(product.price ?? '0')) || 0;
    toggleFavorite({ id: product.id, name: product.title, image: product.image_urls?.[0] ?? '', price, inStock: true });
    showToast(isFavorited(pid) ? 'تمت الإزالة من المفضلة' : '❤ تمت الإضافة للمفضلة');
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

      <div className="cat-page" dir="rtl">

      {/* ── Category Hero ── per-category banner from Supabase ── */}
      <section className="cat-hero">
        <div className="cat-hero-bg" aria-hidden="true">
          {(category?.hero_image_url || category?.image_url) && (
            <img
              className="cat-hero-img"
              src={category.hero_image_url || category.image_url}
              alt=""
            />
          )}
          <div className="cat-hero-fade" />
        </div>
        <div className="cat-hero-content">
          <h1 className="cat-hero-title">
            {dataLoading ? '...' : (category?.label ?? '')}
          </h1>
          <p className="cat-hero-desc">
            {category?.description?.trim() ||
              'اكتشف المنتجات والمتاجر المتوفرة ضمن هذه الفئة'}
          </p>
        </div>
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
