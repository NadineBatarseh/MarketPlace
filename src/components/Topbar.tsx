import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import './Topbar.css';
import { useShop } from '../context/ShopContext';
import { useMerchantAuth } from '../merchant-dashboard/context/MerchantAuthContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import MerchantLoginModal from '../merchant-dashboard/components/MerchantLoginModal';
import CustomerLoginModal from './CustomerLoginModal';
import SearchInput from './SearchInput';

interface Props {
  /** Pass on store page to control in-store search filtering */
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onSearchSubmit?: (q: string) => void;
  /** Pass on product detail page for legacy user icon behaviour */
  currentUser?: { email?: string } | null;
  onUserClick?: () => void;
}

export default function Topbar({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  currentUser,
  onUserClick,
}: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  // Internal search state — seeded from URL on /search page
  const [navQuery, setNavQuery] = useState(
    pathname === '/search' ? (searchParams.get('q') ?? '') : ''
  );

  const { cartCount, favCount } = useShop();
  const { merchant, logout: merchantLogout } = useMerchantAuth();
  const { customer, logout: customerLogout } = useCustomerAuth();

  const isAuthenticated = !!merchant || !!customer;
  const displayName = merchant?.displayName ?? customer?.displayName ?? null;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleSearchChange(q: string) {
    setNavQuery(q);
    if (onSearchChange) onSearchChange(q);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const q = (searchQuery ?? navQuery).trim();
    if (!q) return;
    if (onSearchSubmit) { onSearchSubmit(q); return; }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  const handleMerchantLoginSuccess = () => {
    setMerchantModalOpen(false);
    setDropdownOpen(false);
    navigate('/merchant-dashboard');
  };

  const handleCustomerLoginSuccess = () => {
    setCustomerModalOpen(false);
    setDropdownOpen(false);
  };

  const handleLogout = () => {
    if (merchant) merchantLogout();
    else if (customer) customerLogout();
    setDropdownOpen(false);
    if (pathname.startsWith('/merchant-dashboard')) navigate('/store');
  };

  const dashboardPath =
    merchant ? '/merchant-dashboard' :
    customer?.role === 'admin' ? '/admin-dashboard' : null;

  return (
    <>
      <header className="topbar" dir="rtl">

        {/* ── Logo ── */}
        <a
          href="#"
          className="topbar-logo"
          onClick={(e) => { e.preventDefault(); navigate('/store'); }}
        >
          <img src="/logo.png" alt="Souq Link" className="topbar-logo-img" />
          <div className="topbar-logo-text">
            <div className="topbar-logo-ar">سوق لينك</div>
            <div className="topbar-logo-en">SOUQ LINK</div>
          </div>
        </a>

        {/* ── Search ── */}
        <div className="topbar-search">
          <SearchInput
            className="topbar-search-input"
            value={searchQuery ?? navQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="ابحث بالعربي أو الإنجليزي..."
          />
        </div>

        {/* ── Actions ── */}
        <nav className="topbar-actions">

          {/* Favorites */}
          <div
            className={`topbar-action${pathname === '/favorites' ? ' topbar-action--active' : ''}`}
            onClick={() => navigate('/favorites')}
            title="المفضلة"
          >
            {favCount > 0 && <div className="topbar-badge">{favCount}</div>}
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span>المفضلة</span>
          </div>

          {/* Orders */}
          <div className="topbar-action" title="الطلبات">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
            <span>الطلبات</span>
          </div>

          {/* Cart */}
          <div
            className={`topbar-action${pathname === '/cart' ? ' topbar-action--active' : ''}`}
            onClick={() => navigate('/cart')}
            title="السلة"
          >
            {cartCount > 0 && <div className="topbar-badge">{cartCount}</div>}
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span>السلة</span>
          </div>

          {/* Legacy product-detail user icon */}
          {onUserClick && (
            <div
              className={`topbar-action${currentUser ? ' topbar-action--active' : ''}`}
              onClick={onUserClick}
              title={currentUser?.email ?? 'تسجيل الدخول'}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>المستخدم</span>
            </div>
          )}

          {/* ── Account dropdown ── */}
          <div className="topbar-account-wrap" ref={dropdownRef}>
            <button
              type="button"
              className={`topbar-action topbar-action-btn${isAuthenticated ? ' topbar-action--logged-in' : ''}`}
              onClick={() => setDropdownOpen(v => !v)}
              title={displayName ?? 'الحساب'}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{displayName ?? 'الحساب'}</span>
            </button>

            {/* Guest dropdown */}
            {dropdownOpen && !isAuthenticated && (
              <div className="topbar-dropdown" dir="rtl">
                <div className="topbar-dropdown-header">تسجيل الدخول</div>
                <button
                  type="button"
                  className="topbar-dropdown-item topbar-dropdown-item--login"
                  onClick={() => { setCustomerModalOpen(true); setDropdownOpen(false); }}
                >
                  🛒 دخول / إنشاء حساب عميل
                </button>
                <button
                  type="button"
                  className="topbar-dropdown-item"
                  onClick={() => { setMerchantModalOpen(true); setDropdownOpen(false); }}
                >
                  🏪 تسجيل دخول كتاجر
                </button>
                <button
                  type="button"
                  className="topbar-dropdown-item"
                  onClick={() => { navigate('/admin-dashboard'); setDropdownOpen(false); }}
                >
                  🛡️ دخول كمشرف
                </button>
              </div>
            )}

            {/* Logged-in dropdown */}
            {dropdownOpen && isAuthenticated && (
              <div className="topbar-dropdown" dir="rtl">
                <div className="topbar-dropdown-header">
                  <div className="topbar-dropdown-name">{displayName}</div>
                  <div className="topbar-dropdown-role">{merchant ? 'تاجر' : 'عميل'}</div>
                </div>
                {dashboardPath && (
                  <button
                    type="button"
                    className="topbar-dropdown-item"
                    onClick={() => { navigate(dashboardPath); setDropdownOpen(false); }}
                  >
                    🏠 لوحة التحكم
                  </button>
                )}
                <button
                  type="button"
                  className="topbar-dropdown-item topbar-dropdown-item--logout"
                  onClick={handleLogout}
                >
                  🚪 تسجيل الخروج
                </button>
              </div>
            )}
          </div>

        </nav>
      </header>

      {merchantModalOpen && (
        <MerchantLoginModal
          onClose={() => setMerchantModalOpen(false)}
          onSuccess={handleMerchantLoginSuccess}
        />
      )}

      {customerModalOpen && (
        <CustomerLoginModal
          onClose={() => setCustomerModalOpen(false)}
          onSuccess={handleCustomerLoginSuccess}
        />
      )}
    </>
  );
}
