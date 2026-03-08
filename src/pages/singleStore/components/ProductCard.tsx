import { useNavigate } from "react-router-dom";
import { Product } from "../types";
import { parsePrice } from "../helpers";
import StarRating from "./StarRating";

export default function ProductCard({
  product,
  index,
  isAdded,
  isFaved,
  onAddToCart,
  onToggleFav,
}: {
  product: Product;
  index: number;
  isAdded: boolean;
  isFaved: boolean;
  onAddToCart: (id: string | number, name: string) => void;
  onToggleFav: (id: string | number) => void;
}) {
  const navigate = useNavigate();
  const name  = product.title || product.name || "منتج";
  const price = parsePrice(product.price);
  const delay = `${(index * 0.07).toFixed(2)}s`;

  return (
    <div
      className="sp-card"
      style={{ animation: `sp-fadeUp .35s ease ${delay} both`, cursor: "pointer" }}
      onClick={() => navigate(`/product/${product.id}`)}
    >
      {product.badge && (
        <div className={`sp-card-badge${product.is_new ? " new" : ""}`}>{product.badge}</div>
      )}
      {product.is_new && !product.badge && (
        <div className="sp-card-badge new">جديد</div>
      )}

      <div
        className="sp-card-fav"
        onClick={(e) => { e.stopPropagation(); onToggleFav(product.id); }}
        title="أضف للمفضلة"
        style={{ background: isFaved ? "#fee2e2" : undefined }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13" height="13"
          fill={isFaved ? "#ef4444" : "none"}
          viewBox="0 0 24 24"
          stroke={isFaved ? "#ef4444" : "currentColor"}
          strokeWidth="2"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </div>

      <div className="sp-card-img">
        {product.image_url ? (
          <>
            <img
              src={product.image_url}
              alt={name}
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = "none";
                const fallback = img.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <span style={{ display: "none", fontSize: "3.5rem", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
              📦
            </span>
          </>
        ) : (
          <span style={{ fontSize: "3.5rem" }}>📦</span>
        )}
      </div>

      <div className="sp-card-body">
        <p className="sp-card-name">{name}</p>
        <div className="sp-card-rating">
          <StarRating rating={product.rating || 0} variant="card" />
          <span className="sp-card-rating-num">
            {(product.rating || 0).toFixed(1)} ({product.review_count || 0})
          </span>
        </div>
        <div className="sp-card-price-row">
          <span className="sp-card-price">{price || "—"}</span>
          <span className="sp-card-currency">ر.س</span>
          {product.old_price && (
            <span className="sp-card-price-old">{parsePrice(product.old_price)}</span>
          )}
        </div>
        <button
          className={`sp-btn-cart${isAdded ? " added" : ""}`}
          onClick={(e) => { e.stopPropagation(); onAddToCart(product.id, name); }}
        >
          {isAdded ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              تمت الإضافة
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
              إضافة للسلة
            </>
          )}
        </button>
      </div>
    </div>
  );
}
