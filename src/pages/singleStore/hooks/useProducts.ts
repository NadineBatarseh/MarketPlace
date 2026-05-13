import { useState, useEffect } from 'react';
import type { Product } from '../types';
import { fetchProducts } from '../api';
import { supabase } from '../../../lib/supabase';

const PAGE_SIZE = 12;

interface UseProductsResult {
  products: Product[];
  total: number;
  totalPages: number;
  page: number;
  loading: boolean;
  sort: string;
  setPage: (page: number) => void;
  handleSortChange: (newSort: string) => void;
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

    function load() {
      fetchProducts(shopId, page, sort)
        .then(({ products: fetched, total: t }) => {
          if (!cancelled) { setProducts(fetched); setTotal(t); }
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    load();

    const channel = supabase
      .channel(`products-${shopId}-${page}-${sort}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `shop_id=eq.${shopId}` }, () => {
        load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [shopId, page, sort]);

  function handleSortChange(newSort: string) {
    setSort(newSort);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return { products, total, totalPages, page, loading, sort, setPage, handleSortChange };
}
