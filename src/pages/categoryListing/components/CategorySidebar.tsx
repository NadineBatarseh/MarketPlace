import { useState } from 'react';
import type { FilterDef } from '../../singleStore/hooks/useSidebarData';
import type { GeneralFilters } from '../../singleStore/components/Sidebar';
import type { CategoryStore } from '../hooks/useCategoryData';

const VISIBLE_LIMIT = 5;

const COLOR_HEX: Record<string, string> = {
  'أحمر': '#e53935', 'أزرق': '#1e88e5', 'أخضر': '#43a047',
  'أصفر': '#fdd835', 'أسود': '#212121', 'أبيض': '#f5f5f5',
  'رمادي': '#757575', 'بنفسجي': '#8e24aa', 'برتقالي': '#fb8c00',
  'وردي': '#e91e63', 'بني': '#6d4c41', 'بيج': '#d7ccc8',
  'ذهبي': '#ffc107', 'فضي': '#bdbdbd', 'كحلي': '#1a237e',
  'زيتي': '#558b2f', 'تركواز': '#00acc1', 'بوردو': '#800020',
  'كاميل': '#c19a6b', 'خردل': '#d4a017', 'مرجاني': '#ff6f61',
  'نعناعي': '#3eb489', 'لافندر': '#b39ddb', 'سماوي': '#4fc3f7',
};

