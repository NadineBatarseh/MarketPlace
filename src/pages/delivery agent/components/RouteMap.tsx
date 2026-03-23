/**
 * RESPONSIBILITY: Reusable Google Maps component.
 * Shows numbered stop markers and draws the actual road polyline.
 * Falls back to straight-line markers if polyline is unavailable.
 */

import { useEffect, useRef, useState } from "react";

export interface MapStop {
  lat: number;
  lng: number;
  label: string;
  type: "driver" | "shop" | "hub" | "customer";
}

interface RouteMapProps {
  stops: MapStop[];
  encodedPolyline?: string | null;
  height?: number;
}

const STOP_COLOR: Record<string, string> = {
  driver:   "#2196F3",
  shop:     "#FF9800",
  hub:      "#9C27B0",
  customer: "#F44336",
};

const STOP_ICON: Record<string, string> = {
  driver:   "📍",
  shop:     "🏪",
  hub:      "🏭",
  customer: "🏠",
};

function decodePolyline(encoded: string): google.maps.LatLngLiteral[] {
  let index = 0;
  const path: google.maps.LatLngLiteral[] = [];
  let lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    path.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return path;
}

export default function RouteMap({ stops, encodedPolyline, height = 320 }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(!!(window as any).google?.maps);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  // Load Google Maps JS API once
  useEffect(() => {
    if (!apiKey || (window as any).google?.maps) { setLoaded(true); return; }
    const id = "gmap-script";
    if (document.getElementById(id)) {
      document.getElementById(id)!.addEventListener("load", () => setLoaded(true));
      return;
    }
    const s = document.createElement("script");
    s.id = id;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    s.onload = () => setLoaded(true);
    document.head.appendChild(s);
  }, [apiKey]);

  // Render map whenever stops or polyline change
  useEffect(() => {
    if (!loaded || !mapRef.current || !stops.length) return;
    const G = (window as any).google.maps;

    const map = new G.Map(mapRef.current, {
      zoom: 13,
      center: { lat: stops[0].lat, lng: stops[0].lng },
      mapTypeControl: false,
      fullscreenControl: true,
      streetViewControl: false,
      zoomControl: true,
    });

    // Draw polyline (real road route)
    if (encodedPolyline) {
      new G.Polyline({
        path: decodePolyline(encodedPolyline),
        map,
        strokeColor: "#1565C0",
        strokeWeight: 5,
        strokeOpacity: 0.85,
      });
    } else {
      // Fallback: straight dashed lines between stops
      new G.Polyline({
        path: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
        map,
        strokeColor: "#9E9E9E",
        strokeWeight: 3,
        strokeOpacity: 0.6,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "16px" }],
      });
    }

    // Add numbered markers
    stops.forEach((stop, i) => {
      new G.Marker({
        position: { lat: stop.lat, lng: stop.lng },
        map,
        label: {
          text: i === 0 ? "●" : String(i),
          color: "#fff",
          fontWeight: "bold",
          fontSize: "13px",
        },
        icon: {
          path: G.SymbolPath.CIRCLE,
          scale: 18,
          fillColor: STOP_COLOR[stop.type],
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: stop.label,
        zIndex: stops.length - i,
      });
    });

    // Fit all stops in view
    if (stops.length > 1) {
      const bounds = new G.LatLngBounds();
      stops.forEach((s) => bounds.extend({ lat: s.lat, lng: s.lng }));
      map.fitBounds(bounds, 50);
    }
  }, [loaded, stops, encodedPolyline]);

  if (!apiKey) {
    return (
      <div style={{ height, background: "#f5f5f5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 12, border: "2px dashed #ccc", gap: 8 }}>
        <span style={{ fontSize: 32 }}>🗺️</span>
        <p style={{ color: "#999", fontSize: 13, margin: 0 }}>أضف VITE_GOOGLE_MAPS_API_KEY في ملف .env لعرض الخريطة</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ height, background: "#e8f0fe", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12 }}>
        <p style={{ color: "#1565C0", fontSize: 14 }}>⏳ جارٍ تحميل الخريطة...</p>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e0e0e0", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      <div ref={mapRef} style={{ height, width: "100%" }} />
      {/* Legend */}
      <div style={{ background: "#f8f9fa", padding: "8px 14px", display: "flex", gap: 12, flexWrap: "wrap", borderTop: "1px solid #eee", direction: "rtl" }}>
        {stops.map((s, i) => (
          <span key={i} style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: STOP_COLOR[s.type], display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
              {i === 0 ? "●" : i}
            </span>
            <span>{STOP_ICON[s.type]} {s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
