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
import MerchantPayoutDetails from './pages/MerchantPayoutDetails';
import MerchantPayouts from './pages/MerchantPayouts';
import MerchantLoginModal from './components/MerchantLoginModal';
import ChangePasswordModal from '../components/ChangePasswordModal';
import InstagramConnectPage from './pages/InstagramConnectPage';
import ChatBot from '../components/chatbot/ChatBot';
import AdminMessagesInbox from '../components/AdminMessagesInbox';
import supabase from '../lib/supabase';
import './MerchantDashboard.css';

type DashPage = 'home' | 'reviews' | 'billing' | 'editPage' | 'bulkUpload' | 'orders' | 'drafts' | 'settings' | 'shopSettings' | 'instagramConnect' | 'inbox' | 'payoutDetails' | 'payouts';

function SidebarItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <div className={`md-sidebar-item${active ? ' md-active' : ''}`} onClick={onClick}>
      <span className="md-sidebar-item-icon">{icon}</span>
      <span className="md-sidebar-item-label">{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          marginRight: 'auto', background: '#2563eb', color: '#fff',
          borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 800,
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

export default function MerchantDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { merchant, logout, isLoading } = useMerchantAuth();
  const [highlightIncomplete, setHighlightIncomplete] = useState(false);
  const [currentPage, setCurrentPage] = useState<DashPage>(() => {
    const p = searchParams.get('page');
    const valid: DashPage[] = ['home', 'reviews', 'billing', 'editPage', 'bulkUpload', 'orders', 'drafts', 'settings', 'shopSettings', 'instagramConnect', 'inbox', 'payoutDetails', 'payouts'];
    return valid.includes(p as DashPage) ? (p as DashPage) : 'home';
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
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

  // Load unread message count for the bell badge
  useEffect(() => {
    if (!merchant) return;
    supabase
      .from('admin_messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', merchant.id)
      .is('read_at', null)
      .then(({ count }) => setUnreadMsgCount(count ?? 0));

    const ch = supabase
      .channel('md-admin-msgs-' + merchant.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_messages', filter: `recipient_id=eq.${merchant.id}` },
        () => setUnreadMsgCount(c => c + 1)
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [merchant?.id]);

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
  const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', {
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
    if (currentPage === 'payoutDetails') return <MerchantPayoutDetails />;
    if (currentPage === 'payouts') return <MerchantPayouts />;
    if (currentPage === 'shopSettings') return <MerchantShopSettings onNavigate={p => { setCurrentPage(p as DashPage); setHighlightIncomplete(false); }} highlightIncomplete={highlightIncomplete} />;
    if (currentPage === 'inbox') return <AdminMessagesInbox userId={merchant!.id} />;
    return <MerchantHome onNavigate={(p: string, highlight?: boolean) => { setCurrentPage(p as DashPage); setHighlightIncomplete(!!highlight); }} />;
  };

  return (
    <div className="md-root">
      {/* Top bar */}
      <header className="md-topbar">
        <div className="md-topbar-left">
          <button
            type="button"
            className="md-topbar-burger"
            aria-label="القائمة"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(v => !v)}
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="md-topbar-brand" onClick={handleGoToStore}>
            <img src="/logo.png" alt="سوق لينك" className="md-topbar-logo" />
            <div className="md-topbar-brand-text">سوق <span>لينك</span></div>
          </div>
        </div>

        <div className="md-topbar-actions">
          <button
            type="button"
            className="md-topbar-bell"
            aria-label="الرسائل"
            style={{ position: 'relative' }}
            onClick={() => { setCurrentPage('inbox'); setUnreadMsgCount(0); }}
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadMsgCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: '#EF4444', color: '#fff',
                borderRadius: 10, padding: '1px 5px',
                fontSize: 10, fontWeight: 800, lineHeight: 1.4,
                minWidth: 16, textAlign: 'center',
              }}>
                {unreadMsgCount}
              </span>
            )}
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
                  className="md-avatar-menu-item"
                  onClick={() => { setShowChangePassword(true); setShowAvatarMenu(false); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  تغيير كلمة المرور
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
        {/* Mobile overlay behind the drawer */}
        {sidebarOpen && (
          <div className="md-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <aside
          className={`md-sidebar${sidebarOpen ? ' md-sidebar-open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        >
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

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 10h18M7 15h2M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              }
              label="بيانات الدفع"
              active={currentPage === 'payoutDetails'}
              onClick={() => setCurrentPage('payoutDetails')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                  <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                  <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
                </svg>
              }
              label="أرباحي"
              active={currentPage === 'payouts'}
              onClick={() => setCurrentPage('payouts')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              }
              label="الرسائل"
              active={currentPage === 'inbox'}
              badge={unreadMsgCount}
              onClick={() => { setCurrentPage('inbox'); setUnreadMsgCount(0); }}
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

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
