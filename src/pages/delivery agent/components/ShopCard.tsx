/**
 * RESPONSIBILITY: Display one shop's items within a collector order.
 * Shows items list + "Confirm Pickup" button.
 */
import { useState } from "react";
import type { CollectorShop } from "../api";

interface ShopCardProps {
  shop: CollectorShop;
  orderDone: boolean;           // all shops collected → disable button
  onConfirm: (shopId: string) => Promise<void>;
}

export default function ShopCard({ shop, orderDone, onConfirm }: ShopCardProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const allCollected = done || shop.items.every((i) => i.is_collected);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm(shop.shop_id);
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      borderRadius: "10px",
      border: `1px solid ${allCollected ? "#bbf7d0" : "#e5e7eb"}`,
      background: allCollected ? "#f0fdf4" : "white",
      overflow: "hidden",
      marginBottom: "10px",
    }}>
      {/* Shop header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px",
        background: allCollected ? "#dcfce7" : "#f9fafb",
        borderBottom: `1px solid ${allCollected ? "#bbf7d0" : "#e5e7eb"}`,
      }}>
        <div>
          <div style={{ fontWeight: "700", fontSize: "14px", color: "#111827" }}>
            🏪 {shop.name}
          </div>
          <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
            {shop.items.length} منتج للاستلام
          </div>
        </div>
        {allCollected ? (
          <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "99px", background: "#22c55e", color: "white", fontWeight: "600" }}>
            ✓ تم الاستلام
          </span>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: "6px 14px", borderRadius: "8px", border: "none",
              background: loading ? "#a5b4fc" : "#4f46e5",
              color: "white", fontSize: "12px", fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "..." : "تأكيد الاستلام"}
          </button>
        )}
      </div>

      {/* Items list */}
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {shop.items.map((item) => (
          <div key={item.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: "13px", color: "#374151",
            padding: "4px 0",
            borderBottom: "1px dashed #f3f4f6",
          }}>
            <span>منتج: {item.product_id.slice(0, 12)}...</span>
            <span style={{
              padding: "2px 8px", borderRadius: "6px",
              background: "#f3f4f6", fontSize: "12px", fontWeight: "600",
            }}>
              × {item.qty}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
