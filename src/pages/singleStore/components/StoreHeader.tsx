import { Store, Status } from "../types";
import { formatNumber } from "../helpers";
import StarRating from "./StarRating";
import { SkeletonHeader } from "./Skeletons";

export default function StoreHeader({
  status,
  store,
  error,
}: {
  status: Status;
  store: Store | null;
  error: string;
}) {
  return (
    <div className="sp-store-header-wrap">
      {status === "loading" && <SkeletonHeader />}

      {status === "error" && (
        <div className="sp-error-wrap" style={{ marginTop: "-60px", position: "relative", zIndex: 10 }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🏪</div>
          <h2>تعذّر تحميل المتجر</h2>
          <p>{error}</p>
          <button className="sp-btn-retry" onClick={() => window.location.reload()}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {status === "success" && store && (
        <div className="sp-store-header">
          {/* Logo */}
          <div className="sp-store-logo-wrap">
            {store.shopLogo ? (
              <img src={store.shopLogo} alt={store.name} />
            ) : (
              <div className="sp-store-logo-placeholder">{store.name.charAt(0)}</div>
            )}
          </div>

          {/* Info */}
          <div className="sp-store-info">
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".4rem", marginBottom: ".3rem" }}>
              <h1 className="sp-store-name">{store.name}</h1>
              {store.is_verified && (
                <span className="sp-store-verified">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  موثّق
                </span>
              )}
            </div>

            <div className="sp-stars">
              <StarRating rating={store.rating || 0} variant="store" />
              <span className="sp-rating-count">
                ({(store.rating || 0).toFixed(1)}) · {formatNumber(store.review_count)} تقييم
              </span>
            </div>

            {store.description && <p className="sp-store-desc">{store.description}</p>}

            <div className="sp-store-meta">
            
              {store.member_since && (
                <span className="sp-meta-item">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  عضو منذ {store.member_since}
                </span>
              )}
            </div>

            {/* Contact links */}
            <div className="sp-store-contacts">
              {store.whatsapp && (
                <a
                  href={`https://wa.me/${store.whatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  className="sp-contact-link whatsapp"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
                  </svg>
                  واتساب
                </a>
              )}
              {store.instagram && (
                <a
                  href={`https://instagram.com/${store.instagram}`}
                  target="_blank"
                  rel="noreferrer"
                  className="sp-contact-link instagram"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
                  </svg>
                  انستغرام
                </a>
              )}
              {store.facebook && (
                <a
                  href={store.facebook!}
                  target="_blank"
                  rel="noreferrer"
                  className="sp-contact-link facebook"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                  فيسبوك
                </a>
              )}
              {store.location && (
                <span className="sp-contact-link location">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {store.location}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
