import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';

interface ProductAttribute {
  attribute_name: string;
  attribute_value: string;
}

interface DBProduct {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  price: number;
  image_urls: string[] | null;
  stock_Quantity: number;
  capacity_units: number | null;
  category_id?: string | null;
  is_deleted?: boolean;
  discount_pct?: number | null;
  product_source?: string | null;
}

interface CategoryFilterDef {
  id: string;
  category_id: string;
  filter_key: string;
  filter_label_ar: string;
  filter_type: 'select' | 'multiselect' | 'color' | 'boolean';
  options: string[] | null;
  is_required: boolean;
  display_order: number;
}

type FilterValuesMap = Record<string, string[]>;

// Labels are UI-facing (not stored data) — resolved via t('editPage.capacityLabels.<n>') at render time.
const capacityLabelKey = (level: number) => `editPage.capacityLabels.${level}`;

const API_BASE = 'http://localhost:4000';

interface ProductForm {
  name: string;
  description: string;
  price: string;
  quantity: string;
  discount: string;
}

// Clamp a user-entered discount string to a valid 0–100 percentage, or null if empty.
function parseDiscountPct(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

interface VariantMatrix {
  colors: string[];
  sizes: string[];
  quantities: Record<string, Record<string, string>>;
  tableGenerated: boolean;
}

const EMPTY_MATRIX: VariantMatrix = {
  colors: [],
  sizes: [],
  quantities: {},
  tableGenerated: false,
};

// ── Color helpers ──────────────────────────────────────────────────────────────
// Arabic color name → hex (browsers can't parse Arabic, so we map manually)
const ARABIC_COLOR_MAP: Record<string, string> = {
  'أحمر': '#e53935', 'أزرق': '#1e88e5', 'أخضر': '#43a047', 'أصفر': '#fdd835',
  'أسود': '#212121', 'أبيض': '#f5f5f5', 'رمادي': '#757575', 'بنفسجي': '#8e24aa',
  'برتقالي': '#fb8c00', 'وردي': '#e91e63', 'بني': '#6d4c41', 'بيج': '#d7ccc8',
  'ذهبي': '#ffd600', 'فضي': '#bdbdbd', 'كحلي': '#1a237e', 'زيتي': '#558b2f',
  'تركواز': '#00acc1',
};

// Normalize Arabic: collapse alef variants, teh-marbuta, alef-maqsura, strip diacritics
function normalizeArabic(s: string): string {
  return s
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ٰٟ]/g, '');
}

// Pre-built normalized lookup — no iteration at runtime
const ARABIC_NORMALIZED: Record<string, string> = Object.fromEntries(
  Object.entries(ARABIC_COLOR_MAP).map(([k, v]) => [normalizeArabic(k), v])
);

// Module-level cache so the canvas isn't recreated on every render
const _parsedColorCache = new Map<string, string>();

// Ask the browser to parse any English/standard CSS color name via canvas fillStyle.
// The browser normalises recognised names to "#rrggbb"; unrecognised input leaves
// fillStyle unchanged (equal to the sentinel), so we can detect failure.
function parseBrowserColor(name: string): string | null {
  if (_parsedColorCache.has(name)) {
    const cached = _parsedColorCache.get(name)!;
    return cached === '' ? null : cached;
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sentinel = '#070b0d'; // an obscure dark tone no named color maps to
    ctx.fillStyle = sentinel;
    ctx.fillStyle = name;
    const result = ctx.fillStyle;
    const parsed = result !== sentinel ? result : null;
    _parsedColorCache.set(name, parsed ?? '');
    return parsed;
  } catch {
    return null;
  }
}

