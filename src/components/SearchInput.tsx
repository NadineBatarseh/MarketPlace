export default function SearchInput({
  value,
  onChange,
  placeholder = "ابحث...",
  className = "sp-nav-search",
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <svg
        className="sp-search-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
