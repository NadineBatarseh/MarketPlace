/**
 * RESPONSIBILITY: Render the two-phase delivery plan.
 *
 * Phase 1 — Collection: Driver → Shops (optimized) → Hub
 * Phase 2 — Delivery:   Hub → Customer
 */
import type { CartOptimizeResult } from "../api";

interface OrderListProps {
  result: CartOptimizeResult;
}

function formatKm(meters: number) { return (meters / 1000).toFixed(1) + " كم"; }
function formatMin(seconds: number) { return Math.round(seconds / 60) + " د"; }

export default function OrderList({ result }: OrderListProps) {
  const { collection, delivery } = result;

  return (
    <div style={{ fontFamily: "sans-serif", direction: "rtl", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── Phase 1: Collection ── */}
      <PhaseSection
        phase={1}
        title="مرحلة الاستلام"
        subtitle={`المندوب ← ${collection.stops.length} متجر ← نقطة التجميع`}
        color="#4F46E5"
        bgColor="#eef2ff"
        borderColor="#c7d2fe"
        km={formatKm(collection.totalDistanceMeters)}
        mins={formatMin(collection.totalDurationSeconds)}
      >
        {collection.stops.filter(Boolean).map((stop, i) => (
          <StopRow
            key={stop.shopId}
            index={i + 1}
            label={stop.label}
            sublabel="متجر — استلام البضاعة"
            dotColor="#22c55e"
            tagBg="#dcfce7"
            tagColor="#166534"
            tagText="استلام"
          />
        ))}
        <HubRow name={result.hub.name} />
      </PhaseSection>

      {/* ── Phase 2: Delivery ── */}
      <PhaseSection
        phase={2}
        title="مرحلة التوصيل"
        subtitle="نقطة التجميع ← العميل"
        color="#F97316"
        bgColor="#fff7ed"
        borderColor="#fed7aa"
        km={formatKm(delivery.totalDistanceMeters)}
        mins={formatMin(delivery.totalDurationSeconds)}
      >
        <StopRow
          index={1}
          label="موقع العميل"
          sublabel="التوصيل النهائي"
          dotColor="#ef4444"
          tagBg="#fee2e2"
          tagColor="#991b1b"
          tagText="توصيل"
        />
      </PhaseSection>

      {/* ── Total summary ── */}
      <div style={{
        padding: "12px 16px",
        borderRadius: "10px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        display: "flex",
        gap: "24px",
        fontSize: "13px",
        color: "#6b7280",
      }}>
        <span>إجمالي المسافة: <strong style={{ color: "#111827" }}>
          {formatKm(collection.totalDistanceMeters + delivery.totalDistanceMeters)}
        </strong></span>
        <span>إجمالي الوقت: <strong style={{ color: "#111827" }}>
          {formatMin(collection.totalDurationSeconds + delivery.totalDurationSeconds)}
        </strong></span>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function PhaseSection({
  phase, title, subtitle, color, bgColor, borderColor, km, mins, children,
}: {
  phase: number; title: string; subtitle: string;
  color: string; bgColor: string; borderColor: string;
  km: string; mins: string; children: React.ReactNode;
}) {
  return (
    <div style={{ borderRadius: "12px", border: `1px solid ${borderColor}`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: bgColor, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "26px", height: "26px", borderRadius: "50%",
            background: color, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "13px", fontWeight: "700",
          }}>{phase}</div>
          <div>
            <div style={{ fontWeight: "700", fontSize: "14px", color: "#111827" }}>{title}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "1px" }}>{subtitle}</div>
          </div>
        </div>
        <div style={{ textAlign: "left", fontSize: "12px", color: "#6b7280" }}>
          <div>{km}</div>
          <div>{mins}</div>
        </div>
      </div>

      {/* Stops */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {children}
      </div>
    </div>
  );
}

function StopRow({
  index, label, sublabel, dotColor, tagBg, tagColor, tagText,
}: {
  index: number; label: string; sublabel: string;
  dotColor: string; tagBg: string; tagColor: string; tagText: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 4px" }}>
      <div style={{
        width: "24px", height: "24px", borderRadius: "50%",
        background: dotColor, color: "white",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "12px", fontWeight: "bold", flexShrink: 0,
      }}>{index}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>{label}</div>
        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>{sublabel}</div>
      </div>
      <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "99px", background: tagBg, color: tagColor, fontWeight: "600" }}>
        {tagText}
      </span>
    </div>
  );
}

function HubRow({ name }: { name: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 4px", borderTop: "1px dashed #e5e7eb", marginTop: "2px" }}>
      <div style={{
        width: "24px", height: "24px", borderRadius: "50%",
        background: "#F97316", color: "white",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "14px", flexShrink: 0,
      }}>⬡</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>{name}</div>
        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>نقطة تجميع — تجميع جميع الطلبات هنا</div>
      </div>
      <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "99px", background: "#ffedd5", color: "#9a3412", fontWeight: "600" }}>
        Hub
      </span>
    </div>
  );
}
