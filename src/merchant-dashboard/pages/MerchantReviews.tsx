import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

/**
 * ⚠️  MISSING: The `Reviews` table has no `customer_name` column — only `user_id`.
 *    To display real customer names, create a `profiles` table:
 *
 *    CREATE TABLE profiles (
 *      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 *      full_name TEXT,
 *      phone TEXT,
 *      address TEXT
 *    );
 *
 *    Until then, we show a truncated user_id as a placeholder.
 */

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
  product_id: string;
  productTitle: string;
  reply: Reply | null;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ar-EG', {
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

export default function MerchantReviews() {
  const { merchant } = useMerchantAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [productFilter, setProductFilter] = useState('الكل');
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
        .select('id, title')
        .eq('shop_id', shopId);
      if (pErr) throw pErr;

      if (!products || products.length === 0) {
        setReviews([]);
        setLoading(false);
        return;
      }

      const productMap: Record<string, string> = {};
      products.forEach(p => { productMap[p.id] = p.title; });
      const productIds = products.map(p => p.id);

      // 2. Get reviews for those products, including any replies
      const { data: rows, error: rErr } = await supabase
        .from('Reviews')
        .select(`
          id,
          created_at,
          rating,
          review_text,
          user_id,
          product_id,
          review_replies ( id, reply_text )
        `)
        .in('product_id', productIds)
        .order('created_at', { ascending: false });
      if (rErr) throw rErr;

      const mapped: Review[] = (rows ?? []).map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        rating: r.rating,
        review_text: r.review_text,
        user_id: r.user_id,
        product_id: r.product_id,
        productTitle: productMap[r.product_id] ?? 'منتج',
        // review_replies is an array (one-to-many), but we use UNIQUE constraint so max 1
        reply: Array.isArray(r.review_replies) && r.review_replies.length > 0
          ? r.review_replies[0]
          : null,
      }));

      setReviews(mapped);
    } catch (err: unknown) {
      setError('تعذّر تحميل المراجعات');
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
      alert('تعذّر إرسال الرد — ' + insertErr.message);
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

  const products = ['الكل', ...Array.from(new Set(reviews.map(r => r.productTitle)))];
  const filtered = reviews.filter(r => productFilter === 'الكل' || r.productTitle === productFilter);
  const unreplied = filtered.filter(r => !r.reply);
  const replied = filtered.filter(r => !!r.reply);

  if (loading) return <div className="mr-root"><div className="md-page-loading">جاري تحميل المراجعات...</div></div>;
  if (!merchant?.shop) return <div className="mr-root"><div className="md-page-empty">لا يوجد متجر مرتبط بحسابك.</div></div>;

  return (
    <div className="mr-root">
      <div className="mr-header">
        <h1 className="mr-title">المراجعات والتقييمات</h1>
        <div className="mr-filter">
          <label htmlFor="mr-product-filter">تصفية حسب المنتج:</label>
          <select
            id="mr-product-filter"
            value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
          >
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="md-page-error md-page-error--spaced">{error}</div>}

      <div className="mr-columns">
        {/* Unreplied */}
        <div>
          <h2 className="mr-col-title unreplied">
            💬 غير مردود عليها
            <span className="mr-count-badge">{unreplied.length}</span>
          </h2>

          {unreplied.length === 0 ? (
            <div className="mr-empty">لا توجد مراجعات غير مردود عليها ✅</div>
          ) : (
            unreplied.map(review => (
              <div key={review.id} className="mr-review-card">
                <div className="mr-review-top">
                  <div>
                    {/* No customer name in DB — shows truncated user_id until profiles table is added */}
                    <div className="mr-reviewer">عميل #{review.user_id.slice(0, 8)}</div>
                    <Stars count={review.rating} />
                  </div>
                  <span className="mr-product-tag">{review.productTitle}</span>
                </div>
                <div className="mr-date">{formatDate(review.created_at)}</div>
                <p className="mr-comment">{review.review_text}</p>

                <div className="mr-reply-form">
                  <textarea
                    placeholder="اكتب ردك هنا..."
                    value={replyText[review.id] ?? ''}
                    onChange={e => setReplyText(prev => ({ ...prev, [review.id]: e.target.value }))}
                  />
                  <button type="button" className="mr-reply-send-btn" onClick={() => sendReply(review.id)}>
                    إرسال الرد
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Replied */}
        <div>
          <h2 className="mr-col-title replied">
            ✅ تم الرد عليها
            <span className="mr-count-badge">{replied.length}</span>
          </h2>

          {replied.length === 0 ? (
            <div className="mr-empty">لا توجد مراجعات مردود عليها بعد</div>
          ) : (
            replied.map(review => (
              <div key={review.id} className="mr-review-card">
                <div className="mr-review-top">
                  <div>
                    <div className="mr-reviewer">عميل #{review.user_id.slice(0, 8)}</div>
                    <Stars count={review.rating} />
                  </div>
                  <span className="mr-product-tag">{review.productTitle}</span>
                </div>
                <div className="mr-date">{formatDate(review.created_at)}</div>
                <p className="mr-comment">{review.review_text}</p>

                <div className="mr-replied-box">
                  <div className="mr-replied-label">ردك:</div>
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
