import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './Topbar.css';
import { useShop } from '../context/ShopContext';
import { useMerchantAuth } from '../merchant-dashboard/context/MerchantAuthContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import ChangePasswordModal from './ChangePasswordModal';
import SearchInput from './SearchInput';
import { fetchUnreadOrderNotifications } from '../lib/orderNotifications';
import LanguageSwitcher from './LanguageSwitcher';

interface Props {
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onSearchSubmit?: (q: string) => void;
  currentUser?: { email?: string } | null;
  onUserClick?: () => void;
}

export default function Topbar({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
}: Props) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  const [navQuery, setNavQuery] = useState(
    pathname === '/search' ? (searchParams.get('q') ?? '') : ''
  );

  const { cartCount, favCount } = useShop();
  const { merchant, logout: merchantLogout } = useMerchantAuth();
  const { customer, logout: customerLogout } = useCustomerAuth();

  const [unreadOrderUpdates, setUnreadOrderUpdates] = useState(0);
  useEffect(() => {
    if (!customer) { setUnreadOrderUpdates(0); return; }
    let cancelled = false;
    fetchUnreadOrderNotifications(customer.id).then(res => {
      if (!cancelled) setUnreadOrderUpdates(res.total);
    });
    return () => { cancelled = true; };
  }, [customer, pathname]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchBarRef = useRef<HTMLDivElement>(null);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentQuery = searchQuery ?? navQuery;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (searchBarRef.current && !searchBarRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const q = currentQuery.trim();
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if (q.length < 2) { setSuggestions([]); setShowSuggest(false); return; }

    suggestDebounce.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/search/suggestions?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.ok && Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions);
          setShowSuggest(data.suggestions.length > 0);
          setActiveIdx(-1);
        }
      } catch { /* silent — suggestions are best-effort */ }
    }, 250);

    return () => { if (suggestDebounce.current) clearTimeout(suggestDebounce.current); };
  }, [currentQuery]);

  function handleSearchChange(q: string) {
    setNavQuery(q);
    if (onSearchChange) onSearchChange(q);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggest && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === 'Escape') { setShowSuggest(false); return; }
      if (e.key === 'Enter' && activeIdx >= 0) {
        submitSearch(suggestions[activeIdx]);
        return;
      }
    }
    if (e.key === 'Enter') submitSearch();
  }

  function submitSearch(term?: string) {
    const q = (term ?? currentQuery).trim();
    if (!q) return;
    setShowSuggest(false);
    if (term) {
      setNavQuery(term);
      if (onSearchChange) onSearchChange(term);
    }
    if (onSearchSubmit) { onSearchSubmit(q); return; }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  const handleLogout = async () => {
    if (merchant) merchantLogout();
    else if (customer) customerLogout();
    setDropdownOpen(false);
    navigate('/home');
  };

  const dashboardPath =
    merchant ? '/merchant-dashboard' :
    customer?.role === 'admin' ? '/admin-dashboard' :
    customer?.role === 'delivery' ? '/driver-dashboard' : null;

  const isCustomer = customer?.role === 'customer';

  const displayName = merchant?.displayName ?? customer?.displayName ?? null;
  const isAuthenticated = !!merchant || !!customer;

  const roleLabel =
    merchant ? t('roles.merchant') :
    customer?.role === 'admin' ? t('roles.admin') :
    customer?.role === 'delivery' ? t('roles.delivery') :
    t('roles.customer');

  return (
    <>
      <header className="topbar">
        {/* Logo */}
        <a href="#" className="logo" onClick={(e) => { e.preventDefault(); navigate('/home'); }}>
          <img src="/logo.png" alt="Souq Link" className="logo-img" />
          <div className="logo-text">
            <div className="ar">{t('logo.ar')}</div>
            <div className="en">{t('logo.en')}</div>
          </div>
        </a>

        {/* Nav links */}
        <nav className="topbar-nav-links">
          <span
            className={`topbar-nav-link${pathname === '/home' || pathname === '/' ? ' active' : ''}`}
            onClick={() => navigate('/home')}
          >{t('nav.home')}</span>
          <span
            className={`topbar-nav-link${pathname === '/stores-list' ? ' active' : ''}`}
            onClick={() => navigate('/stores-list')}
          >{t('nav.stores')}</span>
          <span className="topbar-nav-link">{t('nav.categories')}</span>
          <span className="topbar-nav-link">{t('nav.offers')}</span>
        </nav>

        {/* Search bar */}
        <div className="search-bar" ref={searchBarRef}>
          <SearchInput
            className="topbar-search-input"
            value={searchQuery ?? navQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('search.placeholder')}
          />
          <button
            className="search-submit-btn"
            onClick={() => submitSearch()}
            type="button"
            title={t('search.label')}
            aria-label={t('search.label')}
          >
            <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" width="14" height="14">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>

          {/* Autocomplete suggestions dropdown */}
          {showSuggest && suggestions.length > 0 && (
            <ul className="search-suggestions">
              {suggestions.map((s, i) => (
                <li
                  key={`${s}-${i}`}
                  className={`search-suggestion-item${i === activeIdx ? ' active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); submitSearch(s); }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <svg className="search-suggestion-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <nav className="nav-actions">
          {/* Home */}
          <div
            className={`nav-action nav-action--home${pathname === '/home' ? ' nav-action--active' : ''}`}
            onClick={() => navigate('/home')}
            title={t('nav.home')}
          >
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>

          {/* Wishlist — customers only */}
          {isCustomer && (
            <div
              className={`nav-action${pathname === '/favorites' ? ' nav-action--active' : ''}`}
              onClick={() => navigate('/favorites')}
              title={t('nav.favorites')}
            >
              {favCount > 0 && <div className="badge">{favCount}</div>}
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
          )}

          {/* Orders — customers only */}
          {isCustomer && (
            <div
              className={`nav-action${pathname === '/orders' ? ' nav-action--active' : ''}`}
              onClick={() => navigate('/orders')}
              title={t('nav.orders')}
            >
              {unreadOrderUpdates > 0 && <div className="badge">{unreadOrderUpdates}</div>}
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
              </svg>
            </div>
          )}

          {/* Cart — customers only */}
          {isCustomer && (
            <div
              className={`nav-action${pathname === '/cart' ? ' nav-action--active' : ''}`}
              onClick={() => navigate('/cart')}
              title={t('nav.cart')}
            >
              {cartCount > 0 && <div className="badge">{cartCount}</div>}
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </div>
          )}

          {/* Language switcher */}
          <LanguageSwitcher />

          {/* Account with dropdown */}
          <div className="nav-action-dropdown" ref={dropdownRef}>
            <button
              type="button"
              className="nav-action nav-action-btn"
              onClick={() => setDropdownOpen(v => !v)}
              title={displayName ?? t('account.title')}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              {customer && displayName && (
                <span className="nav-action-username">{displayName.split(' ')[0]}</span>
              )}
            </button>

            {/* Guest dropdown */}
            {dropdownOpen && !isAuthenticated && (
              <div className="topbar-dropdown">
                <button type="button" className="topbar-dropdown-item topbar-dropdown-item--login"
                  onClick={() => { navigate('/login'); setDropdownOpen(false); }}>
                  🔑 {t('account.login')}
                </button>
                <button type="button" className="topbar-dropdown-item"
                  onClick={() => { navigate('/signup'); setDropdownOpen(false); }}>
                  👤 {t('account.signup')}
                </button>
                <button type="button" className="topbar-dropdown-item"
                  onClick={() => { navigate('/merchant-application'); setDropdownOpen(false); }}>
                  🏪 {t('account.merchantApply')}
                </button>
                <button type="button" className="topbar-dropdown-item"
                  onClick={() => { navigate('/delivery-application'); setDropdownOpen(false); }}>
                  🚚 {t('account.deliveryApply')}
                </button>
                <button type="button" className="topbar-dropdown-item"
                  onClick={() => { navigate('/admin-dashboard'); setDropdownOpen(false); }}>
                  🛡️ {t('account.adminLogin')}
                </button>
              </div>
            )}

            {/* Logged-in dropdown */}
            {dropdownOpen && isAuthenticated && (
              <div className="topbar-dropdown">
                <div className="topbar-dropdown-name-row">
                  <div className="topbar-dropdown-name">{displayName}</div>
                  <div className="topbar-dropdown-role">{roleLabel}</div>
                </div>
                {dashboardPath && (
                  <button
                    type="button"
                    className="topbar-dropdown-item"
                    onClick={() => { navigate(dashboardPath); setDropdownOpen(false); }}
                  >
                    🏠 {t('account.dashboard')}
                  </button>
                )}
                {isCustomer && (
                  <button
                    type="button"
                    className="topbar-dropdown-item"
                    onClick={() => { navigate('/profile'); setDropdownOpen(false); }}
                  >
                    👤 {t('account.profile')}
                  </button>
                )}
                <button
                  type="button"
                  className="topbar-dropdown-item"
                  onClick={() => { setChangePasswordOpen(true); setDropdownOpen(false); }}
                >
                  🔑 {t('account.changePassword')}
                </button>
                <button
                  type="button"
                  className="topbar-dropdown-item topbar-dropdown-item--logout"
                  onClick={handleLogout}
                >
                  🚪 {t('account.logout')}
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      {changePasswordOpen && (
        <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />
      )}
    </>
  );
}
