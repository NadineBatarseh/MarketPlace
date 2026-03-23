/**
 * RESPONSIBILITY: Google Routes API v2 interactions.
 * Single entry point for all map/routing computation.
 *
 * Two exported functions:
 *  - computeOptimizedRoute  → Phase 1 (Driver → Shops → Hub): reorders waypoints
 *  - computeDirectRoute     → Phase 2 (Hub → Customer):  no waypoints, fastest path
 */
import "dotenv/config";

const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteStop {
  shopId: string;
  location: LatLng;
  label: string;
}

/** Returned by computeOptimizedRoute (collection phase) */
export interface CollectionRoute {
  /** Indices of shops array in the optimized visit order */
  optimizedOrder: number[];
  encodedPolyline: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

/** Returned by computeDirectRoute (delivery phase) */
export interface DeliveryRoute {
  encodedPolyline: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

/** ----------------------------------------------------------------
 *  Phase 1 — Driver → Shops (optimized) → Hub
 *  Uses optimizeWaypointOrder so Google reorders the shops.
 * ---------------------------------------------------------------- */
export async function computeOptimizedRoute(
  origin: LatLng,        // driver location
  destination: LatLng,   // hub location
  shopStops: RouteStop[]
): Promise<CollectionRoute> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not set in .env");

  const body = {
    origin:      { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    intermediates: shopStops.map((s) => ({
      location: { latLng: s.location },
    })),
    travelMode: "DRIVE",
    optimizeWaypointOrder: true,
    routingPreference: "TRAFFIC_AWARE",
  };

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "routes.optimizedIntermediateWaypointIndex",
        "routes.polyline.encodedPolyline",
        "routes.distanceMeters",
        "routes.duration",
      ].join(","),
    },
    body: JSON.stringify(body),
  });

  const data: any = await response.json();
  if (!response.ok || !data.routes?.length) {
    throw new Error(data.error?.message ?? "Google Routes API returned no routes");
  }

  const route = data.routes[0];
  return {
    optimizedOrder:       route.optimizedIntermediateWaypointIndex ?? [],
    encodedPolyline:      route.polyline?.encodedPolyline ?? "",
    totalDistanceMeters:  route.distanceMeters ?? 0,
    totalDurationSeconds: parseInt(route.duration?.replace("s", "") ?? "0"),
  };
}

/** ----------------------------------------------------------------
 *  Phase 2 — Hub → Customer (direct, no intermediate stops)
 * ---------------------------------------------------------------- */
export async function computeDirectRoute(
  origin: LatLng,       // hub location
  destination: LatLng   // customer location
): Promise<DeliveryRoute> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not set in .env");

  const body = {
    origin:      { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "routes.polyline.encodedPolyline",
        "routes.distanceMeters",
        "routes.duration",
      ].join(","),
    },
    body: JSON.stringify(body),
  });

  const data: any = await response.json();
  if (!response.ok || !data.routes?.length) {
    throw new Error(data.error?.message ?? "Google Routes API returned no routes");
  }

  const route = data.routes[0];
  return {
    encodedPolyline:      route.polyline?.encodedPolyline ?? "",
    totalDistanceMeters:  route.distanceMeters ?? 0,
    totalDurationSeconds: parseInt(route.duration?.replace("s", "") ?? "0"),
  };
}
