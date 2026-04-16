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
import { createBatches, type ShopPickup } from "../../../server/services/batchingService.js";
import {
  assignBatchesToDrivers,
  type AssignmentBatch,
  type Driver,
} from "../../../server/services/assignmentService.js";

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
// Returns two sets of batches:
//   1. Persisted batches from the batches table (including assigned ones with driver info)
//   2. Dynamically computed batches for any order_details not yet batched (batch_id IS NULL)
export async function getBatches(_req: Request, res: Response) {
  try {
    // 1. Load config
    const { data: cfg, error: cfgErr } = await supabase
      .from("batch_config")
      .select("max_driver_capacity, max_stops_per_batch, max_allowed_wait, max_distance_km")
      .single();

    const config = (!cfgErr && cfg) ? cfg : {
      max_driver_capacity: 20,
      max_stops_per_batch: 6,
      max_allowed_wait:    60,
      max_distance_km:     5,
    };

    // 2. Fetch saved batches + unassigned order_details in parallel
    const [
      { data: savedBatches, error: sbErr },
      { data: unassignedDetails, error: udErr },
    ] = await Promise.all([
      supabase.from("batches")
        .select("id, assigned_driver_id, status, total_volume, stops")
        .order("id", { ascending: true }),
      supabase.from("order_details")
        .select("order_id, shop_id, product_id, qty, ready_time")
        .eq("package_status", "pending")
        .is("batch_id", null),
    ]);

    if (sbErr) return res.status(500).json({ ok: false, error: sbErr.message });
    if (udErr) return res.status(500).json({ ok: false, error: udErr.message });

    // 3. Fetch order_details that belong to saved batches
    const savedBatchIds = (savedBatches ?? []).map((b) => b.id);
    const { data: savedDetails } = savedBatchIds.length > 0
      ? await supabase
          .from("order_details")
          .select("batch_id, order_id, shop_id, product_id, qty, ready_time")
          .in("batch_id", savedBatchIds)
      : { data: [] as any[] };

    // 4. Collect all unique IDs for lookup tables
    const allDetails = [...(savedDetails ?? []), ...(unassignedDetails ?? [])];
    if (!allDetails.length && !savedBatches?.length) {
      return res.json({ ok: true, batches: [] });
    }

    const shopIds    = [...new Set(allDetails.map((d) => d.shop_id).filter(Boolean))];
    const orderIds   = [...new Set(allDetails.map((d) => d.order_id).filter(Boolean))];
    const productIds = [...new Set(allDetails.map((d) => d.product_id).filter(Boolean))];
    const driverIds  = [...new Set((savedBatches ?? []).map((b) => b.assigned_driver_id).filter(Boolean))];

    // 5. Parallel lookups
    const [shopsRes, ordersRes, productsRes, driversRes] = await Promise.all([
      shopIds.length    ? supabase.from("shops").select("shop_id, name, shop_lat, shop_lng, location").in("shop_id", shopIds) : { data: [] as any[] },
      orderIds.length   ? supabase.from("orders").select("id, created_at").in("id", orderIds)                              : { data: [] as any[] },
      productIds.length ? supabase.from("products").select("id, title, capacity_units").in("id", productIds)               : { data: [] as any[] },
      driverIds.length  ? supabase.from("drivers").select("driver_id, name").in("driver_id", driverIds)                    : { data: [] as any[] },
    ]);

    const shopMap         = new Map((shopsRes.data    ?? []).map((s: any) => [s.shop_id, s]));
    const orderCreatedMap = new Map((ordersRes.data   ?? []).map((o: any) => [o.id, new Date(o.created_at).getTime()]));
    const capacityMap     = new Map((productsRes.data ?? []).map((p: any) => [p.id, (p.capacity_units as number) ?? 3]));
    const titleMap        = new Map((productsRes.data ?? []).map((p: any) => [p.id, (p.title as string) ?? "منتج غير معروف"]));
    const driverMap       = new Map((driversRes.data  ?? []).map((d: any) => [d.driver_id, d.name as string]));

    // 6. Helper: build ShopPickup list from a set of detail rows
    function buildShopPickups(rows: any[]): ShopPickup[] {
      const pickupMap = new Map<string, ShopPickup>();
      for (const d of rows) {
        const shop = shopMap.get(d.shop_id);
        if (!shop?.shop_lat || !shop?.shop_lng) {
          console.warn(`[batching] skipping shop ${d.shop_id} — missing coordinates`);
          continue;
        }

        const rowTime = d.ready_time
          ? new Date(d.ready_time).getTime()
          : (orderCreatedMap.get(d.order_id) ?? Date.now());

        if (!pickupMap.has(d.shop_id)) {
          pickupMap.set(d.shop_id, {
            shop_id:      d.shop_id,
            shop_name:    shop.name ?? d.shop_id,
            lat:          shop.shop_lat,
            lng:          shop.shop_lng,
            ready_time:   rowTime,
            total_volume: 0,
            order_ids:    [],
            items:        [],
            zone_id:      shop.location ?? undefined,
          });
        }
        const entry = pickupMap.get(d.shop_id)!;
        if (rowTime < entry.ready_time) entry.ready_time = rowTime;

        const qty   = d.qty ?? 1;
        const units = capacityMap.get(d.product_id) ?? 3;
        entry.total_volume += qty * units;

        if (!entry.order_ids.includes(d.order_id)) entry.order_ids.push(d.order_id);

        const title    = titleMap.get(d.product_id) ?? "منتج غير معروف";
        const existing = entry.items.find((i) => i.product_title === title);
        if (existing) existing.qty += qty;
        else entry.items.push({ product_title: title, qty });
      }
      return Array.from(pickupMap.values());
    }

    // 7. Reconstruct persisted batches with their shop data and driver info
    const savedDetailsByBatch = new Map<number, any[]>();
    for (const d of savedDetails ?? []) {
      if (!savedDetailsByBatch.has(d.batch_id)) savedDetailsByBatch.set(d.batch_id, []);
      savedDetailsByBatch.get(d.batch_id)!.push(d);
    }

    const persistedBatches = (savedBatches ?? []).map((b) => {
      const rows   = savedDetailsByBatch.get(b.id) ?? [];
      const shops  = buildShopPickups(rows);
      const driverId = b.assigned_driver_id as number | null;

      let assigned_driver: { driver_id: number; name: string } | null | undefined;
      if (driverId) {
        assigned_driver = { driver_id: driverId, name: driverMap.get(driverId) ?? `سائق ${driverId}` };
      } else if (b.status === "unassigned") {
        assigned_driver = null; // went through assignment but no driver found
      } else {
        assigned_driver = undefined; // pending, not yet through assignment
      }

      return {
        shops,
        order_ids:    [...new Set(rows.map((d: any) => d.order_id as number))],
        total_volume: b.total_volume as number,
        stops:        b.stops as number,
        assigned_driver,
      };
    });

    // 8. Compute new batches for orders not yet batched
    const pendingPickups = buildShopPickups(unassignedDetails ?? []);
    const pendingBatches = pendingPickups.length > 0
      ? await createBatches(pendingPickups, {
          MAX_DRIVER_CAPACITY: config.max_driver_capacity,
          MAX_STOPS_PER_BATCH: config.max_stops_per_batch,
          MAX_ALLOWED_WAIT:    config.max_allowed_wait,
          MAX_DISTANCE_KM:     config.max_distance_km,
        })
      : [];

    return res.json({
      ok:      true,
      batches: [...persistedBatches, ...pendingBatches],
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// POST /api/logistics/assign
// Runs the driver assignment algorithm against current pending batches and
// available drivers. Persists results to batch_assignments and updates driver
// state in the drivers table.
export async function assignBatches(_req: Request, res: Response) {
  try {
    // 1. Load batch_config for batching + assignment settings
    const { data: cfg } = await supabase
      .from("batch_config")
      .select("max_driver_capacity, max_stops_per_batch, max_allowed_wait, max_distance_km")
      .single();

    const batchCfg = cfg ?? {
      max_driver_capacity: 20,
      max_stops_per_batch: 6,
      max_allowed_wait:    60,
      max_distance_km:     5,
    };

    // 2a. Fetch unassigned batches from previous failed runs (status = "unassigned")
    //     These already have order_details stamped with batch_id, so we need to
    //     reconstruct their AssignmentBatch objects from the DB rather than re-batching.
    const { data: queuedBatches } = await supabase
      .from("batches")
      .select("id, total_volume, stops, created_at")
      .eq("status", "unassigned");

    const queuedBatchIds = (queuedBatches ?? []).map((b) => b.id);
    const { data: queuedDetails } = queuedBatchIds.length > 0
      ? await supabase
          .from("order_details")
          .select("batch_id, order_id, shop_id, product_id, qty, ready_time")
          .in("batch_id", queuedBatchIds)
      : { data: [] as any[] };

    // 2b. Fetch order_details that have NOT been batched yet (batch_id IS NULL)
    const { data: details, error: detErr } = await supabase
      .from("order_details")
      .select("order_id, shop_id, product_id, qty, ready_time")
      .eq("package_status", "pending")
      .is("batch_id", null);

    if (detErr) return res.status(500).json({ ok: false, error: detErr.message });

    // If nothing to process at all, return early
    if (!details?.length && !queuedBatchIds.length) {
      return res.json({ ok: true, assignments: {}, unassigned: [], total_batches: 0, assigned_count: 0, unassigned_count: 0 });
    }

    // Collect all IDs for lookup
    const allDetails = [...(details ?? []), ...(queuedDetails ?? [])];
    const shopIds    = [...new Set(allDetails.map((d) => d.shop_id))];
    const orderIds   = [...new Set(allDetails.map((d) => d.order_id))];
    const productIds = [...new Set(allDetails.map((d) => d.product_id).filter(Boolean))];

    const [{ data: shops }, { data: orders }, { data: products }] = await Promise.all([
      shopIds.length    ? supabase.from("shops").select("shop_id, name, shop_lat, shop_lng, location").in("shop_id", shopIds) : { data: [] as any[] },
      orderIds.length   ? supabase.from("orders").select("id, created_at").in("id", orderIds)                         : { data: [] as any[] },
      productIds.length ? supabase.from("products").select("id, title, capacity_units").in("id", productIds)          : { data: [] as any[] },
    ]);

    const shopMap     = new Map((shops    ?? []).map((s: any) => [s.shop_id, s]));
    const orderMap    = new Map((orders   ?? []).map((o: any) => [o.id, new Date(o.created_at).getTime()]));
    const capacityMap = new Map((products ?? []).map((p: any) => [p.id, (p.capacity_units as number) ?? 3]));

    // 3a. Build AssignmentBatch objects for previously-queued (unassigned) batches
    const nowMs = Date.now();
    const assignmentBatches: AssignmentBatch[] = [];

    if (queuedBatchIds.length > 0) {
      const detailsByBatch = new Map<number, any[]>();
      for (const d of queuedDetails ?? []) {
        if (!detailsByBatch.has(d.batch_id)) detailsByBatch.set(d.batch_id, []);
        detailsByBatch.get(d.batch_id)!.push(d);
      }

      for (const b of queuedBatches ?? []) {
        const rows = detailsByBatch.get(b.id) ?? [];
        const shopSet = new Map<string, { shop_id: string; lat: number; lng: number; ready_time: number; total_volume: number }>();

        for (const d of rows) {
          const shop = shopMap.get(d.shop_id);
          if (!shop?.shop_lat || !shop?.shop_lng) continue;
          const rowTime = d.ready_time
            ? new Date(d.ready_time).getTime()
            : (orderMap.get(d.order_id) ?? nowMs);

          if (!shopSet.has(d.shop_id)) {
            shopSet.set(d.shop_id, { shop_id: d.shop_id, lat: shop.shop_lat, lng: shop.shop_lng, ready_time: rowTime, total_volume: 0 });
          }
          const entry = shopSet.get(d.shop_id)!;
          if (rowTime < entry.ready_time) entry.ready_time = rowTime;
          entry.total_volume += (d.qty ?? 1) * (capacityMap.get(d.product_id) ?? 3);
        }

        assignmentBatches.push({
          id:           String(b.id),
          shops:        Array.from(shopSet.values()),
          order_ids:    [...new Set(rows.map((d: any) => d.order_id as number))],
          total_volume: b.total_volume,
          stops:        b.stops,
          created_at:   new Date(b.created_at).getTime(),
        });
      }
    }

    // 3b. For new unassigned order_details, build shop pickups and create new batches
    if (details?.length) {
      const shopPickupMap = new Map<string, ShopPickup>();

      for (const d of details) {
        const shop = shopMap.get(d.shop_id);
        if (!shop?.shop_lat || !shop?.shop_lng) {
          console.warn(`[assign] skipping shop ${d.shop_id} — missing coordinates`);
          continue;
        }

        const rowTime = d.ready_time
          ? new Date(d.ready_time).getTime()
          : (orderMap.get(d.order_id) ?? nowMs);

        if (!shopPickupMap.has(d.shop_id)) {
          shopPickupMap.set(d.shop_id, {
            shop_id:      d.shop_id,
            shop_name:    shop.name ?? d.shop_id,
            lat:          shop.shop_lat,
            lng:          shop.shop_lng,
            ready_time:   rowTime,
            total_volume: 0,
            order_ids:    [],
            items:        [],
            zone_id:      shop.location ?? undefined,
          });
        }

        const entry = shopPickupMap.get(d.shop_id)!;
        if (rowTime < entry.ready_time) entry.ready_time = rowTime;
        entry.total_volume += (d.qty ?? 1) * (capacityMap.get(d.product_id) ?? 3);
        if (!entry.order_ids.includes(d.order_id)) entry.order_ids.push(d.order_id);
      }

      const rawBatches = await createBatches(Array.from(shopPickupMap.values()), {
        MAX_DRIVER_CAPACITY: batchCfg.max_driver_capacity,
        MAX_STOPS_PER_BATCH: batchCfg.max_stops_per_batch,
        MAX_ALLOWED_WAIT:    batchCfg.max_allowed_wait,
        MAX_DISTANCE_KM:     batchCfg.max_distance_km,
      });

      for (const b of rawBatches) {
        const earliestReady = Math.min(...b.shops.map((s) => s.ready_time));

        const { data: inserted, error: insertErr } = await supabase
          .from("batches")
          .insert({
            created_at:   new Date(earliestReady).toISOString(),
            status:       "pending",
            total_volume: b.total_volume,
            stops:        b.stops,
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          console.error("[assign] failed to insert batch:", insertErr?.message);
          continue;
        }

        assignmentBatches.push({
          id:           String(inserted.id),
          shops:        b.shops.map((s) => ({
            shop_id:      s.shop_id,
            lat:          s.lat,
            lng:          s.lng,
            ready_time:   s.ready_time,
            total_volume: s.total_volume,
          })),
          order_ids:    b.order_ids,
          total_volume: b.total_volume,
          stops:        b.stops,
          created_at:   earliestReady,
        });
      }
    }

    // 4. Fetch available drivers with live state
    const { data: driversData, error: drvErr } = await supabase
      .from("drivers")
      .select("driver_id, current_lat, current_lng, is_available, available_at, remaining_capacity, current_batches")
      .not("current_lat", "is", null)
      .not("current_lng", "is", null);

    if (drvErr) return res.status(500).json({ ok: false, error: drvErr.message });
    if (!driversData?.length) {
      // Mark all batches as unassigned in DB so they appear in retry on next run
      await Promise.all(assignmentBatches.map((b) =>
        supabase.from("batches").update({ status: "unassigned" }).eq("id", parseInt(b.id))
      ));
      return res.json({ ok: true, assignments: {}, unassigned: assignmentBatches.map((b) => b.id), total_batches: assignmentBatches.length, assigned_count: 0, unassigned_count: assignmentBatches.length });
    }

    const drivers: Driver[] = driversData.map((d) => ({
      driver_id:          String(d.driver_id),
      lat:                d.current_lat,
      lng:                d.current_lng,
      available:          d.is_available ?? false,
      available_at:       d.available_at ? new Date(d.available_at).getTime() : nowMs,
      remaining_capacity: d.remaining_capacity ?? batchCfg.max_driver_capacity,
      current_batches:    d.current_batches    ?? 0,
    }));

    // 5. Run assignment algorithm
    const assignmentConfig = {
      MAX_DRIVER_CAPACITY:        batchCfg.max_driver_capacity,
      MAX_DRIVER_BATCHES:         3,
      MAX_ASSIGNMENT_DISTANCE_KM: 10,
      DISTANCE_WEIGHT:            1.0,
      AVAILABILITY_WEIGHT:        0.5,
      LOAD_WEIGHT:                2.0,
      RELAXATION_STEPS: [
        { wait_minutes:  0, max_distance_multiplier: 1.0, allow_future_driver: false },
        { wait_minutes: 15, max_distance_multiplier: 1.5, allow_future_driver: false },
        { wait_minutes: 30, max_distance_multiplier: 2.0, allow_future_driver: true  },
        { wait_minutes: 60, max_distance_multiplier: 3.0, allow_future_driver: true  },
      ],
    };

    const result = assignBatchesToDrivers(assignmentBatches, drivers, assignmentConfig);

    // 6. Persist results:
    //    a) stamp order_details with batch_id + assigned_driver_id
    //    b) update batches.assigned_driver_id + batches.status
    for (const batch of assignmentBatches) {
      const dbBatchId  = parseInt(batch.id);
      const driverIdStr = result.assignments[batch.id];
      const driverId    = driverIdStr ? parseInt(driverIdStr) : null;
      const shopIds     = batch.shops.map((s) => s.shop_id);
      const batchStatus = driverId ? "assigned" : "unassigned";

      // 6a. Stamp order_details rows with batch_id (and driver if assigned)
      const updatePayload: Record<string, unknown> = { batch_id: dbBatchId };
      if (driverId) updatePayload.assigned_driver_id = driverId;

      const { error: odErr } = await supabase
        .from("order_details")
        .update(updatePayload)
        .in("shop_id",  shopIds)
        .in("order_id", batch.order_ids)
        .eq("package_status", "pending");

      if (odErr) console.error(`[assign] order_details update failed for batch ${dbBatchId}:`, odErr.message);

      // 6b. Update the batches row with assignment result
      const { error: batchErr } = await supabase
        .from("batches")
        .update({ assigned_driver_id: driverId, status: batchStatus })
        .eq("id", dbBatchId);

      if (batchErr) console.error(`[assign] batches update failed for ${dbBatchId}:`, batchErr.message);
    }

    // 7. Update driver state in DB (capacity + current_batches)
    for (const updated of result.updated_drivers) {
      const original = drivers.find((d) => d.driver_id === updated.driver_id);
      if (!original) continue;

      // Only write rows that actually changed
      const changed =
        updated.remaining_capacity !== original.remaining_capacity ||
        updated.current_batches    !== original.current_batches;

      if (changed) {
        await supabase
          .from("drivers")
          .update({
            remaining_capacity: updated.remaining_capacity,
            current_batches:    updated.current_batches,
          })
          .eq("driver_id", parseInt(updated.driver_id));
      }
    }

    // Build index-based assignment map so the frontend can look up by "batch-{idx}"
    const indexedAssignments: Record<string, string> = {};
    assignmentBatches.forEach((batch, idx) => {
      const driverId = result.assignments[batch.id];
      if (driverId) indexedAssignments[`batch-${idx}`] = driverId;
    });

    return res.json({
      ok:          true,
      assignments: indexedAssignments,
      unassigned:  result.unassigned_batches.map((b) => b.id),
      total_batches:   assignmentBatches.length,
      assigned_count:  Object.keys(indexedAssignments).length,
      unassigned_count: result.unassigned_batches.length,
    });

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
