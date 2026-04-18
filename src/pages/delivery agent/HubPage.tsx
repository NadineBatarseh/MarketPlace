/**
 * RESPONSIBILITY: Hub Management interface — Organizer.
 *
 * - Consolidation board: groups incoming packages by Main Order.
 * - Progress tracker: "2 of 3 packages at hub".
 * - Ready alert when all sub-packages have arrived.
 * - "Generate Final Label" button → marks order as consolidated, shows label.
 */

import { useState, useEffect } from "react";
import Topbar from "../../components/Topbar";
import { insertTrackingEvent } from "../../lib/trackingEvents";

interface HubPackage {
  id: string;      // PKG-001
  raw_id: number;
  status: "pending" | "picked_up" | "at_hub";
}

interface HubOrder {
  id: number;
  display_id: string;
  status: string;
  total_price: number;
  created_at: string;
  packages_total: number;
  packages_at_hub: number;
  packages: HubPackage[];
  is_ready: boolean;
}

interface FinalLabel {
  order_id: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_lat: number;
  delivery_lng: number;
  total_price: number;
  packages: string[];
}

export default function HubPage() {
  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [receiving, setReceiving] = useState<number | null>(null);
  const [consolidating, setConsolidating] = useState<number | null>(null);
  const [label, setLabel] = useState<FinalLabel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/hub");
      const json = await res.json();
      if (json.ok) setOrders(json.orders);
      else setError(json.error ?? "خطأ في تحميل البيانات");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const receivePackage = async (rawPkgId: number) => {
    setReceiving(rawPkgId);
    setError(null);
    try {
      const res = await fetch("/api/logistics/hub/receive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawPackageId: rawPkgId }),
      });
      const json = await res.json();
      if (json.ok) {
        // Find which order this package belongs to
        const parentOrder = orders.find(o => o.packages.some(p => p.raw_id === rawPkgId));
        if (parentOrder) {
          // Only insert arrived_hub event once — when the first package arrives
          const wasEmpty = parentOrder.packages_at_hub === 0;
          if (wasEmpty) {
            await insertTrackingEvent(parentOrder.id, 'arrived_hub', 'موظف المستودع', {
              location: 'مستودع رام الله',
              note:     'وصل أول طرد إلى المستودع',
            });
          }
        }
        load();
      } else {
        setError(json.error ?? "خطأ في تسجيل الوصول");
      }
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setReceiving(null);
    }
  };

  const consolidate = async (orderId: number) => {
    setConsolidating(orderId);
    setError(null);
    try {
      const res = await fetch("/api/logistics/hub/consolidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.ok) {
        // All packages collected and packed — insert packing event
        await insertTrackingEvent(orderId, 'packing', 'فريق التعبئة', {
          location: 'مستودع رام الله',
          note:     'تمت التعبئة والتغليف وإنشاء بطاقة التوصيل',
        });
        setLabel(json.label);
        load();
      } else {
        setError(json.error ?? "خطأ في دمج الطلب");
      }
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setConsolidating(null);
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "pending_collection": return "#e67e22";
      case "at_hub": return "#2980b9";
      case "consolidated": return "#27ae60";
      default: return "#95a5a6";
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "pending_collection": return "ينتظر الوصول";
      case "at_hub": return "في المركز";
      case "consolidated": return "مدموج ✓";
      default: return s;
    }
  };

  const pkgStatusBg = (s: string) => {
    switch (s) {
      case "at_hub": return "#e8f5e9";
      case "picked_up": return "#fff3e0";
      default: return "#fafafa";
    }
  };

  return (
    <div style={st.page} dir="rtl">
      <Topbar />
      {/* Header */}
      <header style={st.header}>
        <div>
          <h1 style={st.title}>🏭 نقطة التجميع — المنظِّم</h1>
          <p style={st.subtitle}>استقبال الطرود الواردة ودمجها لإعدادها للتوصيل النهائي</p>
        </div>
        <button onClick={load} style={st.refreshBtn}>↻ تحديث</button>
      </header>

      {error && <div style={st.errorBanner}>{error}</div>}

      {/* Final Label Modal */}
      {label && (
        <div style={st.overlay}>
          <div style={st.modal}>
            <h2 style={{ marginTop: 0, textAlign: "right" }}>🏷️ بطاقة التوصيل النهائية</h2>
            <div style={st.labelBody}>
              <LabelRow label="رقم الطلب" value={label.order_id} mono />
              <LabelRow label="العميل" value={label.customer_name} />
              <LabelRow label="الهاتف" value={label.customer_phone ?? "غير متوفر"} />
              <LabelRow label="المبلغ (COD)" value={`${label.total_price} ₪`} />
              <div style={st.labelRow}>
                <b style={st.labelKey}>الطرود:</b>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {label.packages.map((p) => (
                    <span key={p} style={st.pkgTag}>{p}</span>
                  ))}
                </div>
              </div>
              {label.delivery_lat && label.delivery_lng && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${label.delivery_lat},${label.delivery_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={st.mapLink}
                >
                  🗺 فتح موقع التوصيل
                </a>
              )}
            </div>
            <button onClick={() => setLabel(null)} style={st.closeBtn}>
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div style={st.center}><p>جارٍ تحميل لوحة التجميع...</p></div>
      ) : orders.length === 0 ? (
        <div style={st.empty}>
          <div style={{ fontSize: 48 }}>✅</div>
          <p>لا توجد طلبات نشطة في نقطة التجميع</p>
        </div>
      ) : (
        <div style={st.board}>
          {orders.map((order) => (
            <div
              key={order.id}
              style={{ ...st.orderCard, ...(order.is_ready ? st.orderReady : {}) }}
            >
              {/* Order Header */}
              <div style={st.orderHead}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={st.orderId}>{order.display_id}</span>
                  <span
                    style={{
                      ...st.statusBadge,
                      background: statusColor(order.status),
                    }}
                  >
                    {statusLabel(order.status)}
                  </span>
                </div>
                {/* Progress bar */}
                <div style={st.progressRow}>
                  <div style={st.progressTrack}>
                    <div
                      style={{
                        ...st.progressFill,
                        width: `${
                          order.packages_total > 0
                            ? (order.packages_at_hub / order.packages_total) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span style={st.progressText}>
                    {order.packages_at_hub} / {order.packages_total} وصل
                  </span>
                </div>
              </div>

              {/* Package rows */}
              <div style={st.pkgList}>
                {order.packages.map((pkg) => (
                  <div
                    key={pkg.raw_id}
                    style={{
                      ...st.pkgRow,
                      background: pkgStatusBg(pkg.status),
                    }}
                  >
                    <span style={st.pkgId}>{pkg.id}</span>
                    <span style={st.pkgStatusText}>
                      {pkg.status === "at_hub"
                        ? "✔ في المركز"
                        : pkg.status === "picked_up"
                        ? "🚚 في الطريق"
                        : "⏳ لم يُستلم بعد"}
                    </span>
                    {pkg.status !== "at_hub" && (
                      <button
                        onClick={() => receivePackage(pkg.raw_id)}
                        disabled={receiving === pkg.raw_id}
                        style={st.receiveBtn}
                      >
                        {receiving === pkg.raw_id ? "..." : "📦 سجّل الوصول"}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Ready alert */}
              {order.is_ready && (
                <div style={st.readyBanner}>
                  <span style={st.readyText}>
                    🎉 جميع الطرود وصلت — الطلب جاهز للدمج
                  </span>
                  <button
                    onClick={() => consolidate(order.id)}
                    disabled={consolidating === order.id}
                    style={st.consolidateBtn}
                  >
                    {consolidating === order.id ? "جارٍ..." : "🏷️ إنشاء بطاقة التوصيل"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LabelRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={st.labelRow}>
      <b style={st.labelKey}>{label}:</b>
      <span style={{ fontFamily: mono ? "monospace" : "inherit", fontSize: 15 }}>{value}</span>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f0f2f5",
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
    border: "1px solid #f5c6c6",
    fontSize: 14,
  },
  center: { textAlign: "center", marginTop: 60 },
  empty: { textAlign: "center", marginTop: 80, color: "#666", fontSize: 18 },
  board: { padding: 16, display: "flex", flexDirection: "column", gap: 16 },
  orderCard: {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
    overflow: "hidden",
    border: "2px solid transparent",
  },
  orderReady: { border: "2px solid #27ae60" },
  orderHead: {
    background: "#f8f9fa",
    borderBottom: "1px solid #eee",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  orderId: {
    fontFamily: "monospace",
    fontWeight: 700,
    fontSize: 20,
    color: "#1a1a2e",
  },
  statusBadge: {
    color: "#fff",
    padding: "3px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  },
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 8,
    background: "#e0e0e0",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "#27ae60",
    borderRadius: 4,
    transition: "width 0.4s",
  },
  progressText: { fontSize: 13, color: "#666", whiteSpace: "nowrap" },
  pkgList: {
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  pkgRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    border: "1px solid #e8e8e8",
    borderRadius: 10,
    padding: "9px 14px",
  },
  pkgId: {
    fontFamily: "monospace",
    fontWeight: 700,
    fontSize: 16,
    color: "#1a1a2e",
    minWidth: 85,
  },
  pkgStatusText: { flex: 1, fontSize: 13, color: "#555" },
  receiveBtn: {
    background: "#2980b9",
    color: "#fff",
    border: "none",
    padding: "5px 14px",
    borderRadius: 7,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  readyBanner: {
    background: "#eafaf1",
    borderTop: "1px solid #a9dfbf",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
  },
  readyText: { color: "#1e8449", fontWeight: 600, fontSize: 14 },
  consolidateBtn: {
    background: "#27ae60",
    color: "#fff",
    border: "none",
    padding: "9px 20px",
    borderRadius: 9,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
  },
  // Modal
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    padding: 16,
  },
  modal: {
    background: "#fff",
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 440,
    boxShadow: "0 12px 50px rgba(0,0,0,0.25)",
    direction: "rtl",
  },
  labelBody: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 },
  labelRow: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    borderBottom: "1px solid #f0f0f0",
    paddingBottom: 8,
  },
  labelKey: { fontSize: 12, color: "#888", fontWeight: 600 },
  pkgTag: {
    background: "#1a1a2e",
    color: "#fff",
    padding: "3px 9px",
    borderRadius: 6,
    fontFamily: "monospace",
    fontSize: 13,
  },
  mapLink: {
    display: "inline-block",
    background: "#4285f4",
    color: "#fff",
    padding: "8px 16px",
    borderRadius: 8,
    textDecoration: "none",
    fontSize: 14,
    textAlign: "center",
  },
  closeBtn: {
    width: "100%",
    background: "#e74c3c",
    color: "#fff",
    border: "none",
    padding: "11px",
    borderRadius: 9,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 15,
  },
};
