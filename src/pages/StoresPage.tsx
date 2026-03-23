import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabase';
import AppNav from '../components/AppNav';
import './StoresPage.css';

interface ShopCard {
  shop_id: string;
  name: string;
  description: string | null;
  location: string | null;
  shopLogo: string | null;
  categories: string[];
}

export default function StoresPage() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('shops')
      .select('shop_id, name, description, location, shopLogo, categories')
      // .eq('status', 'approved')
      // .eq('published', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setShops(
          (data ?? []).map(s => ({
            shop_id: s.shop_id,
            name: s.name,
            description: s.description ?? null,
            location: s.location ?? null,
            shopLogo: s.shopLogo ?? null,
            categories: s.categories ?? [],
          }))
        );
        setLoading(false);
      });
  }, []);

  return (
    <div className="sp-page">
      <AppNav />

      <div className="sp-hero">
        <h1>اكتشف المتاجر</h1>
        <p>تصفّح مجموعة من المتاجر المتنوعة على منصة سوق لينك</p>
      </div>

      <div className="sp-body">
        {loading ? (
          <div className="sp-loading">جاري التحميل...</div>
        ) : shops.length === 0 ? (
          <div className="sp-empty">
            <span>🏪</span>
            <p>لا توجد متاجر متاحة حالياً — تابعنا قريباً!</p>
          </div>
        ) : (
          <div className="sp-grid">
            {shops.map(shop => (
              <div
                key={shop.shop_id}
                className="sp-card"
                onClick={() => navigate(`/store/${shop.shop_id}`)}
              >
                <div className="sp-card-logo">
                  {shop.shopLogo
                    ? <img src={shop.shopLogo} alt={shop.name} />
                    : <span className="sp-card-logo-fallback">{shop.name.charAt(0)}</span>
                  }
                </div>
                <div className="sp-card-info">
                  <div className="sp-card-name">{shop.name}</div>
                  {shop.location && (
                    <div className="sp-card-location">
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {shop.location}
                    </div>
                  )}
                  {shop.description && (
                    <div className="sp-card-desc">{shop.description}</div>
                  )}
                  {shop.categories.length > 0 && (
                    <div className="sp-card-cats">
                      {shop.categories.slice(0, 3).map(c => (
                        <span key={c} className="sp-card-cat">{c}</span>
                      ))}
                      {shop.categories.length > 3 && (
                        <span className="sp-card-cat sp-card-cat--more">+{shop.categories.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="sp-card-arrow">←</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
