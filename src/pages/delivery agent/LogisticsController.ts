/**
 * RESPONSIBILITY: Three-phase logistics business logic.
 *
 * Uses order_details directly — no separate packages table.
 * A "virtual package" = unique (order_id, shop_id) group in order_details.
 * Two new columns added to order_details:
 *   verification_code TEXT
 *   package_status    TEXT  DEFAULT 'pending'  -- pending | picked_up | at_hub | delivered
 *
 * Order status flow:
 *   pending_collection → at_hub → consolidated → delivering → completed
 */

import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  computeOptimizedRoute,
  computeDirectRoute,
  type LatLng,
  type RouteStop,
} from "./mapsService.js";
import { createBatches, type ShopPickup } from "../../server/services/batchingService.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const fmtPkg = (id: number) => `PKG-${String(id).padStart(3, "0")}`;
const fmtOrd = (id: number) => `ORD-${String(id).padStart(3, "0")}`;

/**
 * Group order_details rows into virtual packages.
 * One package = one unique (order_id, shop_id) pair.
 * raw_id = the smallest row id in the group (used as stable display identifier).
 */
function groupIntoPackages(details: any[]) {
  const map = new Map<
    string,
    {
      raw_id: number;
      order_id: number;
      shop_id: string;
      status: string;
      verification_code: string | null;
    }
  >();

  for (const d of details) {
    const key = `${d.order_id}:${d.shop_id}`;
    if (!map.has(key)) {
      map.set(key, {
        raw_id: d.id,
        order_id: d.order_id,
        shop_id: d.shop_id,
        status: d.package_status ?? "pending",
        verification_code: d.verification_code ?? null,
      });
    } else {
      const g = map.get(key)!;
      if (d.id < g.raw_id) g.raw_id = d.id; // keep min id as the representative
    }
  }

  return Array.from(map.values()).map((g) => ({ ...g, id: fmtPkg(g.raw_id) }));
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — FIRST MILE  (Collector)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/logistics/pickup
// Returns shops with their pending packages — NO customer info exposed.
export async function getPickupOrders(_req: Request, res: Response) {
  try {
    // Only rows still pending
    const { data: details, error } = await supabase
      .from("order_details")
      .select("id, order_id, shop_id, package_status, verification_code")
      .eq("package_status", "pending");

    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!details?.length) return res.json({ ok: true, shops: [] });

    // Group into virtual packages
    const packages = groupIntoPackages(details);

    // Fetch shop info
    const shopIds = [...new Set(packages.map((p) => p.shop_id))];
    const { data: shops } = await supabase
      .from("shops")
      .select("shop_id, name, shop_lat, shop_lng")
      .in("shop_id", shopIds);
    const shopMap = new Map((shops ?? []).map((s) => [s.shop_id, s]));

    // Group packages by shop
    const shopGroups = new Map<string, { shop: any; packages: any[] }>();
    for (const pkg of packages) {
      if (!shopGroups.has(pkg.shop_id)) {
        shopGroups.set(pkg.shop_id, {
          shop: shopMap.get(pkg.shop_id) ?? {
            shop_id: pkg.shop_id,
            name: "متجر غير معروف",
          },
          packages: [],
        });
      }
      shopGroups.get(pkg.shop_id)!.packages.push({
        id: pkg.id,
        raw_id: pkg.raw_id,
        order_id: pkg.order_id,
        status: pkg.status,
      });
    }

    return res.json({ ok: true, shops: Array.from(shopGroups.values()) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// PATCH /api/logistics/pickup/confirm
// Body: { rawPackageId, verificationCode }
// rawPackageId = the min row id of the (order_id, shop_id) group.
export async function confirmPackagePickup(req: Request, res: Response) {
  try {
    const { rawPackageId, verificationCode } = req.body as {
      rawPackageId: number;
      verificationCode?: string;
    };
    if (!rawPackageId)
      return res.status(400).json({ ok: false, error: "rawPackageId مطلوب" });

    // Fetch the representative row to get order_id, shop_id, and verification_code
    const { data: row, error: fetchErr } = await supabase
      .from("order_details")
      .select("id, order_id, shop_id, package_status, verification_code")
      .eq("id", rawPackageId)
      .single();

    if (fetchErr || !row)
      return res.status(404).json({ ok: false, error: "الطرد غير موجود" });
    if (row.package_status !== "pending")
      return res
        .status(400)
        .json({ ok: false, error: "تمت معالجة هذا الطرد مسبقاً" });

    // Check verification code only if one is set
    if (
      row.verification_code &&
      row.verification_code.toUpperCase() !==
        (verificationCode ?? "").toUpperCase()
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "كود التحقق غير صحيح" });
    }

    // Update ALL rows for this (order_id, shop_id) pair
    const { error: updateErr } = await supabase
      .from("order_details")
      .update({
        package_status: "picked_up",
        collected_at: new Date().toISOString(),
      })
      .eq("order_id", row.order_id)
      .eq("shop_id", row.shop_id);

    if (updateErr)
      return res.status(500).json({ ok: false, error: updateErr.message });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — HUB  (Organizer)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/logistics/hub
export async function getHubBoard(_req: Request, res: Response) {
  try {
    const { data: orders, error: ordErr } = await supabase
      .from("orders")
      .select("id, status, total_price, created_at")
      .in("status", ["pending_collection", "at_hub"])
      .order("created_at");

    if (ordErr) return res.status(500).json({ ok: false, error: ordErr.message });
    if (!orders?.length) return res.json({ ok: true, orders: [] });

    const orderIds = orders.map((o) => o.id);

    // Fetch all order_details for these orders
    const { data: details, error: detErr } = await supabase
      .from("order_details")
      .select("id, order_id, shop_id, package_status")
      .in("order_id", orderIds);

    if (detErr) return res.status(500).json({ ok: false, error: detErr.message });

    // Group into virtual packages per order
    const pkgsByOrder = new Map<number, any[]>();
    for (const pkg of groupIntoPackages(details ?? [])) {
      if (!pkgsByOrder.has(pkg.order_id)) pkgsByOrder.set(pkg.order_id, []);
      pkgsByOrder.get(pkg.order_id)!.push({
        id: pkg.id,
        raw_id: pkg.raw_id,
        status: pkg.status,
      });
    }

    const result = orders.map((o) => {
      const pkgs = pkgsByOrder.get(o.id) ?? [];
      const atHubCount = pkgs.filter((p) => p.status === "at_hub").length;
      return {
        id: o.id,
        display_id: fmtOrd(o.id),
        status: o.status,
        total_price: o.total_price,
        created_at: o.created_at,
        packages_total: pkgs.length,
        packages_at_hub: atHubCount,
        packages: pkgs,
        is_ready: pkgs.length > 0 && atHubCount === pkgs.length,
      };
    });

    return res.json({ ok: true, orders: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// PATCH /api/logistics/hub/receive
// Body: { rawPackageId }  → marks all rows of that (order_id, shop_id) as at_hub.
export async function receivePackageAtHub(req: Request, res: Response) {
  try {
    const { rawPackageId } = req.body as { rawPackageId: number };
    if (!rawPackageId)
      return res.status(400).json({ ok: false, error: "rawPackageId مطلوب" });

    // Get representative row
    const { data: row, error: fetchErr } = await supabase
      .from("order_details")
      .select("id, order_id, shop_id")
      .eq("id", rawPackageId)
      .single();

    if (fetchErr || !row)
      return res.status(404).json({ ok: false, error: "الطرد غير موجود" });

    // Mark all rows of this (order_id, shop_id) as at_hub
    const { error: updateErr } = await supabase
      .from("order_details")
      .update({ package_status: "at_hub" })
      .eq("order_id", row.order_id)
      .eq("shop_id", row.shop_id);

    if (updateErr)
      return res.status(500).json({ ok: false, error: updateErr.message });

    // Check if all (order_id, shop_id) groups for this order are now at_hub
    const { data: remaining } = await supabase
      .from("order_details")
      .select("id")
      .eq("order_id", row.order_id)
      .neq("package_status", "at_hub");

    const allAtHub = !remaining?.length;
    if (allAtHub) {
      await supabase
        .from("orders")
        .update({ status: "at_hub" })
        .eq("id", row.order_id);
    }

    return res.json({ ok: true, allAtHub });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/logistics/hub/consolidate
// Body: { orderId }  → verifies all at_hub, marks order consolidated, returns label.
export async function consolidateOrder(req: Request, res: Response) {
  try {
    const { orderId } = req.body as { orderId: number };
    if (!orderId)
      return res.status(400).json({ ok: false, error: "orderId مطلوب" });

    // Guard: all order_details for this order must be at_hub
    const { data: notReady } = await supabase
      .from("order_details")
      .select("id")
      .eq("order_id", orderId)
      .neq("package_status", "at_hub");

    if (notReady?.length)
      return res
        .status(400)
        .json({ ok: false, error: "لم تصل جميع الطرود إلى المركز بعد" });

    // Fetch order
    const { data: order, error: ordErr } = await supabase
      .from("orders")
      .select("id, user_id, delivery_lat, delivery_lng, total_price")
      .eq("id", orderId)
      .single();

    if (ordErr || !order)
      return res.status(404).json({ ok: false, error: "الطلب غير موجود" });

    // Fetch customer
    const { data: user } = await supabase
      .from("users")
      .select("user_id, email, name, phone")
      .eq("user_id", order.user_id)
      .maybeSingle();

    // Build package IDs from virtual packages
    const { data: details } = await supabase
      .from("order_details")
      .select("id, shop_id")
      .eq("order_id", orderId);

    const virtualPkgs = groupIntoPackages(
      (details ?? []).map((d) => ({ ...d, order_id: orderId, package_status: "at_hub" }))
    );

    // Mark order as consolidated
    const { error: updateErr } = await supabase
      .from("orders")
      .update({ status: "consolidated" })
      .eq("id", orderId);

    if (updateErr)
      return res.status(500).json({ ok: false, error: updateErr.message });

    return res.json({
      ok: true,
      label: {
        order_id: fmtOrd(orderId),
        customer_name: (user as any)?.name ?? user?.email ?? "غير محدد",
        customer_phone: (user as any)?.phone ?? null,
        delivery_lat: order.delivery_lat,
        delivery_lng: order.delivery_lng,
        total_price: order.total_price,
        packages: virtualPkgs.map((p) => p.id),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — LAST MILE  (Deliverer)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/logistics/delivery
export async function getDeliveryOrders(_req: Request, res: Response) {
  try {
    const { data: orders, error: ordErr } = await supabase
      .from("orders")
      .select(
        "id, user_id, hub_id, status, delivery_lat, delivery_lng, total_price, created_at"
      )
      .in("status", ["consolidated", "delivering"])
      .order("created_at");

    if (ordErr) return res.status(500).json({ ok: false, error: ordErr.message });
    if (!orders?.length) return res.json({ ok: true, orders: [] });

    // Customer info
    const userIds = [...new Set(orders.map((o) => o.user_id).filter(Boolean))];
    const { data: users } = await supabase
      .from("users")
      .select("user_id, email, name, phone")
      .in("user_id", userIds);
    const userMap = new Map((users ?? []).map((u) => [u.user_id, u]));

    // Package IDs per order (virtual packages from order_details)
    const orderIds = orders.map((o) => o.id);
    const { data: details } = await supabase
      .from("order_details")
      .select("id, order_id, shop_id, package_status")
      .in("order_id", orderIds);

    const pkgIdsByOrder = new Map<number, string[]>();
    for (const pkg of groupIntoPackages(details ?? [])) {
      if (!pkgIdsByOrder.has(pkg.order_id)) pkgIdsByOrder.set(pkg.order_id, []);
      pkgIdsByOrder.get(pkg.order_id)!.push(pkg.id);
    }

    const result = orders.map((o) => {
      const user = userMap.get(o.user_id) as any;
      return {
        ...o,
        display_id: fmtOrd(o.id),
        customer_name: user?.name ?? user?.email ?? "غير محدد",
        customer_phone: user?.phone ?? null,
        packages: pkgIdsByOrder.get(o.id) ?? [],
      };
    });

    return res.json({ ok: true, orders: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// PATCH /api/logistics/delivery/start
export async function startLastMileDelivery(req: Request, res: Response) {
  try {
    const { orderId } = req.body as { orderId: number };
    if (!orderId)
      return res.status(400).json({ ok: false, error: "orderId مطلوب" });

    const { error } = await supabase
      .from("orders")
      .update({ status: "delivering" })
      .eq("id", orderId)
      .eq("status", "consolidated");

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// PATCH /api/logistics/delivery/complete
export async function completeLastMileDelivery(req: Request, res: Response) {
  try {
    const { orderId } = req.body as { orderId: number };
    if (!orderId)
      return res.status(400).json({ ok: false, error: "orderId مطلوب" });

    const { error: orderErr } = await supabase
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId)
      .eq("status", "delivering");

    if (orderErr) return res.status(500).json({ ok: false, error: orderErr.message });

    // Mark all packages for this order as delivered
    const { error: pkgErr } = await supabase
      .from("order_details")
      .update({ package_status: "delivered" })
      .eq("order_id", orderId);

    if (pkgErr) return res.status(500).json({ ok: false, error: pkgErr.message });

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTE MAPS — Optimized journey for Collector and Deliverer
// ════════════════════════════════════════════════════════════════════════════

// POST /api/logistics/collector/route
// Body: { driverLat, driverLng }
// Returns optimized stops (driver → shops → hub) + encoded polyline.
export async function getCollectorRoute(req: Request, res: Response) {
  try {
    const { driverLat, driverLng } = req.body as {
      driverLat: number;
      driverLng: number;
    };
    if (!driverLat || !driverLng)
      return res.status(400).json({ ok: false, error: "موقع السائق مطلوب" });

    // 1. Pending order_details → unique shop IDs
    const { data: details, error: detErr } = await supabase
      .from("order_details")
      .select("order_id, shop_id")
      .eq("package_status", "pending");

    if (detErr) return res.status(500).json({ ok: false, error: detErr.message });
    if (!details?.length)
      return res.json({ ok: true, stops: [], encodedPolyline: null, totalDistanceMeters: 0, totalDurationSeconds: 0 });

    const shopIds = [...new Set(details.map((d) => d.shop_id))];
    const orderIds = [...new Set(details.map((d) => d.order_id))];

    // 2. Shop locations
    const { data: shops } = await supabase
      .from("shops")
      .select("shop_id, name, shop_lat, shop_lng")
      .in("shop_id", shopIds);

    const shopStops: RouteStop[] = (shops ?? [])
      .filter((s) => s.shop_lat && s.shop_lng)
      .map((s) => ({
        shopId: s.shop_id,
        location: { latitude: s.shop_lat, longitude: s.shop_lng },
        label: s.name ?? s.shop_id,
      }));

    if (!shopStops.length)
      return res.status(400).json({ ok: false, error: "لا توجد إحداثيات للمتاجر" });

    // 3. Hub from first order
    const { data: orders } = await supabase
      .from("orders")
      .select("hub_id")
      .in("id", orderIds)
      .limit(1);

    const { data: hub } = await supabase
      .from("hubs")
      .select("id, name, lat, lng")
      .eq("id", orders?.[0]?.hub_id)
      .single();

    if (!hub)
      return res.status(400).json({ ok: false, error: "لم يتم العثور على نقطة التجميع" });

    const driverLoc: LatLng = { latitude: driverLat, longitude: driverLng };
    const hubLoc: LatLng = { latitude: hub.lat, longitude: hub.lng };

    // 4. Compute optimized route
    const route = await computeOptimizedRoute(driverLoc, hubLoc, shopStops);

    const orderedShops =
      route.optimizedOrder.length > 0
        ? route.optimizedOrder.map((i) => shopStops[i]).filter(Boolean)
        : shopStops;

    return res.json({
      ok: true,
      stops: [
        { lat: driverLat, lng: driverLng, label: "موقعك", type: "driver" },
        ...orderedShops.map((s, i) => ({
          lat: s.location.latitude,
          lng: s.location.longitude,
          label: `${i + 1}. ${s.label}`,
          type: "shop",
        })),
        { lat: hub.lat, lng: hub.lng, label: hub.name, type: "hub" },
      ],
      encodedPolyline: route.encodedPolyline,
      totalDistanceMeters: route.totalDistanceMeters,
      totalDurationSeconds: route.totalDurationSeconds,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BATCHING — Group pending shop pickups into driver batches
// ════════════════════════════════════════════════════════════════════════════

// GET /api/logistics/batches
// Reads BatchConfig from the batch_config table, builds shopPickups from
// pending order_details, and returns the computed driver batches.
export async function getBatches(_req: Request, res: Response) {
  try {
    // 1. Load config from Supabase so values can be changed without a redeploy
    const { data: cfg, error: cfgErr } = await supabase
      .from("batch_config")
      .select("max_driver_capacity, max_stops_per_batch, max_allowed_wait, max_distance_km")
      .single();

    if (cfgErr || !cfg)
      return res.status(500).json({ ok: false, error: "فشل تحميل إعدادات التجميع" });

    // 2. Fetch all pending order_details (each row = one line item)
    const { data: details, error: detErr } = await supabase
      .from("order_details")
      .select("order_id, shop_id, product_id, qty")
      .eq("package_status", "pending");

    if (detErr) return res.status(500).json({ ok: false, error: detErr.message });
    if (!details?.length) return res.json({ ok: true, batches: [] });

    const shopIds  = [...new Set(details.map((d) => d.shop_id))];
    const orderIds = [...new Set(details.map((d) => d.order_id))];
    const productIds = [...new Set(details.map((d) => d.product_id).filter(Boolean))];

    // 3. Fetch shop locations
    const { data: shops } = await supabase
      .from("shops")
      .select("shop_id, shop_lat, shop_lng")
      .in("shop_id", shopIds);

    const shopMap = new Map((shops ?? []).map((s) => [s.shop_id, s]));

    // 4. Fetch orders to get ready_time (falls back to created_at when null)
    const { data: orders } = await supabase
      .from("orders")
      .select("id, ready_time, created_at")
      .in("id", orderIds);

    const orderTimeMap = new Map(
      (orders ?? []).map((o) => [
        o.id,
        new Date(o.ready_time ?? o.created_at).getTime(),
      ])
    );

    // 5. Fetch product capacity_units for volume calculation
    const { data: products } = await supabase
      .from("products")
      .select("id, capacity_units")
      .in("id", productIds);

    const capacityMap = new Map(
      (products ?? []).map((p) => [p.id, (p.capacity_units as number) ?? 3])
    );

    // 6. Aggregate order_details into one ShopPickup per shop
    const shopPickupMap = new Map<string, ShopPickup>();

    for (const d of details) {
      const shop = shopMap.get(d.shop_id);
      if (!shop?.shop_lat || !shop?.shop_lng) continue; // skip shops with no location

      if (!shopPickupMap.has(d.shop_id)) {
        shopPickupMap.set(d.shop_id, {
          shop_id:      d.shop_id,
          lat:          shop.shop_lat,
          lng:          shop.shop_lng,
          ready_time:   orderTimeMap.get(d.order_id) ?? Date.now(),
          total_volume: 0,
          order_ids:    [],
        });
      }

      const entry = shopPickupMap.get(d.shop_id)!;

      // Use the earliest ready_time across all orders for this shop
      const t = orderTimeMap.get(d.order_id) ?? Date.now();
      if (t < entry.ready_time) entry.ready_time = t;

      // Accumulate volume: qty × capacity_units (default 3 if unknown)
      const units = capacityMap.get(d.product_id) ?? 3;
      entry.total_volume += (d.qty ?? 1) * units;

      // Collect unique order IDs
      if (!entry.order_ids.includes(d.order_id)) {
        entry.order_ids.push(d.order_id);
      }
    }

    const shopPickups = Array.from(shopPickupMap.values());

    // 7. Run the batching algorithm with the config from Supabase
    const batches = createBatches(shopPickups, {
      MAX_DRIVER_CAPACITY: cfg.max_driver_capacity,
      MAX_STOPS_PER_BATCH: cfg.max_stops_per_batch,
      MAX_ALLOWED_WAIT:    cfg.max_allowed_wait,
      MAX_DISTANCE_KM:     cfg.max_distance_km,
    });

    return res.json({ ok: true, batches });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/logistics/deliverer/route
// Body: { driverLat, driverLng }
// Returns optimized stops (driver → hub → customers) + encoded polyline.
export async function getDelivererRoute(req: Request, res: Response) {
  try {
    const { driverLat, driverLng } = req.body as {
      driverLat: number;
      driverLng: number;
    };
    if (!driverLat || !driverLng)
      return res.status(400).json({ ok: false, error: "موقع السائق مطلوب" });

    // 1. Consolidated/delivering orders with delivery coords
    const { data: orders, error: ordErr } = await supabase
      .from("orders")
      .select("id, hub_id, delivery_lat, delivery_lng")
      .in("status", ["consolidated", "delivering"]);

    if (ordErr) return res.status(500).json({ ok: false, error: ordErr.message });

    const deliverableOrders = (orders ?? []).filter(
      (o) => o.delivery_lat && o.delivery_lng
    );
    if (!deliverableOrders.length)
      return res.json({ ok: true, stops: [], encodedPolyline: null, totalDistanceMeters: 0, totalDurationSeconds: 0 });

    // 2. Hub
    const { data: hub } = await supabase
      .from("hubs")
      .select("id, name, lat, lng")
      .eq("id", deliverableOrders[0].hub_id)
      .single();

    if (!hub)
      return res.status(400).json({ ok: false, error: "لم يتم العثور على نقطة التجميع" });

    const driverLoc: LatLng = { latitude: driverLat, longitude: driverLng };
    const hubLoc: LatLng = { latitude: hub.lat, longitude: hub.lng };

    let encodedPolyline = "";
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    let orderedOrders = deliverableOrders;

    if (deliverableOrders.length === 1) {
      // Direct: driver → hub → customer
      const custLoc: LatLng = {
        latitude: deliverableOrders[0].delivery_lat,
        longitude: deliverableOrders[0].delivery_lng,
      };
      const leg1 = await computeDirectRoute(driverLoc, hubLoc);
      const leg2 = await computeDirectRoute(hubLoc, custLoc);
      encodedPolyline = leg2.encodedPolyline;
      totalDistanceMeters = leg1.totalDistanceMeters + leg2.totalDistanceMeters;
      totalDurationSeconds = leg1.totalDurationSeconds + leg2.totalDurationSeconds;
    } else {
      // Optimized multi-stop: hub → all customers
      const customerStops: RouteStop[] = deliverableOrders.map((o) => ({
        shopId: String(o.id),
        location: { latitude: o.delivery_lat, longitude: o.delivery_lng },
        label: fmtOrd(o.id),
      }));
      const lastStop = customerStops[customerStops.length - 1];
      const route = await computeOptimizedRoute(
        hubLoc,
        lastStop.location,
        customerStops.slice(0, -1)
      );
      encodedPolyline = route.encodedPolyline;
      totalDistanceMeters = route.totalDistanceMeters;
      totalDurationSeconds = route.totalDurationSeconds;
      orderedOrders =
        route.optimizedOrder.length > 0
          ? route.optimizedOrder.map((i) => deliverableOrders[i]).filter(Boolean)
          : deliverableOrders;
    }

    return res.json({
      ok: true,
      stops: [
        { lat: driverLat, lng: driverLng, label: "موقعك", type: "driver" },
        { lat: hub.lat, lng: hub.lng, label: hub.name, type: "hub" },
        ...orderedOrders.map((o, i) => ({
          lat: o.delivery_lat,
          lng: o.delivery_lng,
          label: `توصيل ${i + 1} — ${fmtOrd(o.id)}`,
          type: "customer",
        })),
      ],
      encodedPolyline,
      totalDistanceMeters,
      totalDurationSeconds,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
