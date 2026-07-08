import { useState } from 'react';
import { Star, MapPin, Package, MessageCircle, Facebook, Instagram, CheckCircle } from 'lucide-react';
import type { Store } from '../types';
import StoreRating from './StoreRating';

interface Props {
  store: Store | null;
  loading: boolean;
  error: string | null;
  productCount?: number;
}

export default function StoreHero({ store, loading, error, productCount }: Props) {
  const [liveRating, setLiveRating] = useState<{ avg: number; count: number } | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);

  const displayRating = liveRating?.avg ?? store?.avg_rating ?? null;
  const displayCount  = liveRating?.count ?? store?.review_count ?? 0;
  const logoChar      = store?.name?.trim()[0] ?? '';

  const hasMeta = !loading && !error && !!store && (store.location != null || displayRating != null || productCount != null);

  return (
    <section dir="rtl" className="w-full px-4 md:px-6 mt-3">
      <div className="rounded-3xl bg-white border border-gray-100 shadow-sm px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 w-full">

          {/* Store Image */}
          <div className="relative shrink-0">
            <div className="w-32 h-32 md:w-44 md:h-44 rounded-3xl overflow-hidden bg-gray-50 border border-gray-100 shadow-sm flex items-center justify-center">
              {store?.shopLogo ? (
                <img src={store.shopLogo} alt={store.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-white text-4xl md:text-5xl font-extrabold">
                  {logoChar}
                </div>
              )}
            </div>
            <span
              className="absolute -bottom-1.5 -left-1.5 w-6 h-6 md:w-7 md:h-7 rounded-full bg-emerald-800 border-4 border-white flex items-center justify-center shadow-md"
              title="متجر موثّق"
            >
              <CheckCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />
            </span>
          </div>

          {/* Store Info */}
          <div className="flex flex-col items-center text-center min-w-0 w-full flex-1">
            <h1 className="text-xl md:text-2xl font-bold text-emerald-900 mb-1">
              {loading ? 'جاري التحميل...' : error ? error : store?.name}
            </h1>

            {!loading && !error && store?.description && (
              <p className="text-gray-500 text-sm mb-2">{store.description}</p>
            )}

            {/* Metadata */}
            {hasMeta && store && (
              <div className="flex items-center justify-center gap-6 mb-3 flex-wrap">
                {store.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-emerald-700" />
                    <div>
                      <div className="font-bold text-emerald-900">{store.location}</div>
                      <div className="text-xs text-gray-400">الموقع</div>
                    </div>
                  </div>
                )}

                {store.location && productCount != null && <div className="h-9 w-px bg-gray-200" />}

                {productCount != null && (
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-emerald-700" />
                    <div>
                      <div className="font-bold text-emerald-900">{productCount}</div>
                      <div className="text-xs text-gray-400">منتج</div>
                    </div>
                  </div>
                )}

                {(store.location || productCount != null) && displayRating != null && (
                  <div className="h-9 w-px bg-gray-200" />
                )}

                {displayRating != null && (
                  <div className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
                    <div>
                      <div className="font-bold text-emerald-900">{Number(displayRating).toFixed(1)}</div>
                      <div className="text-xs text-gray-400">التقييم ({displayCount})</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {store && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRatingOpen(o => !o)}
                    className="h-10 px-6 rounded-2xl bg-emerald-800 text-white font-semibold text-sm flex items-center gap-2 hover:bg-emerald-900 transition"
                  >
                    <Star className="w-5 h-5" />
                    تقييم المتجر
                  </button>
                  {ratingOpen && (
                    <div className="rating-popup">
                      <button type="button" className="rating-popup-close" onClick={() => setRatingOpen(false)}>✕</button>
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
                <a
                  href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-10 px-5 rounded-2xl border border-emerald-700 text-emerald-800 font-semibold text-sm flex items-center gap-2 hover:bg-emerald-50 transition"
                >
                  <MessageCircle className="w-5 h-5" />
                  واتساب
                </a>
              )}

              {store?.instagram && (
                <a
                  href={store.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Instagram"
                  className="h-10 w-10 rounded-2xl border border-gray-200 text-emerald-800 flex items-center justify-center hover:bg-gray-50 transition"
                >
                  <Instagram className="w-5 h-5" />
                </a>
              )}

              {store?.facebook && (
                <a
                  href={store.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-10 px-5 rounded-2xl border border-gray-200 text-emerald-800 font-semibold text-sm flex items-center gap-2 hover:bg-gray-50 transition"
                >
                  <Facebook className="w-5 h-5" />
                  فيسبوك
                </a>
              )}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
