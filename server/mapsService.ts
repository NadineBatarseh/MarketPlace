/**
 * RESPONSIBILITY: All Google Routes API interactions.
 * Single entry point for any map/routing computation.
 */
import "dotenv/config";

const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteStop {
  orderId: string;
  location: LatLng;
  type: "pickup" | "delivery";
  label: string;
}

export interface OptimizedRoute {
  optimizedOrder: number[];       // Indices of intermediates in optimized order
  encodedPolyline: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

export async function computeOptimizedRoute(
  origin: LatLng,
  destination: LatLng,
  intermediates: RouteStop[]
): Promise<OptimizedRoute> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not set in .env");

  const body = {
    origin:      { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    intermediates: intermediates.map((wp) => ({
      location: { latLng: wp.location },
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
    optimizedOrder:        route.optimizedIntermediateWaypointIndex ?? [],
    encodedPolyline:       route.polyline?.encodedPolyline ?? "",
    totalDistanceMeters:   route.distanceMeters ?? 0,
    totalDurationSeconds:  parseInt(route.duration?.replace("s", "") ?? "0"),
  };
}
