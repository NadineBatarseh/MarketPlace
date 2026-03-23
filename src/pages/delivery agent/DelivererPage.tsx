/**
 * RESPONSIBILITY: Last-Mile interface — Deliverer.
 *
 * Shows only consolidated orders (all packages merged at Hub).
 * Full customer details: name, phone, map location, COD amount.
 * Actions: Start Delivery → Confirm Delivery.
 */

import { useState, useEffect, useCallback } from "react";
import RouteMap, { type MapStop } from "./components/RouteMap";
import Topbar from "../../components/Topbar";

interface RouteData {
  stops: MapStop[];
  encodedPolyline: string | null;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

interface DeliveryOrder {
  id: number;
  display_id: string;
  status: "consolidated" | "delivering";
  customer_name: string;
  customer_phone: string | null;
  delivery_lat: number;
  delivery_lng: number;
  total_price: number;
  packages: string[];
}

export default function DelivererPage() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/delivery");
      const json = await res.json();
      if (json.ok) setOrders(json.orders);
      else setError(json.error ?? "خطأ في تحميل الطلبات");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  };

  const loadRoute = useCallback(() => {
    setRouteLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/logistics/deliverer/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driverLat: pos.coords.latitude, driverLng: pos.coords.longitude }),
          });
          const json = await res.json();
          if (json.ok) setRoute(json);
          else setError(json.error ?? "فشل حساب المسار");
        } catch {
          setError("تعذر الاتصال بالخادم لحساب المسار");
        } finally {
          setRouteLoading(false);
        }
      },
      () => { setError("تعذر الحصول على موقعك — تأكد من تفعيل الموقع الجغرافي"); setRouteLoading(false); }
    );
  }, []);

  useEffect(() => {
    load();
    loadRoute();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const startDelivery = async (orderId: number) => {
    setActionId(orderId);
    try {
      const res = await fetch("/api/logistics/delivery/start", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.ok) load();
      else setError(json.error ?? "خطأ");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setActionId(null);
    }
  };

  const completeDelivery = async (orderId: number) => {
    setActionId(orderId);
    try {
      const res = await fetch("/api/logistics/delivery/complete", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.ok) load();
      else setError(json.error ?? "خطأ");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setActionId(null);
    }
  };

  const delivering = orders.filter((o) => o.status === "delivering");
  const ready = orders.filter((o) => o.status === "consolidated");

  return (
    <div style={s.page} dir="rtl">
      <Topbar />
      {/* Header */}
      <header style={s.header}>
        <div>
          <h1 style={s.title}>📦 المُوصِّل — الميل الأخير</h1>
          <p style={s.subtitle}>توصيل الطرود المدموجة من المركز إلى العملاء</p>
        </div>
        <button onClick={load} style={s.refreshBtn}>↻ تحديث</button>
      </header>

      {error && <div style={s.errorBanner}>{error}</div>}

      {/* Route Map */}
      <div style={s.mapSection}>
        {routeLoading ? (
          <div style={s.mapPlaceholder}>⏳ جارٍ حساب أقصر مسار للتوصيل...</div>
        ) : route && route.stops.length > 0 ? (
          <>
            <RouteMap stops={route.stops} encodedPolyline={route.encodedPolyline} height={280} />
            <div style={s.routeSummary}>
              <span>📏 {(route.totalDistanceMeters / 1000).toFixed(1)} كم</span>
              <span>⏱ {Math.round(route.totalDurationSeconds / 60)} دقيقة</span>
              <button onClick={loadRoute} style={s.reloadBtn}>↻ تحديث</button>
            </div>
            {route.stops.length >= 2 && (
              <a
                href={`https://www.google.com/maps/dir/${route.stops.map((s) => `${s.lat},${s.lng}`).join("/")}`}
                target="_blank"
                rel="noreferrer"
                style={s.gmapsBtn}
              >
                🗺 افتح الرحلة الكاملة في خرائط Google
              </a>
            )}
          </>
        ) : (
          <div style={s.mapPlaceholder}>
            <button onClick={loadRoute} style={s.reloadBtn}>احسب مسار التوصيل</button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={s.center}><p>جارٍ تحميل الطلبات...</p></div>
      ) : (
        <div style={s.content}>
          {/* Active deliveries */}
          {delivering.length > 0 && (
            <section>
              <h2 style={s.sectionTitle}>🚴 قيد التوصيل ({delivering.length})</h2>
              {delivering.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  actionId={actionId}
                  phase="delivering"
                  onComplete={completeDelivery}
                />
              ))}
            </section>
          )}

          {/* Ready orders */}
          {ready.length > 0 && (
            <section style={{ marginTop: delivering.length > 0 ? 24 : 0 }}>
              <h2 style={s.sectionTitle}>✅ جاهز للتوصيل ({ready.length})</h2>
              {ready.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  actionId={actionId}
                  phase="ready"
                  onStart={startDelivery}
                  onComplete={completeDelivery}
                />
              ))}
            </section>
          )}

          {delivering.length === 0 && ready.length === 0 && (
            <div style={s.empty}>
              <div style={{ fontSize: 48 }}>⏳</div>
              <p>لا توجد طلبات جاهزة للتوصيل</p>
              <p style={{ fontSize: 13, color: "#aaa" }}>
                انتظر حتى تُدمج الطرود في نقطة التجميع
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  actionId,
  phase,
  onStart,
  onComplete,
}: {
  order: DeliveryOrder;
  actionId: number | null;
  phase: "ready" | "delivering";
  onStart?: (id: number) => void;
  onComplete: (id: number) => void;
}) {
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${order.delivery_lat},${order.delivery_lng}`;
  const waze = `https://waze.com/ul?ll=${order.delivery_lat},${order.delivery_lng}&navigate=yes`;

  return (
    <div style={s.card}>
      {/* Card header */}
      <div style={s.cardHead}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={s.orderId}>{order.display_id}</span>
          <span
            style={{
              ...s.badge,
              background: phase === "delivering" ? "#e67e22" : "#27ae60",
            }}
          >
            {phase === "delivering" ? "🚴 قيد التوصيل" : "✅ جاهز"}
          </span>
        </div>
        <div style={s.cod}>
          <span style={s.codAmount}>{order.total_price}</span>
          <span style={s.codCurrency}> ₪ نقداً</span>
        </div>
      </div>

      {/* Customer info */}
      <div style={s.customerSection}>
        <Row icon="👤" label="العميل" value={order.customer_name} />
        {order.customer_phone && (
          <Row
            icon="📞"
            label="الهاتف"
            value={order.customer_phone}
            link={`tel:${order.customer_phone}`}
          />
        )}
        <div style={s.row}>
          <span style={s.rowIcon}>📦</span>
          <span style={s.rowLabel}>الطرود</span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {order.packages.map((p) => (
              <span key={p} style={s.pkgTag}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div style={s.navRow}>
        <a href={gmaps} target="_blank" rel="noreferrer" style={s.googleBtn}>
          🗺 Google Maps
        </a>
        <a href={waze} target="_blank" rel="noreferrer" style={s.wazeBtn}>
          📍 Waze
        </a>
      </div>

      {/* Actions */}
      <div style={s.actions}>
        {phase === "ready" && onStart && (
          <button
            onClick={() => onStart(order.id)}
            disabled={actionId === order.id}
            style={s.startBtn}
          >
            {actionId === order.id ? "جارٍ..." : "🚴 ابدأ التوصيل"}
          </button>
        )}
        {phase === "delivering" && (
          <button
            onClick={() => onComplete(order.id)}
            disabled={actionId === order.id}
            style={s.completeBtn}
          >
            {actionId === order.id ? "جارٍ..." : "✅ تأكيد التسليم"}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  link,
}: {
  icon: string;
  label: string;
  value: string;
  link?: string;
}) {
  return (
    <div style={s.row}>
      <span style={s.rowIcon}>{icon}</span>
      <span style={s.rowLabel}>{label}</span>
      {link ? (
        <a href={link} style={{ ...s.rowValue, color: "#2980b9", textDecoration: "none" }}>
          {value}
        </a>
      ) : (
        <span style={s.rowValue}>{value}</span>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif",
    paddingBottom: 40,
  },
  header: {
    background: "#1a1a2e",
    color: "#fff",
    padding: "5px 5px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: { margin: 0, fontSize: 20 },
  subtitle: { margin: "4px 0 0", fontSize: 13, opacity: 0.65 },
  refreshBtn: {
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    padding: "7px 16px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
  },
  errorBanner: {
    background: "#fde8e8",
    color: "#c0392b",
    padding: "10px 20px",
    margin: "12px 16px",
    borderRadius: 8,
    fontSize: 14,
  },
  center: { textAlign: "center", marginTop: 60, color: "#666" },
  content: { padding: 16 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#333",
    marginBottom: 12,
    marginTop: 0,
  },
  empty: { textAlign: "center", marginTop: 80, color: "#666", fontSize: 18 },
  card: {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
    marginBottom: 16,
    overflow: "hidden",
  },
  cardHead: {
    background: "#f8f9fa",
    borderBottom: "1px solid #eee",
    padding: "13px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderId: {
    fontFamily: "monospace",
    fontWeight: 700,
    fontSize: 19,
    color: "#1a1a2e",
  },
  badge: {
    color: "#fff",
    padding: "3px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  },
  cod: { display: "flex", alignItems: "baseline" },
  codAmount: { fontSize: 24, fontWeight: 800, color: "#27ae60" },
  codCurrency: { fontSize: 13, color: "#555", marginRight: 2 },
  customerSection: {
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  row: { display: "flex", alignItems: "center", gap: 8 },
  rowIcon: { fontSize: 16, minWidth: 22 },
  rowLabel: { color: "#888", fontSize: 13, minWidth: 60 },
  rowValue: { fontSize: 15, fontWeight: 600, color: "#1a1a2e" },
  pkgTag: {
    background: "#1a1a2e",
    color: "#fff",
    padding: "2px 8px",
    borderRadius: 6,
    fontFamily: "monospace",
    fontSize: 12,
  },
  navRow: {
    display: "flex",
    gap: 8,
    padding: "10px 16px",
    borderTop: "1px solid #f0f0f0",
  },
  googleBtn: {
    flex: 1,
    background: "#4285f4",
    color: "#fff",
    padding: "9px 0",
    borderRadius: 8,
    textDecoration: "none",
    textAlign: "center" as const,
    fontSize: 13,
    fontWeight: 600,
  },
  wazeBtn: {
    flex: 1,
    background: "#00bcd4",
    color: "#fff",
    padding: "9px 0",
    borderRadius: 8,
    textDecoration: "none",
    textAlign: "center" as const,
    fontSize: 13,
    fontWeight: 600,
  },
  actions: {
    padding: "12px 16px",
    borderTop: "1px solid #f0f0f0",
  },
  startBtn: {
    width: "100%",
    background: "#e67e22",
    color: "#fff",
    border: "none",
    padding: "13px",
    borderRadius: 9,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
  },
  completeBtn: {
    width: "100%",
    background: "#27ae60",
    color: "#fff",
    border: "none",
    padding: "13px",
    borderRadius: 9,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
  },
  mapSection: { margin: "14px 16px 0" },
  mapPlaceholder: {
    height: 80,
    background: "#f0f4ff",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    color: "#555",
    fontSize: 14,
    border: "2px dashed #c5cae9",
  },
  routeSummary: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "8px 4px",
    fontSize: 14,
    color: "#444",
    flexWrap: "wrap" as const,
  },
  reloadBtn: {
    marginRight: "auto",
    background: "#1565C0",
    color: "#fff",
    border: "none",
    padding: "5px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
  },
  gmapsBtn: {
    display: "block",
    background: "#4285f4",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: 9,
    textDecoration: "none",
    textAlign: "center" as const,
    fontSize: 14,
    fontWeight: 600,
    marginTop: 8,
  },
};
