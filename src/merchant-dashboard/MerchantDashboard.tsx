import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMerchantAuth } from './context/MerchantAuthContext';
import MerchantHome from './pages/MerchantHome';
import MerchantReviews from './pages/MerchantReviews';
import MerchantBilling from './pages/MerchantBilling';
import MerchantEditPage from './pages/MerchantEditPage';
import BulkUploadPage from './pages/BulkUploadPage';
import MerchantLoginModal from './components/MerchantLoginModal';
import './MerchantDashboard.css';

type DashPage = 'home' | 'reviews' | 'billing' | 'editPage' | 'bulkUpload';

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
      {icon}
      {label}
    </div>
  );
}

export default function MerchantDashboard() {
  const navigate = useNavigate();
  const { merchant, logout, isLoading } = useMerchantAuth();
  const [currentPage, setCurrentPage] = useState<DashPage>('home');
  const [showLoginModal, setShowLoginModal] = useState(false);

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
    if (currentPage === 'editPage') return <MerchantEditPage />;
    if (currentPage === 'reviews') return <MerchantReviews />;
    if (currentPage === 'billing') return <MerchantBilling />;
    if (currentPage === 'bulkUpload') return <BulkUploadPage />;
    return <MerchantHome />;
  };

  return (
    <div className="md-root">
      {/* Top bar */}
      <header className="md-topbar">
        <div className="md-topbar-logo md-topbar-logo--link" onClick={handleGoToStore}>
          سوق <span>لينك</span>
        </div>

        <div className="md-topbar-greeting">
          مرحباً، <strong>{shop?.name ?? merchant.displayName}</strong>
        </div>

        <div className="md-topbar-actions">
          <button type="button" className="md-logout-btn" onClick={handleLogout}>
            تسجيل الخروج
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="md-body">
        {/* Sidebar */}
        <aside className="md-sidebar">
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
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            }
            label="تعديل الصفحة"
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
        </aside>

        {/* Content */}
        <main className="md-content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
