/**
 * RESPONSIBILITY: Frontend fetch helpers for all Delivery Agent APIs.
 */

const BASE = "/api/delivery";

/* ─── Shared types ────────────────────────────────────────────────────────── */

export interface DriverRow {
  driver_id: string;
  name: string;
  phone: string;
  current_lat: number;
  current_lng: number;
  is_available: boolean;
}

export interface HubInfo {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export interface ShopStop {
  shopId: string;
  location: { latitude: number; longitude: number };
  label: string;
}

/* ─── Route optimizer types ────────────────────────────────────────────────── */

export interface OrderRow {
  id: number;
  user_id: string;
  hub_id: number;
  status: "pending_collection" | "at_hub" | "delivering" | "completed";
  delivery_lat: number;
  delivery_lng: number;
  created_at: string;
  hub: HubInfo | null;
  uncollected_shops: number;
}

export interface CartOptimizeResult {
  collection: {
    stops: ShopStop[];
    encodedPolyline: string;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
  };
  delivery: {
    customer: { latitude: number; longitude: number };
    encodedPolyline: string;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
  };
  hub: { id: number; name: string; latitude: number; longitude: number };
}

/* ─── Collector types ──────────────────────────────────────────────────────── */

export interface CollectorItem {
  id: number;
  order_id: number;
  shop_id: string;
  product_id: string;
  qty: number;
  is_collected: boolean;
}

export interface CollectorShop {
  shop_id: string;
  name: string;
  shop_lat: number;
  shop_lng: number;
  items: CollectorItem[];
}

export interface CollectorOrder {
  id: number;
  status: string;
  hub: HubInfo | null;
  shops: CollectorShop[];
}

/* ─── Deliverer types ──────────────────────────────────────────────────────── */

export interface DelivererOrder {
  id: number;
  user_id: string;
  hub_id: number;
  status: "at_hub" | "delivering";
  delivery_lat: number;
  delivery_lng: number;
  total_price: number;
  created_at: string;
  hub: HubInfo | null;
  customer_email: string | null;
}

/* ─── Shared fetch helpers ─────────────────────────────────────────────────── */

async function patch(url: string, body: object) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

/* ─── Route optimizer ──────────────────────────────────────────────────────── */

export async function fetchDrivers(): Promise<DriverRow[]> {
  const res = await fetch(`${BASE}/drivers`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.drivers;
}

export async function fetchOrders(): Promise<OrderRow[]> {
  const res = await fetch(`${BASE}/orders`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.orders;
}

export async function optimizeCartRoute(
  driverLat: number,
  driverLng: number,
  orderId: number
): Promise<CartOptimizeResult> {
  const res = await fetch(`${BASE}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ driverLat, driverLng, orderId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

/* ─── Collector ────────────────────────────────────────────────────────────── */

export async function fetchCollectorOrders(): Promise<CollectorOrder[]> {
  const res = await fetch(`${BASE}/collector/orders`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.orders;
}

export async function confirmShopPickup(orderId: number, shopId: string) {
  return patch(`${BASE}/collector/confirm-shop`, { orderId, shopId });
}

export async function handoverToHub(orderId: number) {
  return patch(`${BASE}/collector/handover`, { orderId });
}

/* ─── Deliverer ────────────────────────────────────────────────────────────── */

export async function fetchDelivererOrders(): Promise<DelivererOrder[]> {
  const res = await fetch(`${BASE}/deliverer/orders`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.orders;
}

export async function startDelivery(orderId: number) {
  return patch(`${BASE}/deliverer/start`, { orderId });
}

export async function completeDelivery(orderId: number) {
  return patch(`${BASE}/deliverer/complete`, { orderId });
}
