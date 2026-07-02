import { supabase } from '../supabase.js';
import type { OutboundSyncFields } from './metaCatalogAPITypes.js';

const DEFAULT_OUTBOUND_FIELDS: OutboundSyncFields = {
  price: true,
  quantity: true,
  availability: true,
  details: false,
  images: false,
};

export interface MerchantMetaConnection {
  user_id: string;
  access_token: string;
  catalog_id: string;
  auto_export_new_products: boolean;
  auto_sync_souqlink_updates_to_meta: boolean;
  outbound_sync_fields: OutboundSyncFields;
}

/**
 * Resolves the owning merchant's connected Meta catalog (access token + catalog id)
 * and outbound sync preferences for a given shop_id — auth.users → merchants(user_id)
 * → shops(merchant_id), then meta_catalog_connections(user_id).
 *
 * Returns null when the shop has no owning merchant, the merchant never connected
 * Meta, or no catalog has been selected yet — callers should treat that as
 * "nothing to push" rather than falling back to any global credentials, since a
 * global fallback would push this merchant's products into an unrelated catalog.
 */
export async function resolveMerchantMetaConnectionByShopId(
  shopId: string | null | undefined
): Promise<MerchantMetaConnection | null> {
  if (!shopId) return null;

  const { data: shop } = await supabase
    .from('shops')
    .select('merchants!inner(user_id)')
    .eq('shop_id', shopId)
    .maybeSingle();

  const userId = (shop as any)?.merchants?.user_id as string | undefined;
  if (!userId) return null;

  const { data: conn } = await supabase
    .from('meta_catalog_connections')
    .select('access_token, catalog_id, auto_export_new_products, auto_sync_souqlink_updates_to_meta, outbound_sync_fields')
    .eq('user_id', userId)
    .maybeSingle();

  if (!conn?.access_token || !conn?.catalog_id) return null;

  return {
    user_id: userId,
    access_token: conn.access_token,
    catalog_id: conn.catalog_id,
    auto_export_new_products: conn.auto_export_new_products ?? false,
    auto_sync_souqlink_updates_to_meta: conn.auto_sync_souqlink_updates_to_meta ?? false,
    outbound_sync_fields: { ...DEFAULT_OUTBOUND_FIELDS, ...(conn.outbound_sync_fields ?? {}) },
  };
}
