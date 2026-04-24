import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMerchantAuth } from './context/MerchantAuthContext';
import MerchantHome from './pages/MerchantHome';
import MerchantReviews from './pages/MerchantReviews';
import MerchantBilling from './pages/MerchantBilling';
import MerchantEditPage from './pages/MerchantEditPage';
import BulkUploadPage from './pages/BulkUploadPage';
import MerchantOrders from './pages/MerchantOrders';
import DraftProductsPage from './pages/DraftProductsPage';
import MerchantSettings from './pages/MerchantSettings';
import MerchantShopSettings from './pages/MerchantShopSettings';
import MerchantLoginModal from './components/MerchantLoginModal';
import InstagramConnectPage from './pages/InstagramConnectPage';
import ChatBot from '../components/chatbot/ChatBot';
import './MerchantDashboard.css';

type DashPage = 'home' | 'reviews' | 'billing' | 'editPage' | 'bulkUpload' | 'orders' | 'drafts' | 'settings' | 'shopSettings' | 'instagramConnect';

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`md-sidebar-item${active ? ' md-active' : ''}`} onClick={onClick}>
      <span className="md-sidebar-item-icon">{icon}</span>
      <span className="md-sidebar-item-label">{label}</span>
    </div>
  );
}

export default function MerchantDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { merchant, logout, isLoading } = useMerchantAuth();
  const [currentPage, setCurrentPage] = useState<DashPage>(() => {
    const p = searchParams.get('page');
    const valid: DashPage[] = ['home', 'reviews', 'billing', 'editPage', 'bulkUpload', 'orders', 'drafts', 'settings', 'shopSettings', 'instagramConnect'];
    return valid.includes(p as DashPage) ? (p as DashPage) : 'home';
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAvatarMenu) return;
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setShowAvatarMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAvatarMenu]);

  if (isLoading) {
    return (
      <div className="md-not-logged-in">
        <div className="md-nli-box">
          <div className="md-nli-icon">⏳</div>
          <h2>جاري التحقق من الجلسة...</h2>
        </div>
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="md-not-logged-in">
        <div className="md-nli-box">
          <div className="md-nli-icon">🏪</div>
          <h2>لوحة تحكم التاجر</h2>
          <p>سجّل دخولك للوصول إلى لوحة التحكم وإدارة متجرك</p>
          <button
            type="button"
            className="md-nli-login-btn"
            onClick={() => setShowLoginModal(true)}
          >
            تسجيل الدخول
          </button>
          <button type="button" className="md-nli-home-btn" onClick={() => navigate('/')}>
            العودة للرئيسية
          </button>
        </div>

        {showLoginModal && (
          <MerchantLoginModal
            onClose={() => setShowLoginModal(false)}
            onSuccess={() => setShowLoginModal(false)}
          />
        )}
      </div>
    );
  }

  const shop = merchant.shop;
  const displayInitial = (shop?.name ?? merchant.displayName ?? 'م').charAt(0);
  const today = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleGoToStore = () => {
    if (shop?.shop_id) {
      navigate(`/store/${shop.shop_id}`);
    } else {
      navigate('/store');
    }
  };

  const renderPage = () => {
    if (currentPage === 'instagramConnect') return <InstagramConnectPage />;
    if (currentPage === 'editPage') return <MerchantEditPage />;
    if (currentPage === 'reviews') return <MerchantReviews />;
    if (currentPage === 'billing') return <MerchantBilling />;
    if (currentPage === 'bulkUpload') return <BulkUploadPage />;
    if (currentPage === 'orders') return <MerchantOrders />;
    if (currentPage === 'drafts') return <DraftProductsPage />;
    if (currentPage === 'settings') return <MerchantSettings />;
    if (currentPage === 'shopSettings') return <MerchantShopSettings onNavigate={p => setCurrentPage(p as DashPage)} />;
    return <MerchantHome />;
  };

  return (
    <div className="md-root">
      {/* Top bar */}
      <header className="md-topbar">
        <div className="md-topbar-brand" onClick={handleGoToStore}>
          <img src="/logo.png" alt="سوق لينك" className="md-topbar-logo" />
          <div className="md-topbar-brand-text">سوق <span>لينك</span></div>
        </div>

        <div className="md-topbar-actions">
          <button type="button" className="md-topbar-bell" aria-label="الإشعارات">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          <div className="md-avatar-wrapper" ref={avatarRef}>
            <div
              className={`md-topbar-avatar${showAvatarMenu ? ' md-avatar-active' : ''}`}
              title={shop?.name ?? merchant.displayName}
              onClick={() => setShowAvatarMenu(v => !v)}
            >
              {displayInitial}
            </div>
            {showAvatarMenu && (
              <div className="md-avatar-menu">
                <div className="md-avatar-menu-header">
                  <div className="md-avatar-menu-name">{shop?.name ?? merchant.displayName}</div>
                  <div className="md-avatar-menu-email">{merchant.email}</div>
                </div>
                <button
                  type="button"
                  className="md-avatar-menu-item"
                  onClick={() => { setCurrentPage('shopSettings'); setShowAvatarMenu(false); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  إعدادات المتجر
                </button>
                <button
                  type="button"
                  className="md-avatar-menu-item"
                  onClick={() => { setCurrentPage('settings'); setShowAvatarMenu(false); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                  إعدادات الحساب
                </button>
                <button
                  type="button"
                  className="md-avatar-menu-item md-avatar-menu-logout"
                  onClick={() => { setShowAvatarMenu(false); handleLogout(); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="md-body">
        {/* Sidebar */}
        <aside className="md-sidebar">
          {/* Greeting */}
          <div className="md-sidebar-greeting">
            <div className="md-sidebar-greeting-name">مرحباً، <strong>{shop?.name ?? merchant.displayName}</strong></div>
            <div className="md-sidebar-greeting-date">{today}</div>
          </div>

          {/* Navigation */}
          <nav className="md-sidebar-nav">
            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              label="الرئيسية"
              active={currentPage === 'home'}
              onClick={() => setCurrentPage('home')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M9 17H5a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2h-4" />
                  <rect x="9" y="3" width="6" height="14" rx="1" />
                </svg>
              }
              label="الطلبات"
              active={currentPage === 'orders'}
              onClick={() => setCurrentPage('orders')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
              label="التقييمات"
              active={currentPage === 'reviews'}
              onClick={() => setCurrentPage('reviews')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              }
              label="الفواتير"
              active={currentPage === 'billing'}
              onClick={() => setCurrentPage('billing')}
            />

            <div className="md-sidebar-divider" />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="13" y2="17" />
                </svg>
              }
              label="المسودات"
              active={currentPage === 'drafts'}
              onClick={() => setCurrentPage('drafts')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              }
              label="إدارة المنتجات"
              active={currentPage === 'editPage'}
              onClick={() => setCurrentPage('editPage')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              }
              label="رفع بالجملة"
              active={currentPage === 'bulkUpload'}
              onClick={() => setCurrentPage('bulkUpload')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                  <circle cx="12" cy="12" r="4"/>
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                </svg>
              }
              label="ربط انستقرام"
              active={currentPage === 'instagramConnect'}
              onClick={() => setCurrentPage('instagramConnect')}
            />
          </nav>

          {/* User footer */}
          <div className="md-sidebar-footer">
            <div className="md-sidebar-user">
              <div className="md-sidebar-user-avatar">{displayInitial}</div>
              <div className="md-sidebar-user-info">
                <div className="md-sidebar-user-name">{shop?.name ?? merchant.displayName}</div>
                <div className="md-sidebar-user-role">SOUQ LINK Merchant</div>
              </div>
            </div>
            <button type="button" className="md-sidebar-logout" onClick={handleLogout}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              تسجيل الخروج
            </button>
          </div>
        </aside>

        {/* Content */}
        <main className="md-content">
          {renderPage()}
        </main>
      </div>

      <ChatBot role="merchant" />
    </div>
  );
}