function getHex(nameOrHex: string): string {
  if (/^#/.test(nameOrHex)) return nameOrHex;
  return COLOR_HEX[nameOrHex] ?? '#9e9e9e';
}

interface Props {
  stores: CategoryStore[];
  selectedShopIds: string[];
  onShopsChange: (ids: string[]) => void;
  filterDefs: FilterDef[];
  filterValues: Record<string, string[]>;
  onFilterValuesChange: (values: Record<string, string[]>) => void;
  availableColors: string[];
  generalFilters: GeneralFilters;
  onGeneralFiltersChange: (gf: GeneralFilters) => void;
  loadingFilters: boolean;
}

export default function CategorySidebar({
  stores,
  selectedShopIds,
  onShopsChange,
  filterDefs,
  filterValues,
  onFilterValuesChange,
  availableColors,
  generalFilters,
  onGeneralFiltersChange,
  loadingFilters,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  const toggleCollapse = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  const setVal = (filterId: string, vals: string[]) =>
    onFilterValuesChange({ ...filterValues, [filterId]: vals });

  const toggleVal = (filterId: string, val: string, on: boolean) => {
    const cur = filterValues[filterId] ?? [];
    setVal(filterId, on ? [...cur, val] : cur.filter(v => v !== val));
  };

  const toggleStore = (shopId: string, checked: boolean) => {
    if (checked) {
      onShopsChange([...selectedShopIds, shopId]);
    } else {
      onShopsChange(selectedShopIds.filter(id => id !== shopId));
    }
  };

  // Active chips (dynamic filters only)
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];

  filterDefs.forEach(f => {
    (filterValues[f.id] ?? []).forEach(v => {
      const display = f.filter_type === 'boolean' ? f.filter_label_ar : v;
      activeChips.push({
        key: `${f.id}-${v}`,
        label: display,
        onRemove: () => setVal(f.id, (filterValues[f.id] ?? []).filter(x => x !== v)),
      });
    });
  });

  if (generalFilters.priceMin || generalFilters.priceMax) {
    const label = generalFilters.priceMin && generalFilters.priceMax
      ? `${generalFilters.priceMin}–${generalFilters.priceMax} ₪`
      : generalFilters.priceMin
        ? `من ${generalFilters.priceMin} ₪`
        : `حتى ${generalFilters.priceMax} ₪`;
    activeChips.push({
      key: 'price',
      label,
      onRemove: () => onGeneralFiltersChange({ ...generalFilters, priceMin: '', priceMax: '' }),
    });
  }

  if (generalFilters.inStockOnly) {
    activeChips.push({
      key: 'instock',
      label: 'متاح فقط',
      onRemove: () => onGeneralFiltersChange({ ...generalFilters, inStockOnly: false }),
    });
  }

  const clearAll = () => {
    onFilterValuesChange({});
    onGeneralFiltersChange({ priceMin: '', priceMax: '', inStockOnly: false });
    onShopsChange(stores.map(s => s.shop_id));
  };

  const allSelected = stores.every(s => selectedShopIds.includes(s.shop_id));

  return (
    <aside className="sidebar-panel">

      {/* ── Header ── */}
      <div className="sp-header">
        <span className="sp-header-title">
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
            <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          الفلاتر
        </span>
        {(activeChips.length > 0 || !allSelected) && (
          <button type="button" className="sp-clear-all" onClick={clearAll}>مسح الكل</button>
        )}
      </div>

      {/* ── Active chips ── */}
      {activeChips.length > 0 && (
        <div className="sp-active-chips">
          {activeChips.map(chip => (
            <span key={chip.key} className="sp-chip">
              {chip.label}
              <button type="button" className="sp-chip-x" onClick={chip.onRemove}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* ── Stores filter ── */}
      <div className="sp-section">
        <button type="button" className="sp-section-header" onClick={() => toggleCollapse('__stores')}>
          <span className="sp-section-title">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 5, verticalAlign: 'middle' }}>
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            المتاجر
          </span>
          <span className="sp-collapse-icon">{collapsed['__stores'] ? '+' : '−'}</span>
        </button>

        {!collapsed['__stores'] && (
          <>
            <div className="cat-store-actions">
              <button
                type="button"
                className="cat-store-btn"
                onClick={() => onShopsChange(stores.map(s => s.shop_id))}
              >
                تحديد الكل
              </button>
              <button
                type="button"
                className="cat-store-btn cat-store-btn--outline"
                onClick={() => onShopsChange([])}
              >
                إلغاء التحديد
              </button>
            </div>
            <div className="sp-check-list">
              {stores.map(store => {
                const checked = selectedShopIds.includes(store.shop_id);
                return (
                  <label
                    key={store.shop_id}
                    className={`sp-check-item${checked ? ' sp-check-item--active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="sp-check-input"
                      checked={checked}
                      onChange={e => toggleStore(store.shop_id, e.target.checked)}
                    />
                    <span className={`sp-check-box${checked ? ' sp-check-box--on' : ''}`}>
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <polyline points="1.5,5 4,7.5 8.5,2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="sp-check-label">
                      {store.name}
                      <span className="cat-store-count">({store.productCount})</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Price ── */}
      <div className="sp-section">
        <button type="button" className="sp-section-header" onClick={() => toggleCollapse('__price')}>
          <span className="sp-section-title">نطاق السعر</span>
          <span className="sp-collapse-icon">{collapsed['__price'] ? '+' : '−'}</span>
        </button>
        {!collapsed['__price'] && (
          <div className="sp-price-row">
            <div className="sp-price-box">
              <span className="sp-price-cur">₪</span>
              <input
                type="number" min={0} placeholder="من"
                className="sp-price-input"
                value={generalFilters.priceMin}
                aria-label="الحد الأدنى للسعر"
                title="الحد الأدنى للسعر"
                onChange={e => onGeneralFiltersChange({ ...generalFilters, priceMin: e.target.value })}
              />
            </div>
            <span className="sp-price-dash">—</span>
            <div className="sp-price-box">
              <span className="sp-price-cur">₪</span>
              <input
                type="number" min={0} placeholder="إلى"
                className="sp-price-input"
                value={generalFilters.priceMax}
                aria-label="الحد الأعلى للسعر"
                title="الحد الأعلى للسعر"
                onChange={e => onGeneralFiltersChange({ ...generalFilters, priceMax: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Availability ── */}
      <div className="sp-section">
        <button type="button" className="sp-section-header" onClick={() => toggleCollapse('__avail')}>
          <span className="sp-section-title">التوفر</span>
          <span className="sp-collapse-icon">{collapsed['__avail'] ? '+' : '−'}</span>
        </button>
        {!collapsed['__avail'] && (
          <label className="sp-toggle-row">
            <span className="sp-toggle-label">متاح في المخزون فقط</span>
            <span
              className={`sp-toggle${generalFilters.inStockOnly ? ' sp-toggle--on' : ''}`}
              onClick={() => onGeneralFiltersChange({ ...generalFilters, inStockOnly: !generalFilters.inStockOnly })}
              {...{ role: 'switch', 'aria-checked': generalFilters.inStockOnly ? 'true' : 'false' }}
              title="متاح في المخزون فقط"
              tabIndex={0}
              onKeyDown={e => e.key === ' ' && onGeneralFiltersChange({ ...generalFilters, inStockOnly: !generalFilters.inStockOnly })}
            >
              <span className="sp-toggle-thumb" />
            </span>
          </label>
        )}
      </div>

      {/* ── Dynamic filters ── */}
      {loadingFilters && <div className="sp-loading">جاري تحميل الفلاتر...</div>}

      {!loadingFilters && filterDefs.map(f => {
        const isCollapsed = collapsed[f.id] ?? false;
        const isShowAll = showAll[f.id] ?? false;

        return (
          <div key={f.id} className="sp-section">
            <button type="button" className="sp-section-header" onClick={() => toggleCollapse(f.id)}>
              <span className="sp-section-title">{f.filter_label_ar}</span>
              <span className="sp-collapse-icon">{isCollapsed ? '+' : '−'}</span>
            </button>

            {!isCollapsed && (
              <>
                {(f.filter_type === 'select' || f.filter_type === 'multiselect') && f.options && (() => {
                  const isMulti = f.filter_type === 'multiselect';
                  const visible = isShowAll ? f.options : f.options.slice(0, VISIBLE_LIMIT);
                  const hasMore = f.options.length > VISIBLE_LIMIT;
                  return (
                    <div className="sp-check-list">
                      {visible.map(opt => {
                        const active = isMulti
                          ? (filterValues[f.id] ?? []).includes(opt)
                          : (filterValues[f.id] ?? [])[0] === opt;
                        return (
                          <label key={opt} className={`sp-check-item${active ? ' sp-check-item--active' : ''}`}>
                            <input
                              type={isMulti ? 'checkbox' : 'radio'}
                              className="sp-check-input"
                              checked={active}
                              onChange={() => isMulti
                                ? toggleVal(f.id, opt, !active)
                                : setVal(f.id, active ? [] : [opt])
                              }
                            />
                            <span className={`sp-check-box${active ? ' sp-check-box--on' : ''}${!isMulti ? ' sp-check-box--radio' : ''}`}>
                              {active && isMulti && (
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                  <polyline points="1.5,5 4,7.5 8.5,2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                              {active && !isMulti && <span className="sp-radio-dot" />}
                            </span>
                            <span className="sp-check-label">{opt}</span>
                          </label>
                        );
                      })}
                      {hasMore && (
                        <button
                          type="button"
                          className="sp-view-more"
                          onClick={() => setShowAll(prev => ({ ...prev, [f.id]: !isShowAll }))}
                        >
                          {isShowAll
                            ? '− عرض أقل'
                            : `+ عرض المزيد (${f.options!.length - VISIBLE_LIMIT})`}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {f.filter_type === 'color' && availableColors.length > 0 && (() => {
                  const seenHex = new Set<string>();
                  const uniqueColors = availableColors.filter(name => {
                    const hex = getHex(name);
                    if (seenHex.has(hex)) return false;
                    seenHex.add(hex);
                    return true;
                  });
                  return (
                    <div className="sp-swatches">
                      {uniqueColors.map(colorName => {
                        const hex = getHex(colorName);
                        const active = (filterValues[f.id] ?? []).includes(colorName);
                        return (
                          <button
                            key={colorName} type="button"
                            className={`sp-swatch${active ? ' sp-swatch--active' : ''}${hex === '#f5f5f5' ? ' sp-swatch--white' : ''}`}
                            style={{ '--sp-swatch-bg': hex } as React.CSSProperties}
                            title={colorName}
                            aria-label={colorName}
                            onClick={() => toggleVal(f.id, colorName, !active)}
                          />
                        );
                      })}
                    </div>
                  );
                })()}

                {f.filter_type === 'boolean' && (
                  <label className="sp-toggle-row">
                    <span className="sp-toggle-label">نعم</span>
                    <span
                      className={`sp-toggle${(filterValues[f.id] ?? [])[0] === 'true' ? ' sp-toggle--on' : ''}`}
                      onClick={() => setVal(f.id, [(filterValues[f.id]?.[0] === 'true' ? 'false' : 'true')])}
                      {...{ role: 'switch', 'aria-checked': (filterValues[f.id] ?? [])[0] === 'true' ? 'true' : 'false' }}
                      title={f.filter_label_ar}
                      tabIndex={0}
                      onKeyDown={e => e.key === ' ' && setVal(f.id, [(filterValues[f.id]?.[0] === 'true' ? 'false' : 'true')])}
                    >
                      <span className="sp-toggle-thumb" />
                    </span>
                  </label>
                )}
              </>
            )}
          </div>
        );
      })}

    </aside>
  );
}
