/**
 * RESPONSIBILITY: Display one consolidated order for the Deliverer.
 * Shows customer info, hub, status actions, and photo proof upload.
 */
import { useRef, useState } from "react";
import type { DelivererOrder } from "../api";
import { supabase } from "../supabaseClient";

interface OrderCardProps {
  order: DelivererOrder;
  onStart:    (orderId: number) => Promise<void>;
  onComplete: (orderId: number) => Promise<void>;
}

export default function OrderCard({ order, onStart, onComplete }: OrderCardProps) {
  const [loading, setLoading]         = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [photoUrl, setPhotoUrl]       = useState<string | null>(null);
  const [photoError, setPhotoError]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleStart() {
    setLoading(true);
    try { await onStart(order.id); } finally { setLoading(false); }
  }

  async function handleComplete() {
    setLoading(true);
    try { await onComplete(order.id); } finally { setLoading(false); }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoError(null);
    try {
      const path = `delivery-proofs/${order.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("delivery-proofs").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("delivery-proofs").getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
    } catch (err: any) {
      setPhotoError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const isAtHub     = order.status === "at_hub";
  const isDelivering = order.status === "delivering";

  return (
    <div style={{
      borderRadius: "12px",
      border: `1px solid ${isDelivering ? "#fed7aa" : "#e5e7eb"}`,
      background: isDelivering ? "#fff7ed" : "white",
      overflow: "hidden",
      marginBottom: "12px",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px",
        background: isDelivering ? "#ffedd5" : "#f9fafb",
        borderBottom: `1px solid ${isDelivering ? "#fed7aa" : "#e5e7eb"}`,
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        <div>
          <div style={{ fontWeight: "700", fontSize: "15px", color: "#111827" }}>
            طلب #{order.id}
          </div>
          {order.customer_email && (
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "3px" }}>
              👤 {order.customer_email}
            </div>
          )}
          {order.hub && (
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
              ⬡ من: {order.hub.name}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          <StatusBadge status={order.status} />
          {order.total_price && (
            <span style={{ fontSize: "12px", color: "#374151", fontWeight: "600" }}>
              {order.total_price} ₪
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>

        {/* Navigation buttons — Hub → Customer */}
        <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "2px" }}>
          📍 {order.delivery_lat.toFixed(5)}, {order.delivery_lng.toFixed(5)}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${order.delivery_lat},${order.delivery_lng}&travelmode=driving`}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              gap: "6px", padding: "9px", borderRadius: "8px",
              background: "#4285F4", color: "white",
              fontWeight: "600", fontSize: "12px", textDecoration: "none",
            }}
          >
            🗺️ Google Maps
          </a>
          <a
            href={`https://waze.com/ul?ll=${order.delivery_lat},${order.delivery_lng}&navigate=yes&zoom=17`}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              gap: "6px", padding: "9px", borderRadius: "8px",
              background: "#33CCFF", color: "white",
              fontWeight: "600", fontSize: "12px", textDecoration: "none",
            }}
          >
            🚗 Waze
          </a>
        </div>

        {/* Photo proof (shown when delivering) */}
        {isDelivering && (
          <div style={{ padding: "10px 12px", borderRadius: "8px", background: "#f9fafb", border: "1px dashed #d1d5db" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#374151", marginBottom: "8px" }}>
              📷 إثبات التوصيل (اختياري)
            </div>
            {photoUrl ? (
              <img src={photoUrl} alt="proof" style={{ width: "100%", maxHeight: "180px", objectFit: "cover", borderRadius: "6px" }} />
            ) : (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  style={{
                    padding: "6px 14px", borderRadius: "6px", border: "1px solid #d1d5db",
                    background: "white", fontSize: "12px", cursor: "pointer", color: "#374151",
                  }}
                >
                  {uploading ? "جاري الرفع..." : "📷 رفع صورة"}
                </button>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} style={{ display: "none" }} />
                {photoError && <div style={{ fontSize: "11px", color: "#ef4444", marginTop: "4px" }}>{photoError}</div>}
              </>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          {isAtHub && (
            <ActionButton
              onClick={handleStart}
              loading={loading}
              color="#4f46e5"
              label="🚀 ابدأ التوصيل"
            />
          )}
          {isDelivering && (
            <ActionButton
              onClick={handleComplete}
              loading={loading}
              color="#22c55e"
              label="✓ تأكيد التسليم"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    at_hub:     { bg: "#dbeafe", text: "#1e40af", label: "في نقطة التجميع" },
    delivering: { bg: "#ffedd5", text: "#9a3412", label: "قيد التوصيل" },
  };
  const s = map[status] ?? { bg: "#f3f4f6", text: "#374151", label: status };
  return (
    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "99px", background: s.bg, color: s.text, fontWeight: "600" }}>
      {s.label}
    </span>
  );
}

function ActionButton({ onClick, loading, color, label }: { onClick: () => void; loading: boolean; color: string; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        flex: 1, padding: "10px", borderRadius: "8px", border: "none",
        background: loading ? "#d1d5db" : color,
        color: "white", fontSize: "13px", fontWeight: "600",
        cursor: loading ? "not-allowed" : "pointer",
      }}
    >
      {loading ? "..." : label}
    </button>
  );
}
