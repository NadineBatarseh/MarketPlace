export type FilterKey = 'categories' | 'price' | 'brands' | 'colors';

export interface FilterState {
  categories: boolean;
  price: boolean;
  brands: boolean;
  colors: boolean;
}

interface Props {
  openFilters: FilterState;
  activeColor: string;
  onToggleFilter: (key: FilterKey) => void;
  onColorChange: (color: string) => void;
}

const COLORS = [
  { color: '#2a7a3b', label: 'أخضر' },
  { color: '#3b5bdb', label: 'أزرق' },
  { color: '#c0392b', label: 'أحمر' },
  { color: '#4caf50', label: 'أخضر فاتح' },
  { color: '#009688', label: 'تركوازي' },
  { color: '#ffffff', label: 'أبيض', white: true },
];

const ChevronIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

export default function Sidebar({ openFilters, activeColor, onToggleFilter, onColorChange }: Props) {
  return (
    <aside className="sidebar">

      {/* Categories */}
      <div className="filter-card">
        <div
          className={`filter-header${openFilters.categories ? ' open' : ''}`}
          onClick={() => onToggleFilter('categories')}
        >
          <span>الفئات</span>
          <ChevronIcon />
        </div>
        {openFilters.categories && (
          <div className="filter-body">
            <label className="checkbox-item"><input type="checkbox" defaultChecked /> تيشيرتات</label>
            <label className="checkbox-item"><input type="checkbox" /> بناطيل</label>
            <label className="checkbox-item"><input type="checkbox" /> ملابس</label>
          </div>
        )}
      </div>

      {/* Price */}
      <div className="filter-card">
        <div
          className={`filter-header${openFilters.price ? ' open' : ''}`}
          onClick={() => onToggleFilter('price')}
        >
          <span>السعر</span>
          <ChevronIcon />
        </div>
        {openFilters.price && (
          <div className="filter-body">
            <div className="price-range">
              <div className="price-labels">
                <span>₪ 50</span>
                <span>₪ 1550</span>
              </div>
              <div className="range-track">
                <div className="range-fill"></div>
                <input type="range" min="0" max="1550" defaultValue="50" />
                <input type="range" min="0" max="1550" defaultValue="1550" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Brands */}
      <div className="filter-card">
        <div
          className={`filter-header${openFilters.brands ? ' open' : ''}`}
          onClick={() => onToggleFilter('brands')}
        >
          <span>العلامات التجارية</span>
          <ChevronIcon />
        </div>
        {openFilters.brands && (
          <div className="filter-body">
            <label className="checkbox-item"><input type="checkbox" /> النوارة</label>
            <label className="checkbox-item"><input type="checkbox" /> فلسطين تكس</label>
            <label className="checkbox-item"><input type="checkbox" /> كلاسيك</label>
          </div>
        )}
      </div>

      {/* Colors */}
      <div className="filter-card">
        <div
          className={`filter-header${openFilters.colors ? ' open' : ''}`}
          onClick={() => onToggleFilter('colors')}
        >
          <span>اللون</span>
          <ChevronIcon />
        </div>
        {openFilters.colors && (
          <div className="filter-body">
            <div className="color-swatches">
              {COLORS.map(({ color, label, white }) => (
                <div
                  key={color}
                  className={`swatch${activeColor === color ? ' active' : ''}${white ? ' white' : ''}`}
                  style={{ background: color }}
                  title={label}
                  onClick={() => onColorChange(color)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

    </aside>
  );
}
