import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Topbar.css';
import { useCustomerAuth } from '../context/CustomerAuthContext';

interface Props {
  cartCount?: number;
}

export default function Topbar({ cartCount = 0 }: Props) {
  const { customer, logout } = useCustomerAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const dashboardPath =
    customer?.role === 'admin' ? '/admin-dashboard' :
    customer?.role === 'merchant' ? '/merchant-dashboard' : null;

  const handleLogout = async () => {
    await logout();
    setDropdownOpen(false);
    navigate('/stores');
  };

  return (
    <header className="topbar">
      <a href="#" className="logo">
        <img src="/logo.png" alt="Souq Link" className="logo-img" />
        <div className="logo-text">
          <div className="ar">سوق لينك</div>
          <div className="en">SOUQ LINK</div>
        </div>
      </a>

      <div className="search-bar">
        <input type="text" placeholder="ابحث  ..." />
        <div className="search-icon">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
      </div>

      <nav className="nav-actions">
        <a className="nav-action" href="#">
          <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span>Wishlist</span>
        </a>
        <a className="nav-action" href="#">
          <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
            <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
          </svg>
          <span>الطلبات</span>
        </a>
        <a className="nav-action" href="#">
          <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <span>السلة</span>
          {cartCount > 0 && <div className="badge">{cartCount}</div>}
        </a>

        {/* Account with dropdown */}
        <div className="nav-action-dropdown" ref={dropdownRef}>
          <button
            type="button"
            className="nav-action nav-action-btn"
            onClick={() => setDropdownOpen(v => !v)}
          >
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <span>{customer ? customer.displayName : 'الحساب'}</span>
          </button>

          {dropdownOpen && !customer && (
            <div className="topbar-dropdown" dir="rtl">
              <button type="button" className="topbar-dropdown-item topbar-dropdown-item--login"
                onClick={() => { navigate('/login'); setDropdownOpen(false); }}>
                🔑 تسجيل الدخول
              </button>
              <button type="button" className="topbar-dropdown-item"
                onClick={() => { navigate('/signup'); setDropdownOpen(false); }}>
                👤 إنشاء حساب
              </button>
              <button type="button" className="topbar-dropdown-item"
                onClick={() => { navigate('/merchant-application'); setDropdownOpen(false); }}>
                🏪 تقديم طلب كتاجر
              </button>
              <button type="button" className="topbar-dropdown-item"
                onClick={() => { navigate('/delivery-application'); setDropdownOpen(false); }}>
                🚚 تقديم طلب كمندوب
              </button>
              <button type="button" className="topbar-dropdown-item"
                onClick={() => { navigate('/hubworker-application'); setDropdownOpen(false); }}>
                📦 تقديم طلب كعامل مستودع
              </button>
            </div>
          )}

          {dropdownOpen && customer && (
            <div className="topbar-dropdown" dir="rtl">
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
  );
}
