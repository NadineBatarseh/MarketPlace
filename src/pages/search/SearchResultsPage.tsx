import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './SearchResultsPage.css';

interface Product {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_url: string | null;
  shop_id: string;
  shop_name?: string;
  shop_location?: string;
}

interface Store {
  shop_id: string;
  name: string;
  location: string | null;
  shopLogo: string | null;
  avg_rating: number | null;
  review_count: number;
}

export default function SearchResultsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';

  const [loading, setLoading]   = useState(false);
  const [answer, setAnswer]     = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores]     = useState<Store[]>([]);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!q) return;
    setLoading(true);
    setAnswer(''); setProducts([]); setStores([]); setError('');

    fetch('/api/agent-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setAnswer(data.answer);
          setProducts(data.products ?? []);
          setStores(data.stores ?? []);
        } else {
          setError(data.error ?? 'حدث خطأ');
        }
      })
      .catch(() => setError('تعذّر الاتصال بالخادم'))
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <div className="sr-page" dir="rtl">
      {/* Back button */}
      <button className="sr-back" onClick={() => navigate(-1)}>← رجوع</button>

      <h2 className="sr-query-title">
        نتائج البحث عن: <span>"{q}"</span>
      </h2>

      {loading && (
        <div className="sr-loading">
          <div className="sr-spinner" />
          جاري البحث بالذكاء الاصطناعي...
        </div>
      )}

      {error && <div className="sr-error">{error}</div>}

      {/* AI Summary */}
      {answer && (
        <div className="sr-answer-card">
          <div className="sr-answer-icon">🤖</div>
          <p>{answer}</p>
        </div>
      )}

      {/* Stores */}
      {stores.length > 0 && (
        <section className="sr-section">
          <h3 className="sr-section-title">المتاجر ({stores.length})</h3>
          <div className="sr-stores-grid">
            {stores.map(s => (
              <div key={s.shop_id} className="sr-store-card"
                   onClick={() => navigate(`/stores/${s.shop_id}`)}>
                {s.shopLogo
                  ? <img src={s.shopLogo} alt={s.name} className="sr-store-logo" />
                  : <div className="sr-store-logo-fallback">🏪</div>
                }
                <strong className="sr-store-name">{s.name}</strong>
                {s.location && <span className="sr-store-loc">📍 {s.location}</span>}
                {s.avg_rating && (
                  <span className="sr-store-rating">⭐ {s.avg_rating.toFixed(1)} ({s.review_count})</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Products */}
      {products.length > 0 && (
        <section className="sr-section">
          <h3 className="sr-section-title">المنتجات ({products.length})</h3>
          <div className="sr-products-grid">
            {products.map(p => (
              <div key={p.id} className="sr-product-card"
                   onClick={() => navigate(`/product/${p.id}`)}>
                {p.image_url
                  ? <img src={p.image_url} alt={p.title} className="sr-product-img" />
                  : <div className="sr-product-img-fallback">📦</div>
                }
                <div className="sr-product-info">
                  <strong className="sr-product-title">{p.title}</strong>
                  {p.price != null && <span className="sr-price">{p.price} ₪</span>}
                  {p.shop_name && <span className="sr-shop">{p.shop_name}</span>}
                  {p.shop_location && <span className="sr-shop-loc">📍 {p.shop_location}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && products.length === 0 && stores.length === 0 && q && (
        <div className="sr-empty">
          <span>🔍</span>
          <p>لم نجد نتائج لـ "{q}"</p>
          <p className="sr-empty-hint">جرّب كلمات أخرى أو تحقق من الإملاء</p>
        </div>
      )}
    </div>
  );
}
