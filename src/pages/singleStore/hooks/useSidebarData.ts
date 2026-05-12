import { useState, useEffect } from 'react';
import supabase from '../../../lib/supabase';

export interface FilterDef {
  id: string;
  category_id: string;
  filter_key: string;
  filter_label_ar: string;
  filter_type: 'select' | 'multiselect' | 'color' | 'boolean';
  options: string[] | null;
  is_required: boolean;
  display_order: number;
}

interface Result {
  shopCategoryId: string;
  filterDefs: FilterDef[];
  availableColors: string[];
  loadingFilters: boolean;
}

export function useSidebarData(shopId: string): Result {
  const [shopCategoryId, setShopCategoryId] = useState('');
  const [filterDefs, setFilterDefs] = useState<FilterDef[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [loadingFilters, setLoadingFilters] = useState(false);

  // Step 1: Resolve shopCategoryId from shops.Type_of_store → categories.label match
  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;

    supabase
      .from('shops')
      .select('Type_of_store')
      .eq('shop_id', shopId)
      .single()
      .then(async ({ data: shopData }) => {
        if (cancelled || !shopData?.Type_of_store) return;

        const { data: catData } = await supabase
          .from('categories')
          .select('id')
          .eq('label', shopData.Type_of_store)
          .single();

        if (!cancelled && catData?.id) {
          setShopCategoryId(catData.id as string);
        }
      });

    return () => { cancelled = true; };
  }, [shopId]);

  // Step 2: Load filter definitions + available colors for the resolved category
  useEffect(() => {
    if (!shopCategoryId) {
      setFilterDefs([]);
      setAvailableColors([]);
      return;
    }

    let cancelled = false;
    setLoadingFilters(true);

    supabase
      .from('category_filter_definitions')
      .select('*')
      .eq('category_id', shopCategoryId)
      .order('display_order', { ascending: true })
      .then(async ({ data }) => {
        if (cancelled) return;

        const defs = (data ?? []) as FilterDef[];
        setFilterDefs(defs);

        const colorFilterIds = defs
          .filter(d => d.filter_type === 'color')
          .map(d => d.id);

        if (colorFilterIds.length === 0) {
          setAvailableColors([]);
          setLoadingFilters(false);
          return;
        }

        const { data: productRows } = await supabase
          .from('products')
          .select('id')
          .eq('shop_id', shopId)
          .eq('isPublish', true);

        if (cancelled) return;

        const productIds = (productRows ?? []).map(r => r.id as string);

        if (productIds.length === 0) {
          setAvailableColors([]);
          setLoadingFilters(false);
          return;
        }

        const { data: colorRows } = await supabase
          .from('product_variants')
          .select('color')
          .in('product_id', productIds);

        if (!cancelled) {
          const unique = [...new Set(
            (colorRows ?? []).map(r => (r.color as string)?.trim()).filter(Boolean)
          )];
          setAvailableColors(unique);
          setLoadingFilters(false);
        }
      });

    return () => { cancelled = true; };
  }, [shopId, shopCategoryId]);

  return { shopCategoryId, filterDefs, availableColors, loadingFilters };
}
