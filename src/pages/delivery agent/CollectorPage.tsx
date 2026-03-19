/**
 * RESPONSIBILITY: First-Mile interface — collector visits shops, scans packages,
 * enters shop-owner verification code, and marks each package as picked_up.
 *
 * Data abstraction: only Package IDs and shop names are visible.
 * Customer names, order totals, and product contents are HIDDEN.
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

interface Pkg {
  id: string;      // PKG-001
  raw_id: number;
  order_id: number;
  status: string;
}

interface ShopGroup {
  shop: {
    shop_id: string;
    name: string;
    shop_lat?: number;
    shop_lng?: number;
  };
  packages: Pkg[];
}

export default function CollectorPage() {
  const [shops, setShops] = useState<ShopGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/pickup");
      const json = await res.json();
      if (json.ok) setShops(json.shops);
      else setError(json.error ?? "خطأ في تحميل البيانات");
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
          const res = await fetch("/api/logistics/collector/route", {
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
  }, []);

  const confirmPickup = async (rawId: number) => {
    setConfirming(rawId);
    setError(null);
    try {
      const res = await fetch("/api/logistics/pickup/confirm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawPackageId: rawId,
          verificationCode: codes[rawId] ?? "",
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setConfirmed((prev) => new Set(prev).add(rawId));
        load();
      } else {
        setError(json.error ?? "فشل التأكيد");
      }
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setConfirming(null);
    }
  };

  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={{ color: "#666" }}>جارٍ تحميل نقاط الاستلام...</p>
      </div>
    );
  }

  return (
    <div style={s.page} dir="rtl">
      <Topbar />
      {/* Header */}
      <header style={s.header}>
        <div>
          <h1 style={s.title}>🚚 المجمِّع — الميل الأول</h1>
          <p style={s.subtitle}>استلام الطرود من المتاجر وإيصالها لنقطة التجميع</p>
        </div>
        <button onClick={load} style={s.refreshBtn}>↻ تحديث</button>
      </header>

      {error && <div style={s.errorBanner}>{error}</div>}

      {/* Route Map */}
      <div style={s.mapSection}>
        {routeLoading ? (
          <div style={s.mapPlaceholder}>⏳ جارٍ حساب أقصر مسار...</div>
        ) : route && route.stops.length > 0 ? (
          <>
            <RouteMap stops={route.stops} encodedPolyline={route.encodedPolyline} height={280} />
            <div style={s.routeSummary}>
              <span>📏 {(route.totalDistanceMeters / 1000).toFixed(1)} كم</span>
              <span>⏱ {Math.round(route.totalDurationSeconds / 60)} دقيقة</span>
              <button onClick={loadRoute} style={s.reloadBtn}>↻ تحديث المسار</button>
            </div>
            {/* Open full trip in Google Maps */}
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
            <span>📍</span>
            <button onClick={loadRoute} style={s.reloadBtn}>احسب المسار الأمثل</button>
          </div>
        )}
      </div>

      {shops.length === 0 ? (
        <div style={s.empty}>
          <div style={{ fontSize: 48 }}>✅</div>
          <p>لا توجد طرود معلقة للاستلام</p>
        </div>
      ) : (
        <div style={s.content}>
          {shops.map(({ shop, packages }) => (
            <div key={shop.shop_id} style={s.shopCard}>
              {/* Shop Header */}
              <div style={s.shopHeader}>
                <span style={s.shopIcon}>🏪</span>
                <div style={{ flex: 1 }}>
                  <h2 style={s.shopName}>{shop.name}</h2>
                  <span style={s.pkgCount}>
                    {packages.filter((p) => !confirmed.has(p.raw_id)).length} طرد متبقٍّ
                  </span>
                </div>
                {shop.shop_lat && shop.shop_lng && (
                  <a
                    href={`https://waze.com/ul?ll=${shop.shop_lat},${shop.shop_lng}&navigate=yes`}
                    target="_blank"
                    rel="noreferrer"
                    style={s.navBtn}
                  >
                    🗺 ابدأ التنقل
                  </a>
                )}
              </div>

              {/* Warning bar */}
              <div style={s.warnBar}>
                <span style={s.warnText}>⚠️ تحقق من الكود مع صاحب المتجر قبل الاستلام</span>
              </div>

              {/* Package List */}
              <div style={s.pkgList}>
                {packages.map((pkg) => {
                  const isDone = confirmed.has(pkg.raw_id);
                  return (
                    <div
                      key={pkg.raw_id}
                      style={{ ...s.pkgRow, ...(isDone ? s.pkgDone : {}) }}
                    >
                      <span style={s.pkgId}>{pkg.id}</span>

                      {isDone ? (
                        <span style={s.doneBadge}>✔ تم الاستلام</span>
                      ) : (
                        <div style={s.codeArea}>
                          <input
                            type="text"
                            placeholder="كود التحقق"
                            value={codes[pkg.raw_id] ?? ""}
                            onChange={(e) =>
                              setCodes((prev) => ({
                                ...prev,
                                [pkg.raw_id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) =>
                              e.key === "Enter" && confirmPickup(pkg.raw_id)
                            }
                            style={s.codeInput}
                            maxLength={8}
                          />
                          <button
                            onClick={() => confirmPickup(pkg.raw_id)}
                            disabled={confirming === pkg.raw_id}
                            style={s.confirmBtn}
                          >
                            {confirming === pkg.raw_id ? "..." : "تأكيد"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f4f6f8",
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif",
    paddingBottom: 40,
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    gap: 12,
  },
  spinner: {
    width: 40,
    height: 40,
    border: "4px solid #e0e0e0",
    borderTopColor: "#e74c3c",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
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
    padding: "5px 16px",
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
  empty: {
    textAlign: "center",
    marginTop: 80,
    color: "#666",
    fontSize: 18,
  },
  content: { padding: 16, display: "flex", flexDirection: "column", gap: 16 },
  shopCard: {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
    overflow: "hidden",
  },
  shopHeader: {
    background: "#16213e",
    color: "#fff",
    padding: "5px 5px",
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  shopIcon: { fontSize: 28 },
  shopName: { margin: 0, fontSize: 17 },
  pkgCount: { fontSize: 12, opacity: 0.7 },
  navBtn: {
    background: "#0f3460",
    color: "#fff",
    padding: "7px 13px",
    borderRadius: 8,
    textDecoration: "none",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  warnBar: {
    background: "#fff8e1",
    padding: "8px 16px",
    borderBottom: "1px solid #ffe0b2",
  },
  warnText: { fontSize: 12, color: "#e65100" },
  pkgList: {
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  pkgRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#f9f9f9",
    border: "1px solid #eee",
    borderRadius: 10,
    padding: "10px 14px",
  },
  pkgDone: { background: "#f0fff4", borderColor: "#b2dfdb" },
  pkgId: {
    fontFamily: "monospace",
    fontWeight: 700,
    fontSize: 17,
    color: "#1a1a2e",
    minWidth: 85,
  },
  doneBadge: {
    background: "#27ae60",
    color: "#fff",
    padding: "4px 12px",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
  },
  codeArea: { display: "flex", gap: 8, flex: 1 },
  codeInput: {
    flex: 1,
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 15,
    textAlign: "center",
    letterSpacing: 3,
    fontFamily: "monospace",
    outline: "none",
  },
  confirmBtn: {
    background: "#e74c3c",
    color: "#fff",
    border: "none",
    padding: "7px 18px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
  },
  mapSection: { margin: "14px 16px 0" },
  mapPlaceholder: {
    height: 100,
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