const getColorCss = (name: string): string => {
  const key = name.trim();
  if (!key) return '#9e9e9e';
  // 1. Exact Arabic map lookup
  if (ARABIC_COLOR_MAP[key]) return ARABIC_COLOR_MAP[key];
  // 2. Normalized Arabic (handles missing hamza, diacritics, etc.)
  const normAr = normalizeArabic(key);
  if (ARABIC_NORMALIZED[normAr]) return ARABIC_NORMALIZED[normAr];
  // 3. Bare hex code
  if (/^#[0-9a-f]{3,8}$/i.test(key)) return key;
  // 4. Let the browser parse any CSS named colour (royalblue, cornflowerblue, etc.)
  const browserResult = parseBrowserColor(key.toLowerCase());
  if (browserResult) return browserResult;
  // 5. Unknown — neutral gray dot
  return '#9e9e9e';
};

// ── Predefined color palette ──────────────────────────────────────────────────
const PREDEFINED_COLORS = [
  { name: 'أحمر',    hex: '#e53935' },
  { name: 'أزرق',    hex: '#1e88e5' },
  { name: 'أخضر',    hex: '#43a047' },
  { name: 'أصفر',    hex: '#fdd835' },
  { name: 'أسود',    hex: '#1a1a1a' },
  { name: 'أبيض',    hex: '#f5f5f5' },
  { name: 'رمادي',   hex: '#9e9e9e' },
  { name: 'وردي',    hex: '#e91e63' },
  { name: 'بنفسجي',  hex: '#8e24aa' },
  { name: 'برتقالي', hex: '#fb8c00' },
  { name: 'بني',     hex: '#6d4c41' },
  { name: 'بيج',     hex: '#d7ccc8' },
  { name: 'كحلي',    hex: '#1a237e' },
  { name: 'زيتي',    hex: '#558b2f' },
  { name: 'تركواز',  hex: '#00acc1' },
  { name: 'ذهبي',    hex: '#ffc107' },
  { name: 'فضي',     hex: '#bdbdbd' },
  { name: 'بوردو',   hex: '#800020' },
  { name: 'كاميل',   hex: '#c19a6b' },
  { name: 'خردل',    hex: '#d4a017' },
  { name: 'مرجاني',  hex: '#ff6f61' },
  { name: 'نعناعي',  hex: '#3eb489' },
  { name: 'لافندر',  hex: '#b39ddb' },
  { name: 'سماوي',   hex: '#4fc3f7' },
];

// Stored format: "Name|#hex" for palette/custom colors, or plain name for legacy data
function parseColorEntry(raw: string): { name: string; hex: string } {
  const idx = raw.lastIndexOf('|');
  if (idx > -1) return { name: raw.slice(0, idx), hex: raw.slice(idx + 1) };
  return { name: raw, hex: getColorCss(raw) };
}

// ── ColorPicker ────────────────────────────────────────────────────────────────
function ColorPicker({ colors, onChange }: {
  colors: string[];
  onChange: (colors: string[]) => void;
}) {
  const { t } = useTranslation('merchant');
  const [showCustom, setShowCustom] = useState(false);
  const [customHex, setCustomHex] = useState('#3b82f6');
  const [customName, setCustomName] = useState('');
  const [paletteMsg, setPaletteMsg] = useState('');
  const [customNameError, setCustomNameError] = useState('');
  const paletteMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Normalize for comparison: collapse Arabic alef variants + lowercase
  const normKey = (s: string) => normalizeArabic(s.trim().toLowerCase());

  const isNameTaken = (name: string) =>
    colors.some(existing => normKey(parseColorEntry(existing).name) === normKey(name));

  const showPaletteMsg = (msg: string) => {
    if (paletteMsgTimer.current) clearTimeout(paletteMsgTimer.current);
    setPaletteMsg(msg);
    paletteMsgTimer.current = setTimeout(() => setPaletteMsg(''), 2500);
  };

  const handlePredefinedClick = (c: { name: string; hex: string }) => {
    if (isNameTaken(c.name)) {
      showPaletteMsg(t('editPage.colorPicker.alreadySelectedMsg', { name: c.name }));
    } else {
      onChange([...colors, `${c.name}|${c.hex}`]);
    }
  };

  const removeColor = (idx: number) => onChange(colors.filter((_, i) => i !== idx));

  const addCustom = () => {
    const name = customName.trim();
    if (!name) {
      setCustomNameError(t('editPage.colorPicker.nameRequired'));
      return;
    }
    if (isNameTaken(name)) {
      setCustomNameError(t('editPage.colorPicker.nameTaken', { name }));
      return;
    }
    onChange([...colors, `${name}|${customHex}`]);
    setShowCustom(false);
    setCustomName('');
    setCustomNameError('');
    setCustomHex('#3b82f6');
  };

  const closeCustom = () => {
    setShowCustom(false);
    setCustomName('');
    setCustomNameError('');
    setCustomHex('#3b82f6');
  };

  return (
    <div className="color-picker-wrap">
      <span className="tag-input-label">{t('editPage.colorPicker.availableColors')}</span>

      {colors.length > 0 && (
        <div className="color-chips-row">
          {colors.map((c, i) => {
            const { name, hex } = parseColorEntry(c);
            return (
              <span key={i} className="tag-chip tag-chip--color">
                <span className="tag-chip-dot" style={{ '--chip-color': hex } as React.CSSProperties} />
                {name}
                <button type="button" className="tag-chip-remove"
                  onClick={() => removeColor(i)}>×</button>
              </span>
            );
          })}
        </div>
      )}

      <div className="color-palette">
        {PREDEFINED_COLORS.map(c => (
          <button
            key={c.hex}
            type="button"
            className="palette-circle"
            style={{ '--palette-color': c.hex } as React.CSSProperties}
            onClick={() => handlePredefinedClick(c)}
            title={c.name}
            aria-label={c.name}
          />
        ))}
        <button
          type="button"
          className="palette-custom-btn"
          onClick={() => { setShowCustom(v => !v); setCustomNameError(''); }}
          title={t('editPage.colorPicker.customColorTitle')}
        >+</button>
      </div>

      {paletteMsg && (
        <span className="color-picker-msg">{paletteMsg}</span>
      )}

      {showCustom && (
        <div className="custom-color-form">
          <input
            type="color"
            value={customHex}
            onChange={e => setCustomHex(e.target.value)}
            className="custom-color-input"
            aria-label={t('editPage.colorPicker.chooseCustomColorAria')}
          />
          <div className="custom-color-name-wrap">
            <input
              type="text"
              placeholder={t('editPage.colorPicker.colorNamePlaceholder')}
              value={customName}
              onChange={e => { setCustomName(e.target.value); setCustomNameError(''); }}
              className={`custom-color-name${customNameError ? ' custom-color-name--error' : ''}`}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
            />
            {customNameError && (
              <span className="custom-color-name-error">{customNameError}</span>
            )}
          </div>
          <button type="button" className="custom-color-add-btn" onClick={addCustom}>{t('editPage.colorPicker.addBtn')}</button>
          <button type="button" className="custom-color-cancel-btn" onClick={closeCustom}>{t('editPage.common.cancel')}</button>
        </div>
      )}
      <span className="tag-input-hint">{t('editPage.colorPicker.hint')}</span>
    </div>
  );
}

// ── TagInput ───────────────────────────────────────────────────────────────────
function TagInput({ tags, onChange, placeholder, hint, label, isColor = false }: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  hint: string;
  label: string;
  isColor?: boolean;
}) {
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commitTags = (raw: string) => {
    const parts = raw.split(/[,،\n]+/).map(s => s.trim()).filter(Boolean);
    const next = [...tags];
    parts.forEach(t => { if (!next.includes(t)) next.push(t); });
    if (next.length !== tags.length) onChange(next);
    setInputVal('');
  };

  const removeTag = (idx: number) => onChange(tags.filter((_, i) => i !== idx));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputVal.trim()) commitTags(inputVal);
    } else if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.includes(',') || val.includes('،')) {
      const parts = val.split(/[,،]+/);
      const toAdd = parts.slice(0, -1).map(s => s.trim()).filter(Boolean);
      if (toAdd.length > 0) {
        const next = [...tags];
        toAdd.forEach(t => { if (!next.includes(t)) next.push(t); });
        onChange(next);
      }
      setInputVal(parts[parts.length - 1]);
    } else {
      setInputVal(val);
    }
  };

  return (
    <div className="tag-input-wrapper">
      <span className="tag-input-label">{label}</span>
      <div className="tag-input-field" onClick={() => inputRef.current?.focus()}>
        {tags.map((tag, i) => (
          <span key={i} className={`tag-chip${isColor ? ' tag-chip--color' : ''}`}>
            {isColor && (
              <span className="tag-chip-dot" style={{ '--chip-color': getColorCss(tag) } as React.CSSProperties} />
            )}
            {tag}
            <button
              type="button"
              className="tag-chip-remove"
              onClick={e => { e.stopPropagation(); removeTag(i); }}
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-input-el"
          value={inputVal}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (inputVal.trim()) commitTags(inputVal); }}
          placeholder={tags.length === 0 ? placeholder : ''}
        />
      </div>
      <span className="tag-input-hint">{hint}</span>
    </div>
  );
}

