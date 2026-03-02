import SearchInput from "../../../components/SearchInput";

export default function StoreNav({
  cartCount,
  searchQuery,
  onSearchChange,
}: {
  cartCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  return (
    <nav className="sp-nav">
      <div className="sp-nav-logo">سوق <span>لينك</span></div>
      <SearchInput value={searchQuery} onChange={onSearchChange} placeholder="ابحث في المتجر..." />
      <div className="sp-nav-actions">
        <div className="sp-nav-icon-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
        <div className="sp-nav-icon-btn">
          <div className="sp-badge">{cartCount}</div>
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        </div>
      </div>
    </nav>
  );
}
