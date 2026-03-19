/**
 * RESPONSIBILITY: Main Delivery Agent UI.
 *
 * Workflow:
 *   1. Select driver
 *   2. Select a pending order (shows hub + uncollected shop count)
 *   3. Optimize → Phase 1 (Shops → Hub) + Phase 2 (Hub → Customer)
 */
import { useState, useEffect } from "react";
import Topbar from "../../components/Topbar";
import {
  fetchDrivers,
  fetchOrders,
  optimizeCartRoute,
  type DriverRow,
  type OrderRow,
  type CartOptimizeResult,
} from "./api";
import MapView from "./components/MapView";
import OrderList from "./components/OrderList";

const STATUS_LABELS: Record<string, string> = {
  pending_collection: "بانتظار الاستلام",
  at_hub:             "في نقطة التجميع",
  delivering:         "قيد التوصيل",
  completed:          "مكتمل",
};

export default function DeliveryAgentPage() {
  const [drivers, setDrivers]               = useState<DriverRow[]>([]);
  const [orders, setOrders]                 = useState<OrderRow[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<DriverRow | null>(null);
  const [selectedOrder, setSelectedOrder]   = useState<OrderRow | null>(null);
  const [result, setResult]                 = useState<CartOptimizeResult | null>(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  useEffect(() => {
    fetchDrivers().then(setDrivers).catch((e) => setError(e.message));
    fetchOrders().then(setOrders).catch((e) => setError(e.message));
  }, []);

  async function handleOptimize() {
    if (!selectedDriver) return setError("اختر مندوباً أولاً");
    if (!selectedOrder)  return setError("اختر طلباً أولاً");
    setError(null);
    setLoading(true);
    try {
      const data = await optimizeCartRoute(
        selectedDriver.current_lat,
        selectedDriver.current_lng,
        selectedOrder.id
      );
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif", direction: "rtl" }}>
      <Topbar />

      <h1 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "4px", color: "#111827" }}>
        واجهة المندوب
      </h1>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "24px" }}>
        متاجر متعددة ← نقطة تجميع ← العميل
      </p>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b" }}>
          {error}
        </div>
      )}

      {/* ── Driver selector ── */}
      <section style={{ marginBottom: "24px" }}>
        <SectionTitle>اختر المندوب</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {drivers.length === 0 && <Empty>لا يوجد مندوبون متاحون</Empty>}
          {drivers.map((d) => (
            <button
              key={d.driver_id}
              onClick={() => { setSelectedDriver(d); setResult(null); }}
              style={chipStyle(selectedDriver?.driver_id === d.driver_id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      </section>

      {/* ── Order selector ── */}
      <section style={{ marginBottom: "24px" }}>
        <SectionTitle>اختر الطلب</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {orders.length === 0 && <Empty>لا توجد طلبات معلقة</Empty>}
          {orders.map((order) => {
            const selected = selectedOrder?.id === order.id;
            return (
              <div
                key={order.id}
                onClick={() => { setSelectedOrder(order); setResult(null); }}
                style={{
                  padding: "14px 16px", borderRadius: "10px", cursor: "pointer",
                  border: `2px solid ${selected ? "#4f46e5" : "#e5e7eb"}`,
                  background: selected ? "#eef2ff" : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: "#111827" }}>
                      طلب #{order.id}
                    </div>
                    {order.hub && (
                      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "3px" }}>
                        ⬡ نقطة التجميع: {order.hub.name}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                    <StatusBadge status={order.status} />
                    {order.uncollected_shops > 0 && (
                      <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: "#fef9c3", color: "#854d0e" }}>
                        {order.uncollected_shops} متجر لم يُستلم
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Optimize button ── */}
      <button
        onClick={handleOptimize}
        disabled={loading}
        style={{
          width: "100%", padding: "13px", borderRadius: "10px",
          background: loading ? "#a5b4fc" : "#4f46e5",
          color: "white", border: "none", fontSize: "15px",
          fontWeight: "600", cursor: loading ? "not-allowed" : "pointer",
          marginBottom: "28px",
        }}
      >
        {loading ? "جاري حساب المسار..." : "تحسين المسار"}
      </button>

      {/* ── Result ── */}
      {result && selectedDriver && (
        <>
          <section style={{ marginBottom: "24px" }}>
            <SectionTitle>الخريطة</SectionTitle>
            <MapView
              driverLat={selectedDriver.current_lat}
              driverLng={selectedDriver.current_lng}
              hub={result.hub}
              shopStops={result.collection.stops}
              customer={result.delivery.customer}
              collectionPolyline={result.collection.encodedPolyline}
              deliveryPolyline={result.delivery.encodedPolyline}
            />
          </section>

          <section>
            <SectionTitle>خطة الرحلة</SectionTitle>
            <OrderList result={result} />
          </section>
        </>
      )}
    </div>
  );
}

/* ── Helpers ── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#374151", marginBottom: "10px" }}>{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "#9ca3af", fontSize: "14px" }}>{children}</p>;
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 18px", borderRadius: "8px", cursor: "pointer",
    border: `2px solid ${active ? "#4f46e5" : "#e5e7eb"}`,
    background: active ? "#eef2ff" : "white",
    fontSize: "14px", fontWeight: "500", color: "#111827",
  };
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    pending_collection: { bg: "#fef9c3", text: "#854d0e" },
    at_hub:             { bg: "#dbeafe", text: "#1e40af" },
    delivering:         { bg: "#dcfce7", text: "#166534" },
    completed:          { bg: "#f3f4f6", text: "#374151" },
  };
  const { bg, text } = colors[status] ?? { bg: "#f3f4f6", text: "#374151" };
  return (
    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "99px", background: bg, color: text, fontWeight: "600" }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
