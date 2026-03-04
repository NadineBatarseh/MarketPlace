import { PAGE_SIZE } from "../types";

export function SkeletonHeader() {
  return (
    <div className="sp-store-header">
      <div className="sp-skeleton" style={{ width: 110, height: 110, borderRadius: 14, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="sp-skeleton" style={{ height: 28, width: "55%", marginBottom: ".6rem" }} />
        <div className="sp-skeleton" style={{ height: 16, width: "25%", marginBottom: ".6rem" }} />
        <div className="sp-skeleton" style={{ height: 13, width: "95%", marginBottom: ".3rem" }} />
        <div className="sp-skeleton" style={{ height: 13, width: "70%", marginBottom: "1rem" }} />
        <div style={{ display: "flex", gap: ".75rem" }}>
          <div className="sp-skeleton" style={{ height: 38, width: 110, borderRadius: 50 }} />
          <div className="sp-skeleton" style={{ height: 38, width: 100, borderRadius: 50 }} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonCards({ count = PAGE_SIZE }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sp-card-skeleton">
          <div className="sp-card-skeleton-img sp-skeleton" />
          <div className="sp-card-skeleton-body">
            <div className="sp-skeleton" style={{ height: 13, marginBottom: ".4rem" }} />
            <div className="sp-skeleton" style={{ height: 13, width: "65%", marginBottom: ".75rem" }} />
            <div className="sp-skeleton" style={{ height: 20, width: "40%", marginBottom: ".75rem" }} />
            <div className="sp-skeleton" style={{ height: 36, borderRadius: 9 }} />
          </div>
        </div>
      ))}
    </>
  );
}
