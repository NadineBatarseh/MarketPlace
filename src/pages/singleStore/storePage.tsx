import type { MouseEvent } from 'react';
import { useState } from 'react';
import './storePage.css';

import { useStore } from './hooks/useStore';
import { useProducts } from './hooks/useProducts';
import { useToast } from './hooks/useToast';

import Topbar from '../../components/Topbar';
import StoreNav from './components/StoreNav';
import StoreHero from './components/StoreHero';
import Sidebar from './components/Sidebar';
import type { FilterKey, FilterState } from './components/Sidebar';
import ProductsSection from './components/ProductsSection';
import Footer from './components/Footer';
import Toast from './components/Toast';

interface Props {
  shopId: string;
}

export default function StorePage({ shopId }: Props) {
  const { store, loading: storeLoading, error: storeError } = useStore(shopId);
  const { products, total, loading: productsLoading, sort, handleSortChange, handleLoadMore } = useProducts(shopId);
  const { toast, toastVisible, showToast } = useToast();

  const [cartCount, setCartCount] = useState(0);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [activeColor, setActiveColor] = useState('#2a7a3b');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [openFilters, setOpenFilters] = useState<FilterState>({
    categories: true,
    price: true,
    brands: false,
    colors: true,
  });

  function toggleWishlist(e: MouseEvent, id: string) {
    e.stopPropagation();
    setWishlist(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        showToast('تمت الإزالة من المفضلة');
      } else {
        next.add(id);
        showToast('❤ تمت الإضافة للمفضلة');
      }
      return next;
    });
  }

  function addToCart(e: MouseEvent) {
    e.stopPropagation();
    setCartCount(c => c + 1);
    showToast('✓ تمت الإضافة إلى السلة');
  }

  function toggleFilter(key: FilterKey) {
    setOpenFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <>
      <Topbar cartCount={cartCount} />
      <StoreNav />
      <StoreHero
        store={store}
        loading={storeLoading}
        error={storeError}
      />
      <div className="page-body">
        <Sidebar
          openFilters={openFilters}
          activeColor={activeColor}
          onToggleFilter={toggleFilter}
          onColorChange={setActiveColor}
        />
        <ProductsSection
          products={products}
          total={total}
          loading={productsLoading}
          sort={sort}
          viewMode={viewMode}
          wishlist={wishlist}
          onSortChange={handleSortChange}
          onLoadMore={handleLoadMore}
          onViewModeChange={setViewMode}
          onToggleWishlist={toggleWishlist}
          onAddToCart={addToCart}
        />
      </div>
      <Footer store={store} />
      <Toast message={toast} visible={toastVisible} />
    </>
  );
}