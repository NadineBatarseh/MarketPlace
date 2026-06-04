import type { Store, Product } from './types';
import { supabase } from '../../lib/supabase';

export async function fetchStore(shopId: string): Promise<Store> {
  const { data: shop, error } = await supabase
    .from('shops')
    .select('shop_id, name, description, shopLogo, created_at, whatsapp, instagram, facebook, location')
    .eq('shop_id', shopId)
    .single();

  if (error || !shop) throw new Error(error?.message || 'فشل في تحميل بيانات المتجر');

  const { data: rating } = await supabase
    .from('shop_ratings')
    .select('avg_rating, review_count')
    .eq('shop_id', shopId)
    .maybeSingle();

  return {
    ...shop,
    avg_rating: rating?.avg_rating ?? null,
    review_count: rating?.review_count ?? 0,
  };
}

export async function fetchProducts(
  shopId: string,
  page: number,
  sort: string,
): Promise<{ products: Product[]; total: number }> {
  const limit = 12;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('products')
    .select('id, title, description, price, image_urls, stock_Quantity', { count: 'exact' })
    .eq('shop_id', shopId)
    .eq('isPublish', true)
    .not('is_deleted', 'eq', true)
    .not('is_archived', 'eq', true)
    .range(from, to);

  if (sort === 'price_asc') query = query.order('price', { ascending: true });
  else if (sort === 'price_desc') query = query.order('price', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data, count, error } = await query;

  if (error) throw new Error(error.message || 'فشل في تحميل المنتجات');

  return { products: (data as Product[]) ?? [], total: count ?? 0 };
}
