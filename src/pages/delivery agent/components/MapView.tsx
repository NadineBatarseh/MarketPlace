/**
 * RESPONSIBILITY: Render Google Map with two route polylines and all markers.
 *
 * Collection phase (Driver → Shops → Hub): blue polyline
 * Delivery phase  (Hub → Customer):        orange polyline
 */
import { useEffect, useRef } from "react";
import type { ShopStop } from "../api";

interface MapViewProps {
  driverLat: number;
  driverLng: number;
  hub: { latitude: number; longitude: number };
  shopStops: ShopStop[];
  customer: { latitude: number; longitude: number };
  collectionPolyline: string;
  deliveryPolyline: string;
}

declare global {
  interface Window { google: any; }
}

function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export default function MapView({
  driverLat, driverLng, hub, shopStops, customer,
  collectionPolyline, deliveryPolyline,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;

    function initMap() {
      if (!mapRef.current) return;

      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: driverLat, lng: driverLng },
        zoom: 12,
      });

      // Driver — blue dot
      new window.google.maps.Marker({
        position: { lat: driverLat, lng: driverLng },
        map,
        title: "موقع المندوب",
        icon: { url: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png" },
        zIndex: 10,
      });

      // Shop stops — green, numbered
      shopStops.forEach((stop, i) => {
        new window.google.maps.Marker({
          position: { lat: stop.location.latitude, lng: stop.location.longitude },
          map,
          label: { text: String(i + 1), color: "white", fontWeight: "bold" },
          title: stop.label,
          icon: { url: "https://maps.google.com/mapfiles/ms/icons/green-dot.png" },
        });
      });

      // Hub — orange star
      new window.google.maps.Marker({
        position: { lat: hub.latitude, lng: hub.longitude },
        map,
        title: "نقطة التجميع (Hub)",
        icon: { url: "https://maps.google.com/mapfiles/ms/icons/orange-dot.png" },
        zIndex: 10,
      });

      // Customer — red dot
      new window.google.maps.Marker({
        position: { lat: customer.latitude, lng: customer.longitude },
        map,
        title: "موقع العميل",
        icon: { url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png" },
        zIndex: 10,
      });

      // Collection polyline — blue
      if (collectionPolyline) {
        new window.google.maps.Polyline({
          path: decodePolyline(collectionPolyline),
          map,
          strokeColor: "#4F46E5",
          strokeWeight: 4,
          strokeOpacity: 0.85,
        });
      }

      // Delivery polyline — orange
      if (deliveryPolyline) {
        new window.google.maps.Polyline({
          path: decodePolyline(deliveryPolyline),
          map,
          strokeColor: "#F97316",
          strokeWeight: 4,
          strokeOpacity: 0.85,
        });
      }
    }

    if (window.google?.maps) { initMap(); return; }

    if (document.getElementById("gmaps-script")) {
      const iv = setInterval(() => {
        if (window.google?.maps) { clearInterval(iv); initMap(); }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.id = "gmaps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }, [driverLat, driverLng, hub, shopStops, customer, collectionPolyline, deliveryPolyline]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapRef} style={{ width: "100%", height: "420px", borderRadius: "12px", background: "#e5e7eb" }} />
      {/* Legend */}
      <div style={{
        position: "absolute", bottom: "12px", right: "12px",
        background: "white", borderRadius: "8px", padding: "8px 12px",
        boxShadow: "0 2px 8px rgba(0,0,0,.15)", fontSize: "12px", direction: "rtl",
        display: "flex", flexDirection: "column", gap: "4px",
      }}>
        <LegendItem color="#4F46E5" label="مرحلة الاستلام (مندوب → متاجر → Hub)" />
        <LegendItem color="#F97316" label="مرحلة التوصيل (Hub → العميل)" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ width: "20px", height: "4px", borderRadius: "2px", background: color }} />
      <span style={{ color: "#374151" }}>{label}</span>
    </div>
  );
}
