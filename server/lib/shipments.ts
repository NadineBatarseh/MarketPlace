import { supabase } from '../supabase.js';
import { fetchAllZones, pointInZone, zoneCenter, type Zone } from './zones.js';
import { C } from '../logistics/constants.js';

/**
 * Shipment creation — run once when an order is created.
 *
 * One shipment per order line (order_detail). All lines of one store share the
 * same pickup point, so they batch together naturally even though each is its own
 * shipment row (per-order-detail model — keeps the existing batch engine, which
 * reads volume via shipments.order_detail_id → order_details → products, intact).
 *
 * Shipments are created with status 'pending' so the Demand Flow / batch engine
 * (which only reads 'available' / 'delayed') ignores them until the merchant marks
 * the line ready — a DB trigger then flips 'pending' → 'available'.
 *
 * pickup_zone / dropoff_zone are NOT set here: a BEFORE-INSERT trigger derives them
 * from the coordinates against the zone boxes. We only guarantee the coordinates
 * land inside a zone (pickup is resolved to a real zone below; dropoff is validated
 * against the chosen zone in ordersRouter before the order is written).
 *
 * Idempotent: if any shipment already exists for the order, it does nothing — safe
 * to call from both order creation and a payment callback that may fire twice.
 */

interface ShopRow {
  shop_id: string;
  shop_lat: number | null;
  shop_lng: number | null;
  zone_id: string | null;
  location: string | null;
}

/**
 * Resolve a pickup coordinate for a shop that is GUARANTEED to fall inside a zone
 * box (so the shipments zone-derivation trigger succeeds). Priority:
 *   1. the shop's own pin, if it lands inside its declared zone (or any zone when
 *      no zone is declared),
 *   2. the centre of the shop's declared zone (zone_id, else location → zones.name),
 *   3. the shop's pin if it lands in some zone (declared zone unknown),
 *   4. null → cannot place this shop's pickup; caller skips the line.
 */
function resolvePickup(shop: ShopRow, zones: Zone[]): { lat: number; lng: number } | null {
  const declared =
    (shop.zone_id && zones.find(z => z.id === shop.zone_id)) ||
    (shop.location && zones.find(z => z.name === shop.location)) ||
    null;

  const hasPin = shop.shop_lat != null && shop.shop_lng != null;
  const containing = hasPin
    ? zones.find(z => pointInZone(z, shop.shop_lat as number, shop.shop_lng as number)) ?? null
    : null;

  if (hasPin && containing && (!declared || containing.id === declared.id)) {
    return { lat: shop.shop_lat as number, lng: shop.shop_lng as number };
  }
  if (declared) return zoneCenter(declared);
  if (hasPin && containing) return { lat: shop.shop_lat as number, lng: shop.shop_lng as number };
  return null;
}

export async function createShipmentsForOrder(orderId: number | string): Promise<void> {
  // Idempotency — already created for this order.
  const { count } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  if ((count ?? 0) > 0) return;

  const { data: order } = await supabase
    .from('orders')
    .select('id, delivery_lat, delivery_lng, dropoff_zone_id, dropoff_place_id, dropoff_formatted_address, delivery_address_description')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.delivery_lat == null || order.delivery_lng == null) {
    console.warn(`[shipments] order ${orderId} has no delivery coordinates — skipping shipment creation`);
    return;
  }

  const { data: details } = await supabase
    .from('order_details')
    .select('id, shop_id, qty')
    .eq('order_id', orderId);
  if (!details?.length) return;

  const shopIds = [...new Set(details.map(d => d.shop_id).filter(Boolean))] as string[];
  const [{ data: shopRows }, zones] = await Promise.all([
    supabase.from('shops').select('shop_id, shop_lat, shop_lng, zone_id, location').in('shop_id', shopIds),
    fetchAllZones(),
  ]);
  const shopMap = new Map<string, ShopRow>((shopRows ?? []).map(s => [s.shop_id, s as ShopRow]));

  const deadline = new Date(Date.now() + C.SHIPMENT_DEADLINE_HOURS * 3600 * 1000).toISOString();

  const rows: Array<Record<string, unknown>> = [];
  for (const d of details) {
    const shop = d.shop_id ? shopMap.get(d.shop_id) : undefined;
    const pickup = shop ? resolvePickup(shop, zones) : null;
    if (!pickup) {
      console.warn(`[shipments] order ${orderId}: cannot resolve pickup zone for shop ${d.shop_id} — skipping order_detail ${d.id}`);
      continue;
    }
    rows.push({
      status: 'pending',
      order_id: order.id,
      order_detail_id: d.id,
      store_id: d.shop_id,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: order.delivery_lat,
      dropoff_lng: order.delivery_lng,
      dropoff_zone_id: order.dropoff_zone_id ?? null,
      dropoff_place_id: order.dropoff_place_id ?? null,
      dropoff_formatted_address: order.dropoff_formatted_address ?? null,
      delivery_address_description: order.delivery_address_description ?? null,
      deadline,
      estimated_delivery_at: deadline,
      eta_source: 'sla_fallback',
      eta_computed_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from('shipments').insert(rows);
  if (error) {
    // Best-effort: never fail the order/payment because shipment creation hiccuped.
    console.error(`[shipments] insert failed for order ${orderId}:`, error.message);
  }
}
