import { useState, useEffect } from 'react';
import type { Product } from '../types';
import { fetchProducts } from '../api';

interface UseProductsResult {
  products: Product[];
  total: number;
  loading: boolean;
  sort: string;
  handleSortChange: (newSort: string) => void;
  handleLoadMore: () => void;
}

export function useProducts(shopId: string): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('default');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProducts(shopId, page, sort)
      .then(({ products: fetched, total: t }) => {
        if (!cancelled) {
          setProducts(prev => page === 1 ? fetched : [...prev, ...fetched]);
          setTotal(t);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shopId, page, sort]);

  function handleSortChange(newSort: string) {
    setSort(newSort);
    setPage(1);
    setProducts([]);
  }

  function handleLoadMore() {
    setPage(p => p + 1);
  }

  return { products, total, loading, sort, handleSortChange, handleLoadMore };
}
