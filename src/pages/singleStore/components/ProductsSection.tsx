import { Product, Status } from "../types";
import { formatNumber } from "../helpers";
import ProductCard from "./ProductCard";
import { SkeletonCards } from "./Skeletons";

export default function ProductsSection({
  status,
  products,
  searchQuery,
  error,
  total,
  sort,
  loadingMore,
  addedSet,
  favSet,
  onSortChange,
  onLoadMore,
  onAddToCart,
  onToggleFav,
  onRetry,
}: {
  status: Status;
  products: Product[];
  searchQuery: string;
  error: string;
  total: number;
  sort: string;
  loadingMore: boolean;
  addedSet: Set<string | number>;
  favSet: Set<string | number>;
  onSortChange: (sort: string) => void;
  onLoadMore: () => void;
  onAddToCart: (id: string | number, name: string) => void;
  onToggleFav: (id: string | number) => void;
  onRetry: () => void;
}) {
  const q = searchQuery.trim().toLowerCase();
  const filteredProducts = q
    ? products.filter((p) =>
        (p.title ?? "").toLowerCase().includes(q) ||
        (p.name ?? "").toLowerCase().includes(q)
      )
    : products;

  return (
    <div className="sp-products-wrap">
      <div className="sp-products-toolbar">
        <div>
          <span className="sp-products-title">جميع المنتجات</span>
          {status === "success" && (
            <span className="sp-products-count">({formatNumber(total)} منتج)</span>
          )}
        </div>
        <div className="sp-toolbar-right">
          <select
            className="sp-select-sort"
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
          >
            <option value="default">الأكثر مبيعاً</option>
            <option value="price_asc">السعر: الأقل أولاً</option>
            <option value="price_desc">السعر: الأعلى أولاً</option>
            <option value="newest">الأحدث</option>
            <option value="rating">الأعلى تقييماً</option>
          </select>
        </div>
      </div>

      <div className="sp-products-grid">
        {status === "loading" && <SkeletonCards />}

        {status === "error" && (
          <div style={{ gridColumn: "1/-1" }} className="sp-error-wrap">
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⚠️</div>
            <h3>تعذّر تحميل المنتجات</h3>
            <p>{error}</p>
            <button className="sp-btn-retry" onClick={onRetry}>
              إعادة المحاولة
            </button>
          </div>
        )}

        {status === "success" && products.length === 0 && (
          <div style={{ gridColumn: "1/-1" }} className="sp-error-wrap">
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📦</div>
            <h3>لا توجد منتجات</h3>
            <p>لم يتم إضافة منتجات لهذا المتجر بعد.</p>
          </div>
        )}

        {status === "success" && products.length > 0 && filteredProducts.length === 0 && (
          <div style={{ gridColumn: "1/-1" }} className="sp-error-wrap">
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔍</div>
            <h3>لا توجد نتائج</h3>
            <p>لم يتم العثور على منتجات تطابق بحثك.</p>
          </div>
        )}

        {status === "success" &&
          filteredProducts.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              index={i}
              isAdded={addedSet.has(p.id)}
              isFaved={favSet.has(p.id)}
              onAddToCart={onAddToCart}
              onToggleFav={onToggleFav}
            />
          ))}
      </div>

      {status === "success" && products.length < total && (
        <div className="sp-load-more-wrap">
          <button
            className="sp-btn-load"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "جاري التحميل..." : "تحميل المزيد"}
          </button>
        </div>
      )}
    </div>
  );
}