// ── VariantMatrixEditor ────────────────────────────────────────────────────────
function VariantMatrixEditor({ matrix, onChange }: {
  matrix: VariantMatrix;
  onChange: (m: VariantMatrix) => void;
}) {
  const { t } = useTranslation('merchant');
  const handleColorsChange = (newColors: string[]) => {
    const removed = matrix.colors.filter(c => !newColors.includes(c));
    const newQty = { ...matrix.quantities };
    removed.forEach(c => delete newQty[c]);
    const stillGenerated = matrix.tableGenerated && newColors.length > 0 && matrix.sizes.length > 0;
    onChange({ ...matrix, colors: newColors, quantities: newQty, tableGenerated: stillGenerated });
  };

  const handleSizesChange = (newSizes: string[]) => {
    const removed = matrix.sizes.filter(s => !newSizes.includes(s));
    const newQty: Record<string, Record<string, string>> = {};
    Object.entries(matrix.quantities).forEach(([color, sizeMap]) => {
      const m2 = { ...sizeMap };
      removed.forEach(s => delete m2[s]);
      newQty[color] = m2;
    });
    const stillGenerated = matrix.tableGenerated && matrix.colors.length > 0 && newSizes.length > 0;
    onChange({ ...matrix, sizes: newSizes, quantities: newQty, tableGenerated: stillGenerated });
  };

  const setQty = (color: string, size: string, qty: string) => {
    onChange({
      ...matrix,
      quantities: {
        ...matrix.quantities,
        [color]: { ...(matrix.quantities[color] ?? {}), [size]: qty },
      },
    });
  };

  const canGenerate = matrix.colors.length > 0 && matrix.sizes.length > 0;
  const showTable = matrix.tableGenerated && canGenerate;

  return (
    <div className="var-matrix">
      {/* ── Inputs section ── */}
      <div className="var-matrix-inputs-section">
        <div className="var-matrix-section-title">{t('editPage.variantMatrix.sectionTitle')}</div>
        <div className="var-matrix-fields">
          <ColorPicker colors={matrix.colors} onChange={handleColorsChange} />
          <TagInput
            label={t('editPage.variantMatrix.sizesLabel')}
            tags={matrix.sizes}
            onChange={handleSizesChange}
            placeholder={t('editPage.variantMatrix.sizesPlaceholder')}
            hint={t('editPage.variantMatrix.sizesHint')}
          />
        </div>
      </div>

      {/* ── Generate button ── */}
      {canGenerate && !showTable && (
        <div className="var-matrix-generate-section">
          <button
            type="button"
            className="var-matrix-generate-btn"
            onClick={() => onChange({ ...matrix, tableGenerated: true })}
          >
            {t('editPage.variantMatrix.generateBtn')}
            <span className="var-matrix-btn-arrow">←</span>
          </button>
          <p className="var-matrix-generate-hint">
            {t('editPage.variantMatrix.generateHint', {
              colors: matrix.colors.length,
              sizes: matrix.sizes.length,
              cells: matrix.colors.length * matrix.sizes.length,
            })}
          </p>
        </div>
      )}

      {/* ── Quantity matrix table ── */}
      {showTable && (
        <div className="var-matrix-table-section">
          <div className="var-matrix-table-label">
            {t('editPage.variantMatrix.tableLabel')}
          </div>
          <div className="var-matrix-table-wrap">
            <table className="var-matrix-table">
              <thead>
                <tr>
                  <th className="var-matrix-corner">{t('editPage.variantMatrix.tableCorner')}</th>
                  {matrix.sizes.map(size => <th key={size}>{size}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.colors.map((colorVal, ri) => {
                  const { name: colorName, hex: colorHex } = parseColorEntry(colorVal);
                  return (
                    <tr key={colorVal} className={ri % 2 === 1 ? 'var-matrix-row-alt' : ''}>
                      <td className="var-matrix-color-cell">
                        <div className="var-matrix-color-inner">
                          <span
                            className="var-matrix-cell-dot"
                            style={{ '--dot-color': colorHex } as React.CSSProperties}
                          />
                          {colorName}
                        </div>
                      </td>
                      {matrix.sizes.map(size => (
                        <td key={size} className="var-matrix-qty-cell">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={matrix.quantities[colorVal]?.[size] ?? ''}
                            onChange={e => setQty(colorVal, size, e.target.value)}
                            className="var-matrix-qty"
                            aria-label={t('editPage.variantMatrix.qtyAria', { color: colorName, size })}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AttributesEditor ──────────────────────────────────────────────────────────
function AttributesEditor({ attributes, onChange }: {
  attributes: ProductAttribute[];
  onChange: (attrs: ProductAttribute[]) => void;
}) {
  const { t } = useTranslation('merchant');
  const [nameInput, setNameInput] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [inputError, setInputError] = useState('');

  const add = () => {
    const name = nameInput.trim();
    const value = valueInput.trim();
    if (!name || !value) { setInputError(t('editPage.attributes.missingFields')); return; }
    if (attributes.some(a => a.attribute_name === name)) {
      setInputError(t('editPage.attributes.alreadyExists', { name }));
      return;
    }
    onChange([...attributes, { attribute_name: name, attribute_value: value }]);
    setNameInput('');
    setValueInput('');
    setInputError('');
  };

  const remove = (idx: number) => onChange(attributes.filter((_, i) => i !== idx));

  return (
    <div className="attr-editor">
      <span className="tag-input-label">{t('editPage.attributes.sectionTitle')}</span>

      {attributes.length > 0 && (
        <div className="attr-list">
          {attributes.map((a, i) => (
            <div key={i} className="attr-row">
              <span className="attr-name">{a.attribute_name}</span>
              <span className="attr-sep">:</span>
              <span className="attr-value">{a.attribute_value}</span>
              <button type="button" className="attr-remove" onClick={() => remove(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="attr-add-row">
        <input
          type="text"
          className="attr-input"
          placeholder={t('editPage.attributes.namePlaceholder')}
          value={nameInput}
          onChange={e => { setNameInput(e.target.value); setInputError(''); }}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <input
          type="text"
          className="attr-input"
          placeholder={t('editPage.attributes.valuePlaceholder')}
          value={valueInput}
          onChange={e => { setValueInput(e.target.value); setInputError(''); }}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button type="button" className="attr-add-btn" onClick={add}>{t('editPage.attributes.addBtn')}</button>
      </div>
      {inputError && <span className="attr-error">{inputError}</span>}
    </div>
  );
}

// ── CategoryFiltersSection ─────────────────────────────────────────────────────
function CategoryFiltersSection({
  filters,
  values,
  onChange,
}: {
  filters: CategoryFilterDef[];
  values: FilterValuesMap;
  onChange: (v: FilterValuesMap) => void;
}) {
  const { t } = useTranslation('merchant');
  const setVal = (id: string, vals: string[]) => onChange({ ...values, [id]: vals });

  const visibleFilters = filters.filter(f => f.filter_type !== 'color');
  if (visibleFilters.length === 0) return null;

  return (
    <div className="cat-filters-section">
      <div className="cat-filters-title">{t('editPage.categoryFilters.sectionTitle')}</div>
      {visibleFilters.map(f => (
        <div key={f.id} className="cat-filter-field">
          <label className="cat-filter-label">
            {f.filter_label_ar}
            {f.is_required && <span className="cat-filter-required"> *</span>}
          </label>

          {f.filter_type === 'select' && f.options && (
            <select
              className="cat-filter-select"
              title={f.filter_label_ar}
              aria-label={f.filter_label_ar}
              value={values[f.id]?.[0] ?? ''}
              onChange={e => setVal(f.id, e.target.value ? [e.target.value] : [])}
            >
              <option value="">{t('editPage.categoryFilters.selectPlaceholder')}</option>
              {f.options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}

          {f.filter_type === 'multiselect' && f.options && (
            <div className="cat-filter-checkboxes">
              {f.options.map(opt => {
                const checked = (values[f.id] ?? []).includes(opt);
                return (
                  <label key={opt} className="cat-filter-checkbox-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        const cur = values[f.id] ?? [];
                        setVal(f.id, e.target.checked
                          ? [...cur, opt]
                          : cur.filter(v => v !== opt));
                      }}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}

          {f.filter_type === 'boolean' && (
            <label className="cat-filter-bool">
              <input
                type="checkbox"
                checked={values[f.id]?.[0] === 'true'}
                onChange={e => setVal(f.id, [String(e.target.checked)])}
              />
              <span>{t('editPage.categoryFilters.yesLabel')}</span>
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

// ── EditProductModal ───────────────────────────────────────────────────────────
function EditProductModal({ product, onSave, onClose }: {
  product: DBProduct;
  onSave: (p: DBProduct) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('merchant');
  const [form, setForm] = useState<ProductForm>({
    name: product.title,
    description: product.description ?? '',
    price: String(product.price),
    quantity: String(product.stock_Quantity),
    discount: product.discount_pct != null ? String(product.discount_pct) : '',
  });
  const [existingUrls, setExistingUrls] = useState<string[]>(product.image_urls ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [capacityUnits, setCapacityUnits] = useState<number>(product.capacity_units ?? 3);
  const [matrix, setMatrix] = useState<VariantMatrix>(EMPTY_MATRIX);
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [catFilters, setCatFilters] = useState<CategoryFilterDef[]>([]);
  const [filterValues, setFilterValues] = useState<FilterValuesMap>({});
  const [catFiltersLoading, setCatFiltersLoading] = useState(false);
  const [catFiltersError, setCatFiltersError] = useState('');

  // Auto-resolve shop's category from Type_of_store → categories.label
  useEffect(() => {
    supabase.from('shops').select('Type_of_store').eq('shop_id', product.shop_id).single()
      .then(async ({ data: shopData }) => {
        if (!shopData?.Type_of_store) return;
        const { data: catData } = await supabase
          .from('categories').select('id').eq('label', shopData.Type_of_store).single();
        if (catData?.id) setCategoryId(catData.id as string);
      });
  }, [product.shop_id]);

  useEffect(() => {
    supabase.from('product_filter_values')
      .select('filter_id, value')
      .eq('product_id', product.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const map: FilterValuesMap = {};
        data.forEach((row: { filter_id: string; value: string }) => {
          if (!map[row.filter_id]) map[row.filter_id] = [];
          map[row.filter_id].push(row.value);
        });
        setFilterValues(map);
      });
  }, [product.id]);

  useEffect(() => {
    if (!categoryId) {
      setCatFilters([]);
      setCatFiltersError('');
      return;
    }
    setCatFiltersLoading(true);
    setCatFiltersError('');
    supabase
      .from('category_filter_definitions')
      .select('*')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: true })
      .then(({ data, error: fetchError }) => {
        setCatFiltersLoading(false);
        if (fetchError) {
          setCatFiltersError(fetchError.message);
          setCatFilters([]);
          return;
        }
        setCatFilters((data ?? []) as CategoryFilterDef[]);
      });
  }, [categoryId]);

  useEffect(() => {
    supabase
      .from('product_attributes')
      .select('attribute_name, attribute_value')
      .eq('product_id', product.id)
      .then(({ data }) => {
        if (data && data.length > 0) setAttributes(data as ProductAttribute[]);
      });
  }, [product.id]);

  useEffect(() => {
    supabase
      .from('product_variants')
      .select('color, size, quantity')
      .eq('product_id', product.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const colors = [...new Set(data.map(v => v.color).filter((c): c is string => !!c))];
        const sizes = [...new Set(data.map(v => v.size).filter((s): s is string => !!s))];
        const quantities: Record<string, Record<string, string>> = {};
        data.forEach(v => {
          if (v.color && v.size) {
            if (!quantities[v.color]) quantities[v.color] = {};
            quantities[v.color][v.size] = String(v.quantity ?? 0);
          }
        });
        setMatrix({
          colors,
          sizes,
          quantities,
          tableGenerated: colors.length > 0 && sizes.length > 0,
        });
      });
  }, [product.id]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';
    const previews = files.map(f => URL.createObjectURL(f));
    setPendingFiles(prev => [...prev, ...files]);
    setPreviewUrls(prev => [...prev, ...previews]);
  };

  const removeExisting = (idx: number) =>
    setExistingUrls(prev => prev.filter((_, i) => i !== idx));

  const removeNew = (idx: number) => {
    URL.revokeObjectURL(previewUrls[idx]);
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
    setPreviewUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.price.trim() || !form.quantity.trim()) {
      setError(t('editPage.modal.missingRequiredFields'));
      return;
    }

    setSaving(true);
    setError('');

    const uploadedUrls: string[] = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${product.id}/${Date.now()}_${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true });
      if (uploadErr) { setError(t('editPage.modal.uploadImageError', { message: uploadErr.message })); continue; }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    const removedUrls = (product.image_urls ?? []).filter(u => !existingUrls.includes(u));
    for (const url of removedUrls) {
      const storagePath = url.split('/product-images/')[1];
      if (storagePath) await supabase.storage.from('product-images').remove([storagePath]);
    }

    const finalUrls = [...existingUrls, ...uploadedUrls];

    const { error: updateErr } = await supabase
      .from('products')
      .update({
        title: form.name.trim(),
        description: form.description.trim() || null,
        price: parseFloat(form.price) || 0,
        stock_Quantity: parseInt(form.quantity) || 0,
        image_urls: finalUrls.length > 0 ? finalUrls : null,
        capacity_units: capacityUnits,
        category_id: categoryId || null,
        discount_pct: parseDiscountPct(form.discount),
      })
      .eq('id', product.id);

    if (updateErr) {
      setError(t('editPage.modal.updateProductError', { message: updateErr.message }));
      setSaving(false);
      return;
    }

    await supabase.from('product_variants').delete().eq('product_id', product.id);

    if (matrix.colors.length > 0 && matrix.sizes.length > 0) {
      const rows = matrix.colors.flatMap(color =>
        matrix.sizes.map(size => ({
          product_id: product.id,
          color: parseColorEntry(color).name,
          size,
          quantity: parseInt(matrix.quantities[color]?.[size] ?? '0') || 0,
        }))
      );
      const { error: varErr } = await supabase.from('product_variants').insert(rows);
      if (varErr) {
        setError(t('editPage.modal.saveVariantsError', { message: varErr.message }));
        setSaving(false);
        return;
      }
    }

    await supabase.from('product_attributes').delete().eq('product_id', product.id);
    if (attributes.length > 0) {
      const attrRows = attributes.map(a => ({ product_id: product.id, attribute_name: a.attribute_name, attribute_value: a.attribute_value }));
      const { error: attrErr } = await supabase.from('product_attributes').insert(attrRows);
      if (attrErr) {
        setError(t('editPage.modal.saveAttributesError', { message: attrErr.message }));
        setSaving(false);
        return;
      }
    }

    const { error: delFilterErr } = await supabase.from('product_filter_values').delete().eq('product_id', product.id);
    if (delFilterErr) console.error('[EditModal] delete filter values error:', delFilterErr.message);

    const filterRows: { product_id: string; filter_id: string; value: string }[] = [];
    Object.entries(filterValues).forEach(([fid, vals]) => {
      vals.forEach(v => { if (v) filterRows.push({ product_id: product.id, filter_id: fid, value: v }); });
    });
    console.log('[EditModal] filterRows to save:', filterRows);
    if (filterRows.length > 0) {
      const { error: filterInsertErr } = await supabase.from('product_filter_values').insert(filterRows);
      if (filterInsertErr) {
        setError(t('editPage.modal.saveCategoryFiltersError', { message: filterInsertErr.message }));
        setSaving(false);
        return;
      }
    }

    previewUrls.forEach(url => URL.revokeObjectURL(url));
    onSave({
      ...product,
      title: form.name.trim(),
      description: form.description.trim() || null,
      price: parseFloat(form.price) || 0,
      stock_Quantity: parseInt(form.quantity) || 0,
      image_urls: finalUrls.length > 0 ? finalUrls : null,
      capacity_units: capacityUnits,
      category_id: categoryId || null,
      discount_pct: parseDiscountPct(form.discount),
    });
    onClose();
  };

  return (
    <div className="apm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="apm-modal">
        <div className="apm-header">
          <h3>{t('editPage.modal.editTitle')}</h3>
          <button type="button" className="apm-close" onClick={onClose}>✕</button>
        </div>

        <div className="apm-fields">
          <div className="apm-field">
            <label>{t('editPage.modal.imagesLabel')}</label>
            <div className="apm-imgs-row">
              {existingUrls.map((url, idx) => (
                <div key={`ex-${idx}`} className="apm-img-thumb">
                  <img src={url} alt={t('editPage.modal.imageAlt', { index: idx + 1 })} />
                  <button type="button" className="apm-img-remove" onClick={() => removeExisting(idx)}>✕</button>
                </div>
              ))}
              {previewUrls.map((url, idx) => (
                <div key={`new-${idx}`} className="apm-img-thumb">
                  <img src={url} alt={t('editPage.modal.newImageAlt', { index: idx + 1 })} />
                  <button type="button" className="apm-img-remove" onClick={() => removeNew(idx)}>✕</button>
                </div>
              ))}
              <div className="apm-img-add" onClick={() => imgInputRef.current?.click()}>
                <span>📷</span>
                <span>{t('editPage.modal.addImageBtn')}</span>
              </div>
            </div>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="mep-file-hidden" aria-label={t('editPage.modal.chooseImagesAria')} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.nameLabel')}</label>
            <input type="text" placeholder={t('editPage.modal.namePlaceholder')} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.descriptionLabel')}</label>
            <textarea placeholder={t('editPage.modal.descriptionPlaceholder')} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.priceLabel')}</label>
            <input type="number" min="0" step="0.5" placeholder="150" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.quantityLabel')}</label>
            <input type="number" min="0" placeholder="20" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.discountLabel')}</label>
            <input type="number" min="0" max="100" step="1" placeholder={t('editPage.modal.discountPlaceholder')} value={form.discount}
              onChange={e => setForm(f => ({ ...f, discount: e.target.value }))} />
            <span className="cap-hint">{t('editPage.modal.discountHint')}</span>
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.capacityLabel')}</label>
            <select
              className="cap-select"
              aria-label={t('editPage.modal.capacityLabel')}
              value={capacityUnits}
              onChange={e => setCapacityUnits(Number(e.target.value))}
              title={t('editPage.modal.capacityLabel')}
            >
              {[1, 2, 3, 4, 5].map(v => (
                <option key={v} value={v}>{v} — {t(capacityLabelKey(v))}</option>
              ))}
            </select>
            <span className="cap-hint">{t('editPage.modal.capacityHint')}</span>
          </div>

          {catFiltersLoading && (
            <div className="cat-filters-loading">{t('editPage.modal.loadingCategoryFilters')}</div>
          )}
          {catFiltersError && (
            <div className="cat-filters-fetch-error">{t('editPage.modal.categoryFiltersFetchError', { message: catFiltersError })}</div>
          )}
          {catFilters.length > 0 && (
            <CategoryFiltersSection
              filters={catFilters}
              values={filterValues}
              onChange={setFilterValues}
            />
          )}

          <VariantMatrixEditor matrix={matrix} onChange={setMatrix} />

          <AttributesEditor attributes={attributes} onChange={setAttributes} />

          {error && <div className="md-page-error">{error}</div>}

          <button type="button" className="apm-add-btn" onClick={handleSave} disabled={saving}>
            {saving ? t('editPage.modal.saving') : t('editPage.modal.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AddProductModal ────────────────────────────────────────────────────────────
function AddProductModal({ shopId, onAdd, onClose }: {
  shopId: string;
  shopName: string;
  onAdd: (p: DBProduct) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('merchant');
  const [form, setForm] = useState<ProductForm>({ name: '', description: '', price: '', quantity: '', discount: '' });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<VariantMatrix>(EMPTY_MATRIX);
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [catFilters, setCatFilters] = useState<CategoryFilterDef[]>([]);
  const [filterValues, setFilterValues] = useState<FilterValuesMap>({});
  const [catFiltersLoading, setCatFiltersLoading] = useState(false);
  const [catFiltersError, setCatFiltersError] = useState('');

  // Auto-resolve shop's category from Type_of_store → categories.label
  useEffect(() => {
    supabase.from('shops').select('Type_of_store').eq('shop_id', shopId).single()
      .then(async ({ data: shopData }) => {
        if (!shopData?.Type_of_store) return;
        const { data: catData } = await supabase
          .from('categories').select('id').eq('label', shopData.Type_of_store).single();
        if (catData?.id) setCategoryId(catData.id as string);
      });
  }, [shopId]);

  useEffect(() => {
    if (!categoryId) {
      setCatFilters([]);
      setFilterValues({});
      setCatFiltersError('');
      return;
    }
    setCatFiltersLoading(true);
    setCatFiltersError('');
    supabase
      .from('category_filter_definitions')
      .select('*')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: true })
      .then(({ data, error: fetchError }) => {
        setCatFiltersLoading(false);
        if (fetchError) {
          setCatFilters([]);
          setFilterValues({});
          setCatFiltersError(fetchError.message);
          return;
        }
        setCatFilters((data ?? []) as CategoryFilterDef[]);
        setFilterValues({});
      });
  }, [categoryId]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';
    const previews = files.map(f => URL.createObjectURL(f));
    setPendingFiles(prev => [...prev, ...files]);
    setPreviewUrls(prev => [...prev, ...previews]);
  };

  const removeImage = (idx: number) => {
    URL.revokeObjectURL(previewUrls[idx]);
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
    setPreviewUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAdd = async () => {
    if (!form.name.trim() || !form.price.trim() || !form.quantity.trim()) {
      setError(t('editPage.modal.missingRequiredFields'));
      return;
    }

    setSaving(true);
    setError('');

    const { data, error: insertErr } = await supabase
      .from('products')
      .insert({
        shop_id: shopId,
        title: form.name.trim(),
        description: form.description.trim() || null,
        price: parseFloat(form.price) || 0,
        image_urls: null,
        stock_Quantity: parseInt(form.quantity) || 0,
        category_id: categoryId || null,
      })
      .select()
      .single();

    if (insertErr || !data) {
      setError(t('editPage.modal.addProductError', { message: insertErr?.message ?? t('editPage.modal.unknownError') }));
      setSaving(false);
      return;
    }

    const productId = data.id as string;

    const uploadedUrls: string[] = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${productId}/${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true });
      if (uploadErr) { setError(t('editPage.modal.uploadImageError', { message: uploadErr.message })); continue; }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    if (uploadedUrls.length > 0) {
      await supabase.from('products').update({ image_urls: uploadedUrls }).eq('id', productId);
    }

    if (matrix.colors.length > 0 && matrix.sizes.length > 0) {
      const rows = matrix.colors.flatMap(color =>
        matrix.sizes.map(size => ({
          product_id: productId,
          color: parseColorEntry(color).name,
          size,
          quantity: parseInt(matrix.quantities[color]?.[size] ?? '0') || 0,
        }))
      );
      const { error: varErr } = await supabase.from('product_variants').insert(rows);
      if (varErr) {
        setError(t('editPage.modal.saveVariantsError', { message: varErr.message }));
        setSaving(false);
        return;
      }
    }

    if (attributes.length > 0) {
      const attrRows = attributes.map(a => ({ product_id: productId, attribute_name: a.attribute_name, attribute_value: a.attribute_value }));
      await supabase.from('product_attributes').insert(attrRows);
    }

    const filterRows: { product_id: string; filter_id: string; value: string }[] = [];
    Object.entries(filterValues).forEach(([fid, vals]) => {
      vals.forEach(v => { if (v) filterRows.push({ product_id: productId, filter_id: fid, value: v }); });
    });
    console.log('[AddModal] filterRows to save:', filterRows);
    if (filterRows.length > 0) {
      const { error: filterInsertErr } = await supabase.from('product_filter_values').insert(filterRows);
      if (filterInsertErr) {
        setError(t('editPage.modal.saveCategoryFiltersError', { message: filterInsertErr.message }));
        setSaving(false);
        return;
      }
    }

    let capacity_units: number | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const resp = await fetch(`${API_BASE}/api/products/${productId}/capacity`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (resp.ok) {
          const json = await resp.json();
          capacity_units = json.capacity_units ?? null;
        }
      }
    } catch { /* non-blocking */ }

    previewUrls.forEach(url => URL.revokeObjectURL(url));
    onAdd({ ...data, image_urls: uploadedUrls.length > 0 ? uploadedUrls : null, capacity_units } as DBProduct);
    onClose();
  };

  return (
    <div className="apm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="apm-modal">
        <div className="apm-header">
          <h3>{t('editPage.modal.addTitle')}</h3>
          <button type="button" className="apm-close" onClick={onClose}>✕</button>
        </div>

        <div className="apm-fields">
          <div className="apm-field">
            <label>{t('editPage.modal.imagesLabel')}</label>
            <div className="apm-imgs-row">
              {previewUrls.map((url, idx) => (
                <div key={idx} className="apm-img-thumb">
                  <img src={url} alt={t('editPage.modal.imageAlt', { index: idx + 1 })} />
                  <button type="button" className="apm-img-remove" onClick={() => removeImage(idx)}>✕</button>
                </div>
              ))}
              <div className="apm-img-add" onClick={() => imgInputRef.current?.click()}>
                <span>📷</span>
                <span>{t('editPage.modal.addImageBtn')}</span>
              </div>
            </div>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="mep-file-hidden" aria-label={t('editPage.modal.chooseImagesAria')} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.nameLabel')}</label>
            <input type="text" placeholder={t('editPage.modal.namePlaceholder')} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.descriptionLabel')}</label>
            <textarea placeholder={t('editPage.modal.descriptionPlaceholder')} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.priceLabel')}</label>
            <input type="number" min="0" step="0.5" placeholder="150" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>{t('editPage.modal.quantityLabel')}</label>
            <input type="number" min="0" placeholder="20" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>

          {catFiltersLoading && (
            <div className="cat-filters-loading">{t('editPage.modal.loadingCategoryFilters')}</div>
          )}
          {catFiltersError && (
            <div className="cat-filters-fetch-error">{t('editPage.modal.categoryFiltersFetchError', { message: catFiltersError })}</div>
          )}
          {catFilters.length > 0 && (
            <CategoryFiltersSection
              filters={catFilters}
              values={filterValues}
              onChange={setFilterValues}
            />
          )}

          <VariantMatrixEditor matrix={matrix} onChange={setMatrix} />

          <AttributesEditor attributes={attributes} onChange={setAttributes} />

          {error && <div className="md-page-error">{error}</div>}

          <button type="button" className="apm-add-btn" onClick={handleAdd} disabled={saving}>
            {saving ? t('editPage.modal.saving') : t('editPage.modal.addBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MerchantEditPage ───────────────────────────────────────────────────────────
export default function MerchantEditPage() {
  const { t } = useTranslation('merchant');
  const { direction, lang } = useLanguage();
  const { merchant } = useMerchantAuth();
  const shop = merchant!.shop;
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';

  const [products, setProducts] = useState<DBProduct[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DBProduct | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(!!shop?.shop_id);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [deleteMsg, setDeleteMsg] = useState('');

  useEffect(() => {
    if (!shop?.shop_id) { setLoadingProducts(false); return; }
    supabase
      .from('products')
      .select('id, shop_id, title, description, price, image_urls, stock_Quantity, capacity_units, product_source')
      .eq('shop_id', shop.shop_id)
      .eq('isPublish', true)
      .not('is_deleted', 'eq', true)
      .then(({ data, error }) => {
        if (!error && data) setProducts(data as DBProduct[]);
        setLoadingProducts(false);
      });
  }, [shop?.shop_id]);

  const closedDeleteModal = () => {
    setPendingDeleteId(null);
    setDeleteStatus('idle');
    setDeleteMsg('');
  };

  const handleDeleteSiteOnly = async (id: string) => {
    if (!shop?.shop_id) return;
    setDeleteStatus('loading');
    setDeleteMsg('');
    const { error } = await supabase
      .from('products')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('shop_id', shop.shop_id);
    if (error) {
      setDeleteStatus('error');
      setDeleteMsg(t('editPage.deleteModal.siteDeleteError'));
      return;
    }
    setProducts(prev => prev.filter(p => p.id !== id));
    closedDeleteModal();
  };

  const handleDeleteSiteAndMeta = async (id: string) => {
    if (!shop?.shop_id) return;
    setDeleteStatus('loading');
    setDeleteMsg('');

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';

    let metaOk = false;
    try {
      const res = await fetch(`${API_BASE}/api/catalog/product/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      metaOk = res.ok;
    } catch {
      metaOk = false;
    }

    if (!metaOk) {
      setDeleteStatus('error');
      setDeleteMsg(t('editPage.deleteModal.metaDeleteError'));
      return;
    }

    const { error } = await supabase
      .from('products')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('shop_id', shop.shop_id);
    if (error) {
      setDeleteStatus('error');
      setDeleteMsg(t('editPage.deleteModal.metaDeletedRecordError'));
      return;
    }
    setProducts(prev => prev.filter(p => p.id !== id));
    closedDeleteModal();
  };

  if (!shop) {
    return (
      <div className="mep-root" dir={direction}>
        <h1 className="mep-title">{t('editPage.pageTitle')}</h1>
        <div className="mep-section">
          <div className="mr-empty">
            {t('editPage.noShop.message')}<br />
            {t('editPage.noShop.prefix')}<strong>{t('editPage.noShop.storeSettingsLink')}</strong>{t('editPage.noShop.suffix')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mep-root" dir={direction}>
      <h1 className="mep-title">{t('editPage.pageTitle')}</h1>

      <div className="mep-section">
        <div className="mep-products-header">
          <h2 className="mep-section-title mep-section-title--flush">{t('editPage.products.sectionTitle')}</h2>
          <button type="button" className="mep-add-product-btn" onClick={() => setShowAddModal(true)}>
            {t('editPage.products.addProductBtn')}
          </button>
        </div>

        {loadingProducts ? (
          <div className="md-page-loading">{t('editPage.products.loading')}</div>
        ) : products.length === 0 ? (
          <div className="mr-empty mep-products-gap">{t('editPage.products.empty')}</div>
        ) : (
          <div className="mep-products-grid mep-products-gap">
            {products.map(p => (
              <div key={p.id} className="mep-product-card">
                <div className="mep-product-actions">
                  <button type="button" className="mep-product-edit-btn" onClick={() => setEditingProduct(p)} title={t('editPage.products.editTitle')}>✏️</button>
                  <button type="button" className="mep-product-del-btn" onClick={() => setPendingDeleteId(p.id)} title={t('editPage.products.deleteTitle')}>🗑</button>
                </div>
                <div className="mep-product-img">
                  {p.image_urls?.[0] ? <img src={p.image_urls[0]} alt={p.title} /> : '📦'}
                </div>
                <div className="mep-product-name">{p.title}</div>
                {p.product_source === 'meta_import' && (
                  <span className="meta-import-badge">{t('editPage.products.metaImportBadge')}</span>
                )}
                <div className="mep-product-footer">
                  <span className="mep-product-price">{Number(p.price).toLocaleString(numLocale)} ₪</span>
                  <span className="mep-product-qty">{t('editPage.products.quantityLabel', { qty: p.stock_Quantity })}</span>
                </div>
                {p.capacity_units != null && (
                  <div className="mep-product-capacity" title={t('editPage.modal.capacityLabel')}>
                    <span className="cap-badge cap-badge--{p.capacity_units}">
                      📦 {p.capacity_units} — {t(capacityLabelKey(p.capacity_units))}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddProductModal
          shopId={shop.shop_id}
          shopName={shop.name}
          onAdd={p => setProducts(prev => [...prev, p])}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          onSave={updated => setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))}
          onClose={() => setEditingProduct(null)}
        />
      )}

      {pendingDeleteId && (
        <div className="mep-del-overlay" onClick={deleteStatus !== 'loading' ? closedDeleteModal : undefined}>
          <div className="mep-del-modal" onClick={e => e.stopPropagation()}>
            <div className="mep-del-modal-title">{t('editPage.deleteModal.title')}</div>
            <div className="mep-del-modal-msg">
              {t('editPage.deleteModal.confirmMessage')}
            </div>

            {deleteStatus === 'loading' && (
              <div className="mep-del-modal-loading">{t('editPage.deleteModal.loading')}</div>
            )}

            {deleteStatus === 'error' && (
              <div className="mep-del-modal-error">{deleteMsg}</div>
            )}

            <div className="mep-del-modal-actions">
              <button
                type="button"
                className="mep-del-btn-meta"
                disabled={deleteStatus === 'loading'}
                onClick={() => handleDeleteSiteAndMeta(pendingDeleteId)}
              >
                {t('editPage.deleteModal.deleteSiteAndMetaBtn')}
              </button>
              <button
                type="button"
                className="mep-del-btn-site"
                disabled={deleteStatus === 'loading'}
                onClick={() => handleDeleteSiteOnly(pendingDeleteId)}
              >
                {t('editPage.deleteModal.deleteSiteOnlyBtn')}
              </button>
              <button
                type="button"
                className="mep-del-btn-cancel"
                disabled={deleteStatus === 'loading'}
                onClick={closedDeleteModal}
              >
                {t('editPage.common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
