import { useState, useEffect } from 'react';
import supabase from '../../../lib/supabase';
import type { Product } from '../../singleStore/types';

const PAGE_SIZE = 12;

interface Result {
  products: Product[];
  total: number;
  totalPages: number;
  page: number;
  loading: boolean;
  sort: string;
  setPage: (p: number) => void;
  handleSortChange: (s: string) => void;
}

export function useCategoryProducts(shopIds: string[]): Result {
  const shopKey = shopIds.join(',');

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('default');
  const [loading, setLoading] = useState(false);
  const [lastShopKey, setLastShopKey] = useState(shopKey);

  // Reset to page 1 when stores change
  if (shopKey !== lastShopKey) {
    setLastShopKey(shopKey);
    setPage(1);
  }

  useEffect(() => {
    if (shopIds.length === 0) {
      setProducts([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('products')
        .select('id, title, description, price, image_urls, stock_Quantity', { count: 'exact' })
        .in('shop_id', shopIds)
        .eq('isPublish', true);

      if (sort === 'price_asc') query = query.order('price', { ascending: true });
      else if (sort === 'price_desc') query = query.order('price', { ascending: false });
      else query = query.order('created_at', { ascending: false });

      const { data, count } = await query.range(from, to);

      if (!cancelled) {
        setProducts((data ?? []) as Product[]);
        setTotal(count ?? 0);
        setLoading(false);
      }
    }

    load().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shopKey, page, sort]);

  function handleSortChange(newSort: string) {
    setSort(newSort);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { products, total, totalPages, page, loading, sort, setPage, handleSortChange };
}
