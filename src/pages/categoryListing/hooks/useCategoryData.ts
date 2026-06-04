import { useState, useEffect } from 'react';
import supabase from '../../../lib/supabase';
import type { FilterDef } from '../../singleStore/hooks/useSidebarData';

export interface CategoryStore {
  shop_id: string;
  name: string;
  shopLogo: string | null;
  productCount: number;
}

export interface CategoryInfo {
  id: string;
  label: string;
  image_url: string;
}

interface Result {
  category: CategoryInfo | null;
  stores: CategoryStore[];
  filterDefs: FilterDef[];
  availableColors: string[];
  loading: boolean;
}

export function useCategoryData(categoryId: string): Result {
  const [category, setCategory] = useState<CategoryInfo | null>(null);
  const [stores, setStores] = useState<CategoryStore[]>([]);
  const [filterDefs, setFilterDefs] = useState<FilterDef[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      // 1. Category info
      const { data: catData } = await supabase
        .from('categories')
        .select('id, label, image_url')
        .eq('id', categoryId)
        .single();

      if (cancelled || !catData) return;
      setCategory(catData as CategoryInfo);

      // 2. Stores in this category — exclude archived and suspended shops from public view.
      // (status is filtered with neq so legacy quote-wrapped values can't hide live shops.)
      const { data: shopData } = await supabase
        .from('shops')
        .select('shop_id, name, shopLogo')
        .eq('Type_of_store', catData.label)
        .neq('status', 'suspended')
        .not('is_archived', 'eq', true);

      if (cancelled) return;
      const shopList = (shopData ?? []) as { shop_id: string; name: string; shopLogo: string | null }[];
      const shopIds = shopList.map(s => s.shop_id);

      // 3. Product IDs (for counts + color variants)
      const { data: productRows } = shopIds.length > 0
        ? await supabase.from('products').select('id, shop_id').in('shop_id', shopIds).eq('isPublish', true).not('is_deleted', 'eq', true).not('is_archived', 'eq', true)
        : { data: [] };

      if (cancelled) return;

      const counts: Record<string, number> = {};
      const productIds: string[] = [];
      (productRows ?? []).forEach((r: { id: string; shop_id: string }) => {
        counts[r.shop_id] = (counts[r.shop_id] ?? 0) + 1;
        productIds.push(r.id);
      });

      setStores(shopList.map(s => ({ ...s, productCount: counts[s.shop_id] ?? 0 })));

      // 4. Filter definitions
      const { data: filterData } = await supabase
        .from('category_filter_definitions')
        .select('*')
        .eq('category_id', categoryId)
        .order('display_order', { ascending: true });

      if (cancelled) return;
      const defs = (filterData ?? []) as FilterDef[];
      setFilterDefs(defs);

      // 5. Available colors (only if category has a color filter)
      const hasColorFilter = defs.some(d => d.filter_type === 'color');
      if (!hasColorFilter || productIds.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: colorRows } = await supabase
        .from('product_variants')
        .select('color')
        .in('product_id', productIds);

      if (!cancelled) {
        const unique = [...new Set(
          (colorRows ?? []).map((r: { color: string }) => r.color?.trim()).filter(Boolean)
        )];
        setAvailableColors(unique);
        setLoading(false);
      }
    }

    load().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryId]);

  return { category, stores, filterDefs, availableColors, loading };
}
