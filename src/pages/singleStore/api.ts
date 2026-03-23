import type { Store, Product } from './types';

export async function fetchStore(shopId: string): Promise<Store> {
  const r = await fetch(`/api/stores/${shopId}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'فشل في تحميل بيانات المتجر');
  return data.store;
}

export async function fetchProducts(
  shopId: string,
  page: number,
  sort: string,
): Promise<{ products: Product[]; total: number }> {
  const r = await fetch(`/api/stores/${shopId}/products?page=${page}&limit=12&sort=${sort}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'فشل في تحميل المنتجات');
  return { products: data.products, total: data.total };
}
