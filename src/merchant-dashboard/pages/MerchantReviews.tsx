import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';

const ALL_PRODUCTS_KEY = '__all__';

interface Reply {
  id: string;
  reply_text: string;
}

interface Review {
  id: string;
  created_at: string;
  rating: number;
  review_text: string;
  user_id: string;
  customerName: string;
  image_urls: string[];
  product_id: string;
  productTitle: string;
  productImage: string | null;
  reply: Reply | null;
}

function formatDate(iso: string, numLocale: string) {
  return new Intl.DateTimeFormat(numLocale, {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso));
}

function Stars({ count }: { count: number }) {
  return (
    <span className="mr-stars">
      {Array.from({ length: 5 }, (_, i) => (i < count ? '★' : '☆')).join('')}
    </span>
  );
}

function ProductChip({ review }: { review: Review }) {
  const { t } = useTranslation('merchant');
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="mr-product-chip"
      onClick={() => navigate(`/product/${review.product_id}`)}
      title={t('reviews.viewProduct')}
    >
      {review.productImage ? (
        <img src={review.productImage} alt={review.productTitle} className="mr-product-chip-img" />
      ) : (
        <span className="mr-product-chip-img mr-product-chip-img--placeholder">🛍️</span>
      )}
      <span className="mr-product-chip-title">{review.productTitle}</span>
      <span className="mr-product-chip-arrow">‹</span>
    </button>
  );
}

