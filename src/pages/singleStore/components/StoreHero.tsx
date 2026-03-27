import { useState } from 'react';
import type { Store } from '../types';
import StoreRating from './StoreRating';

interface Props {
  store: Store | null;
  loading: boolean;
  error: string | null;
}

export default function StoreHero({ store, loading, error }: Props) {
  const [liveRating, setLiveRating] = useState<{ avg: number; count: number } | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);

  const displayRating = liveRating?.avg ?? store?.avg_rating ?? null;
  const displayCount  = liveRating?.count ?? store?.review_count ?? 0;

  const logoChar = store?.name?.trim()[0] ?? '';

  return (
    <section className="store-hero">
      {/* Logo + title + rating + location all together */}
      <div className="store-hero-identity">
        <div className="store-logo-wrap">
          {store?.shopLogo ? (
            <img src={store.shopLogo} alt={store.name} />
          ) : (
            <div className="store-logo-placeholder">{logoChar}</div>
          )}
        </div>
        <div className="store-hero-details">
          <div className="store-name">
            {loading ? (
              <span style={{ color: 'var(--muted)' }}>جاري التحميل...</span>
            ) : error ? (
              <span style={{ color: 'var(--accent)' }}>{error}</span>
            ) : store?.name}
          </div>
          {!loading && !error && (
            <>
              {displayRating != null && (
                <div className="store-rating">
                  {[1,2,3,4,5].map(i => (
                    <svg key={i} className={`star ${i <= Math.round(displayRating) ? 'star--filled' : ''}`} viewBox="0 0 24 24" width="16" height="16">
                      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                    </svg>
                  ))}
                  <span className="store-rating-text">{Number(displayRating).toFixed(1)} ({displayCount})</span>
                </div>
              )}
              {store?.location && (
                <div className="store-meta">
                  <div className="store-meta-item">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {store.location}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="store-info" />

      <div className="store-actions">
        {store && (
          <div className="rating-btn-wrap">
            <button className="rating-open-btn" onClick={() => setRatingOpen(o => !o)} title="قيّم المتجر">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="18" height="18">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
              قيّم
            </button>
            {ratingOpen && (
              <div className="rating-popup">
                <button className="rating-popup-close" onClick={() => setRatingOpen(false)}>✕</button>
                <p className="rating-popup-title">قيّم هذا المتجر</p>
                <StoreRating
                  shopId={store.shop_id}
                  onSubmitted={(avg, count) => {
                    setLiveRating({ avg, count });
                    setTimeout(() => setRatingOpen(false), 1200);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {store?.whatsapp && (
          <a className="social-link" href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" title="WhatsApp">
            <svg fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.862L.057 23.716a.5.5 0 0 0 .625.608l5.963-1.453A11.953 11.953 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.528-5.222-1.449l-.374-.222-3.88.946.985-3.767-.243-.386A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
          </a>
        )}

        {store?.instagram && (
          <a className="social-link" href={store.instagram} target="_blank" rel="noopener noreferrer" title="Instagram">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </a>
        )}
        {store?.facebook && (
          <a className="social-link" href={store.facebook} target="_blank" rel="noopener noreferrer" title="Facebook">
            <svg fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
            </svg>
          </a>
        )}
      </div>

    </section>
  );
}
