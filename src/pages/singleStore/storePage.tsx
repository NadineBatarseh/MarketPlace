import type { MouseEvent } from 'react';
import { useState, useEffect, useRef } from 'react';
import './storePage.css';

import { useStore } from './hooks/useStore';
import { useProducts } from './hooks/useProducts';
import { useToast } from './hooks/useToast';
import type { Product } from './types';

import AppNav from '../../components/AppNav';
import StoreNav from '../../components/StoreNav';
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

  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [activeColor, setActiveColor] = useState('#2a7a3b');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [openFilters, setOpenFilters] = useState<FilterState>({
    categories: true,
    price: true,
    brands: false,
    colors: true,
  });

  // ── In-store search ──────────────────────────────────────────
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
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&shop_id=${shopId}&limit=50`
        );
        const data = await res.json();
        if (data.ok) { setSearchResults(data.products); setSearchTotal(data.total); }
      } catch { /* silent */ } finally {
        setSearchLoading(false);
      }
    }, 350);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, shopId]);

  const isSearching = searchQuery.trim().length > 0;
  const displayedProducts = isSearching ? searchResults : products;
  const displayedTotal    = isSearching ? searchTotal   : total;
  const displayedLoading  = isSearching ? searchLoading : productsLoading;

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
    showToast('✓ تمت الإضافة إلى السلة');
  }

  function toggleFilter(key: FilterKey) {
    setOpenFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <>
      <AppNav
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={setSearchQuery}
      />
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
          products={displayedProducts}
          total={displayedTotal}
          loading={displayedLoading}
          sort={sort}
          viewMode={viewMode}
          wishlist={wishlist}
          onSortChange={handleSortChange}
          onLoadMore={isSearching ? () => {} : handleLoadMore}
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