export default function MerchantReviews() {
  const { t } = useTranslation('merchant');
  const { lang, direction } = useLanguage();
  const { merchant } = useMerchantAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [productFilter, setProductFilter] = useState(ALL_PRODUCTS_KEY);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const shopId = merchant?.shop?.shop_id;
    if (!shopId) { setLoading(false); return; }
    loadReviews(shopId);
  }, [merchant?.shop?.shop_id]);

  const loadReviews = async (shopId: string) => {
    setLoading(true);
    setError('');
    try {
      // 1. Get all product IDs belonging to this shop
      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('id, title, image_urls')
        .eq('shop_id', shopId);
      if (pErr) throw pErr;

      if (!products || products.length === 0) {
        setReviews([]);
        setLoading(false);
        return;
      }

      const productMap: Record<string, string> = {};
      const productImageMap: Record<string, string | null> = {};
      products.forEach(p => {
        productMap[p.id] = p.title;
        productImageMap[p.id] = Array.isArray(p.image_urls) && p.image_urls.length > 0 ? p.image_urls[0] : null;
      });
      const productIds = products.map(p => p.id);

      // 2. Get reviews for those products, including any replies
      const { data: rows, error: rErr } = await supabase
        .from('Reviews')
        .select(`
          id,
          created_at,
          rating,
          review_text,
          image_urls,
          user_id,
          product_id,
          review_replies ( id, reply_text )
        `)
        .in('product_id', productIds)
        .order('created_at', { ascending: false });
      if (rErr) throw rErr;

      // 3. Fetch customer names from Users table
      const userIds = [...new Set((rows ?? []).map((r: any) => r.user_id))];
      let nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('Users')
          .select('user_id, name')
          .in('user_id', userIds);
        (users ?? []).forEach((u: any) => { nameMap[u.user_id] = u.name; });
      }

      const mapped: Review[] = (rows ?? []).map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        rating: r.rating,
        review_text: r.review_text,
        image_urls: Array.isArray(r.image_urls) ? r.image_urls : [],
        user_id: r.user_id,
        customerName: nameMap[r.user_id] ?? t('reviews.customerFallback', { id: r.user_id.slice(0, 6) }),
        product_id: r.product_id,
        productTitle: productMap[r.product_id] ?? t('reviews.productFallback'),
        productImage: productImageMap[r.product_id] ?? null,
        reply: Array.isArray(r.review_replies) && r.review_replies.length > 0
          ? r.review_replies[0]
          : null,
      }));

      setReviews(mapped);
    } catch (err: unknown) {
      setError(t('reviews.loadFailed'));
      console.error(err);
    }
    setLoading(false);
  };

  const sendReply = async (reviewId: string) => {
    const text = (replyText[reviewId] ?? '').trim();
    if (!text || !merchant) return;

    const { error: insertErr } = await supabase
      .from('review_replies')
      .upsert({
        review_id: reviewId,
        merchant_id: merchant.id,
        reply_text: text,
      }, { onConflict: 'review_id' });

    if (insertErr) {
      alert(t('reviews.replyFailed') + ' — ' + insertErr.message);
      return;
    }

    // Update local state immediately
    setReviews(prev =>
      prev.map(r =>
        r.id === reviewId
          ? { ...r, reply: { id: `temp_${Date.now()}`, reply_text: text } }
          : r
      )
    );
    setReplyText(prev => ({ ...prev, [reviewId]: '' }));
  };

  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const productTitles = Array.from(new Set(reviews.map(r => r.productTitle)));
  const filtered = reviews.filter(r => productFilter === ALL_PRODUCTS_KEY || r.productTitle === productFilter);
  const unreplied = filtered.filter(r => !r.reply);
  const replied = filtered.filter(r => !!r.reply);

  if (loading) return <div className="mr-root" dir={direction}><div className="md-page-loading">{t('reviews.loading')}</div></div>;
  if (!merchant?.shop) return <div className="mr-root" dir={direction}><div className="md-page-empty">{t('reviews.noShop')}</div></div>;

  return (
    <div className="mr-root" dir={direction}>
      <div className="mr-header">
        <h1 className="mr-title">{t('reviews.title')}</h1>
        <div className="mr-filter">
          <label htmlFor="mr-product-filter">{t('reviews.filterLabel')}</label>
          <select
            id="mr-product-filter"
            value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
          >
            <option value={ALL_PRODUCTS_KEY}>{t('reviews.filterAll')}</option>
            {productTitles.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      <div className="mr-columns">
        {/* Unreplied */}
        <div>
          <h2 className="mr-col-title unreplied">
            💬 {t('reviews.unrepliedTitle')}
            <span className="mr-count-badge">{unreplied.length}</span>
          </h2>

          {unreplied.length === 0 ? (
            <div className="mr-empty">{t('reviews.emptyUnreplied')} ✅</div>
          ) : (
            unreplied.map(review => (
              <div key={review.id} className="mr-review-card">
                <div className="mr-review-top">
                  <div>
                    <div className="mr-reviewer">{review.customerName}</div>
                    <Stars count={review.rating} />
                  </div>
                  <ProductChip review={review} />
                </div>
                <div className="mr-date">{formatDate(review.created_at, numLocale)}</div>
                <p className="mr-comment">{review.review_text}</p>
                {review.image_urls.length > 0 && (
                  <div className="mr-review-photos">
                    {review.image_urls.map((url, idx) => (
                      <img key={idx} src={url} alt={t('reviews.photoAlt', { index: idx + 1 })} className="mr-review-photo" />
                    ))}
                  </div>
                )}

                <div className="mr-reply-form">
                  <textarea
                    placeholder={t('reviews.replyPlaceholder')}
                    value={replyText[review.id] ?? ''}
                    onChange={e => setReplyText(prev => ({ ...prev, [review.id]: e.target.value }))}
                  />
                  <button type="button" className="mr-reply-send-btn" onClick={() => sendReply(review.id)}>
                    {t('reviews.sendReply')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Replied */}
        <div>
          <h2 className="mr-col-title replied">
            ✅ {t('reviews.repliedTitle')}
            <span className="mr-count-badge">{replied.length}</span>
          </h2>

          {replied.length === 0 ? (
            <div className="mr-empty">{t('reviews.emptyReplied')}</div>
          ) : (
            replied.map(review => (
              <div key={review.id} className="mr-review-card">
                <div className="mr-review-top">
                  <div>
                    <div className="mr-reviewer">{review.customerName}</div>
                    <Stars count={review.rating} />
                  </div>
                  <ProductChip review={review} />
                </div>
                <div className="mr-date">{formatDate(review.created_at, numLocale)}</div>
                <p className="mr-comment">{review.review_text}</p>
                {review.image_urls.length > 0 && (
                  <div className="mr-review-photos">
                    {review.image_urls.map((url, idx) => (
                      <img key={idx} src={url} alt={t('reviews.photoAlt', { index: idx + 1 })} className="mr-review-photo" />
                    ))}
                  </div>
                )}

                <div className="mr-replied-box">
                  <div className="mr-replied-label">{t('reviews.yourReplyLabel')}</div>
                  <div className="mr-replied-text">{review.reply!.reply_text}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
