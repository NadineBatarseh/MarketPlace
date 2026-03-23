import { useState, useEffect } from 'react';
import supabase from '../../lib/supabase';
import './AdminDashboard.css';

interface ShopRow {
  shop_id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  location: string | null;
  shopLogo: string | null;
  categories: string[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
}

type FilterTab = 'pending' | 'approved' | 'rejected';

const TAB_LABELS: Record<FilterTab, string> = {
  pending: 'قيد المراجعة',
  approved: 'موافق عليها',
  rejected: 'مرفوضة',
};

export default function AdminDashboard() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadShops();
  }, []);

  const loadShops = async () => {
    setLoading(true);
    setLoadError('');

    const { data: shopRows, error } = await supabase
      .from('shops')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !shopRows) {
      setLoadError('تعذّر تحميل البيانات: ' + (error?.message ?? 'خطأ غير معروف'));
      setLoading(false);
      return;
    }

    // Fetch owner info for each shop from public.users
    const enriched: ShopRow[] = await Promise.all(
      shopRows.map(async (shop) => {
        const { data: user } = await supabase
          .from('users')
          .select('name, email')
          .eq('user_id', shop.merchant_id)
          .maybeSingle();

        return {
          shop_id: shop.shop_id,
          merchant_id: shop.merchant_id,
          name: shop.name,
          description: shop.description ?? null,
          location: shop.location ?? null,
          shopLogo: shop.shopLogo ?? null,
          categories: shop.categories ?? [],
          status: (shop.status ?? 'pending') as 'pending' | 'approved' | 'rejected',
          created_at: shop.created_at,
          owner_name: user?.name ?? null,
          owner_email: user?.email ?? null,
        };
      })
    );

    setShops(enriched);
    setLoading(false);
  };

  const updateStatus = async (shopId: string, newStatus: 'approved' | 'rejected') => {
    setActionLoading(shopId);
    const { error } = await supabase
      .from('shops')
      .update({ status: newStatus })
      .eq('shop_id', shopId);

    if (!error) {
      setShops(prev =>
        prev.map(s => s.shop_id === shopId ? { ...s, status: newStatus } : s)
      );
    }
    setActionLoading(null);
  };

  const filtered = shops.filter(s => s.status === activeTab);

  return (
    <div className="ad-root">
      <div className="ad-header">
        <div className="ad-header-logo">سوق <span>لينك</span></div>
        <div>
          <h1 className="ad-header-title">لوحة تحكم الإدارة</h1>
          <p className="ad-header-sub">مراجعة وإدارة طلبات التسجيل في المنصة</p>
        </div>
      </div>

      {loadError && <div className="ad-error">{loadError}</div>}

      <div className="ad-tabs">
        {(['pending', 'approved', 'rejected'] as FilterTab[]).map(tab => {
          const count = shops.filter(s => s.status === tab).length;
          return (
            <button
              key={tab}
              type="button"
              className={`ad-tab ad-tab--${tab}${activeTab === tab ? ' ad-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
              <span className="ad-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="ad-loading">جاري تحميل الطلبات...</div>
      ) : filtered.length === 0 ? (
        <div className="ad-empty">لا توجد طلبات في هذا القسم</div>
      ) : (
        <div className="ad-cards">
          {filtered.map(shop => (
            <div key={shop.shop_id} className="ad-card">
              <div className="ad-card-logo">
                {shop.shopLogo
                  ? <img src={shop.shopLogo} alt={shop.name} />
                  : <span className="ad-logo-fallback">🏪</span>
                }
              </div>

              <div className="ad-card-body">
                <div className="ad-card-name">{shop.name}</div>

                {(shop.owner_name || shop.owner_email) && (
                  <div className="ad-card-owner">
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    {shop.owner_name ?? shop.owner_email}
                    {shop.owner_name && shop.owner_email && (
                      <span className="ad-card-email"> — {shop.owner_email}</span>
                    )}
                  </div>
                )}

                {shop.location && (
                  <div className="ad-card-detail">
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {shop.location}
                  </div>
                )}

                {shop.description && (
                  <div className="ad-card-desc">{shop.description}</div>
                )}

                {shop.categories.length > 0 && (
                  <div className="ad-card-cats">
                    {shop.categories.map(c => (
                      <span key={c} className="ad-cat-chip">{c}</span>
                    ))}
                  </div>
                )}

                <div className="ad-card-date">
                  تاريخ التسجيل:{' '}
                  {new Date(shop.created_at).toLocaleDateString('ar-EG', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </div>
              </div>

              <div className="ad-card-actions">
                {(activeTab === 'pending' || activeTab === 'rejected') && (
                  <button
                    type="button"
                    className="ad-btn ad-btn--approve"
                    disabled={actionLoading === shop.shop_id}
                    onClick={() => updateStatus(shop.shop_id, 'approved')}
                  >
                    {actionLoading === shop.shop_id ? '...' : '✅ موافقة'}
                  </button>
                )}
                {(activeTab === 'pending' || activeTab === 'approved') && (
                  <button
                    type="button"
                    className="ad-btn ad-btn--reject"
                    disabled={actionLoading === shop.shop_id}
                    onClick={() => updateStatus(shop.shop_id, 'rejected')}
                  >
                    {actionLoading === shop.shop_id
                      ? '...'
                      : activeTab === 'approved' ? '❌ سحب الموافقة' : '❌ رفض'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
