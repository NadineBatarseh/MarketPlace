import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useShop } from '../context/ShopContext';
import { useMerchantAuth } from '../merchant-dashboard/context/MerchantAuthContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import MerchantLoginModal from '../merchant-dashboard/components/MerchantLoginModal';
import CustomerLoginModal from './CustomerLoginModal';
import SearchInput from './SearchInput';
import './AppNav.css';

interface AppNavProps {
  /** Pass these only on the store page to show the search bar */
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  /** Pass these only on the product detail page to show a user icon */
  currentUser?: { email?: string } | null;
  onUserClick?: () => void;
}

export default function AppNav({
  searchQuery,
  onSearchChange,
  currentUser,
  onUserClick,
}: AppNavProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { cartCount, favCount } = useShop();
  const { merchant, logout: merchantLogout } = useMerchantAuth();
  const { customer, logout: customerLogout } = useCustomerAuth();

  const isAuthenticated = !!merchant || !!customer;

  const [loginDropdownOpen, setLoginDropdownOpen] = useState(false);
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setLoginDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMerchantLoginSuccess = () => {
    setMerchantModalOpen(false);
    setLoginDropdownOpen(false);
    navigate('/merchant-dashboard');
  };

  const handleCustomerLoginSuccess = () => {
    setCustomerModalOpen(false);
    setLoginDropdownOpen(false);
  };

  const handleLogout = () => {
    if (merchant) merchantLogout();
    else if (customer) customerLogout();
    setLoginDropdownOpen(false);
    if (pathname.startsWith('/merchant-dashboard')) navigate('/store');
  };

  const displayName = merchant?.displayName ?? customer?.displayName ?? null;

  return (
    <>
      <nav className="an-nav">
        {/* Logo */}
        <div className="an-logo" onClick={() => navigate('/store')}>
          سوق <span>لينك</span>
        </div>

        {/* Search — only rendered when the store page passes onSearchChange */}
        {onSearchChange && (
          <SearchInput
            className="an-search"
            value={searchQuery ?? ''}
            onChange={onSearchChange}
            placeholder="ابحث في المتجر..."
          />
        )}

        {/* Actions */}
        <div className="an-actions">
          {/* Favorites — only when authenticated */}
          {isAuthenticated && (
            <div
              className={`an-icon-btn${pathname === '/favorites' ? ' an-active' : ''}`}
              onClick={() => navigate('/favorites')}
              title="المفضلة"
            >
              {favCount > 0 && <div className="an-badge">{favCount}</div>}
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
          )}

          {/* Cart — only when authenticated */}
          {isAuthenticated && (
            <div
              className={`an-icon-btn${pathname === '/cart' ? ' an-active' : ''}`}
              onClick={() => navigate('/cart')}
              title="سلة التسوق"
            >
              {cartCount > 0 && <div className="an-badge">{cartCount}</div>}
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </div>
          )}

          {/* Product-detail user icon (existing behaviour) */}
          {onUserClick && (
            <div
              className={`an-icon-btn${currentUser ? ' an-logged-in' : ''}`}
              onClick={onUserClick}
              title={currentUser?.email ?? 'تسجيل الدخول'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}

          {/* ── Login / Account button ── */}
          <div className="an-login-wrap" ref={dropdownRef}>
            <div
              className={`an-icon-btn${isAuthenticated ? ' an-logged-in' : ''}${loginDropdownOpen ? ' an-active' : ''}`}
              onClick={() => setLoginDropdownOpen(o => !o)}
              title={displayName ?? 'تسجيل الدخول'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </div>

            {loginDropdownOpen && (
              <div className="an-login-dropdown">
                {isAuthenticated ? (
                  /* Logged-in menu */
                  <>
                    <div className="an-dropdown-header">
                      <div className="an-dropdown-name">{displayName}</div>
                      <div className="an-dropdown-role">
                        {merchant ? 'تاجر' : 'عميل'}
                      </div>
                    </div>
                    <div className="an-dropdown-divider" />
                    {merchant && (
                      <button
                        type="button"
                        className="an-dropdown-item"
                        onClick={() => { setLoginDropdownOpen(false); navigate('/merchant-dashboard'); }}
                      >
                        🏪 لوحة التحكم
                      </button>
                    )}
                    <button
                      type="button"
                      className="an-dropdown-item an-dropdown-danger"
                      onClick={handleLogout}
                    >
                      🚪 تسجيل الخروج
                    </button>
                  </>
                ) : (
                  /* Guest login options */
                  <>
                    <div className="an-dropdown-header">
                      <div className="an-dropdown-name">تسجيل الدخول</div>
                    </div>
                    <div className="an-dropdown-divider" />
                    <button
                      type="button"
                      className="an-dropdown-item"
                      onClick={() => { setLoginDropdownOpen(false); setCustomerModalOpen(true); }}
                    >
                      🛒 دخول / إنشاء حساب عميل
                    </button>
                    <button
                      type="button"
                      className="an-dropdown-item"
                      onClick={() => { setLoginDropdownOpen(false); setMerchantModalOpen(true); }}
                    >
                      🏪 تسجيل دخول كتاجر
                    </button>
                    <button
                      type="button"
                      className="an-dropdown-item"
                      onClick={() => { setLoginDropdownOpen(false); navigate('/admin-dashboard'); }}
                    >
                      🛡️ دخول كمشرف
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Merchant login modal */}
      {merchantModalOpen && (
        <MerchantLoginModal
          onClose={() => setMerchantModalOpen(false)}
          onSuccess={handleMerchantLoginSuccess}
        />
      )}

      {/* Customer login modal */}
      {customerModalOpen && (
        <CustomerLoginModal
          onClose={() => setCustomerModalOpen(false)}
          onSuccess={handleCustomerLoginSuccess}
        />
      )}
    </>
  );
}
