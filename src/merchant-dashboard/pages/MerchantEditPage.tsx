import { useState, useRef, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
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

const CAPACITY_LABELS: Record<number, string> = {
  1: 'صغير جداً',
  2: 'صغير',
  3: 'متوسط',
  4: 'كبير',
  5: 'كبير جداً',
};

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
      showPaletteMsg(`اللون "${c.name}" مختار بالفعل — اضغط × على الشريحة لإزالته`);
    } else {
      onChange([...colors, `${c.name}|${c.hex}`]);
    }
  };

  const removeColor = (idx: number) => onChange(colors.filter((_, i) => i !== idx));

  const addCustom = () => {
    const name = customName.trim();
    if (!name) {
      setCustomNameError('يرجى إدخال اسم اللون');
      return;
    }
    if (isNameTaken(name)) {
      setCustomNameError(`اللون "${name}" مختار بالفعل`);
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
      <span className="tag-input-label">الألوان المتاحة</span>

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
          title="لون مخصص"
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
            aria-label="اختر لوناً مخصصاً"
          />
          <div className="custom-color-name-wrap">
            <input
              type="text"
              placeholder="اسم اللون *"
              value={customName}
              onChange={e => { setCustomName(e.target.value); setCustomNameError(''); }}
              className={`custom-color-name${customNameError ? ' custom-color-name--error' : ''}`}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
            />
            {customNameError && (
              <span className="custom-color-name-error">{customNameError}</span>
            )}
          </div>
          <button type="button" className="custom-color-add-btn" onClick={addCustom}>إضافة</button>
          <button type="button" className="custom-color-cancel-btn" onClick={closeCustom}>إلغاء</button>
        </div>
      )}
      <span className="tag-input-hint">اضغط على الدائرة لاختيار اللون، أو أضف لوناً مخصصاً</span>
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
        <div className="var-matrix-section-title">متغيرات المنتج</div>
        <div className="var-matrix-fields">
          <ColorPicker colors={matrix.colors} onChange={handleColorsChange} />
          <TagInput
            label="المقاسات المتاحة"
            tags={matrix.sizes}
            onChange={handleSizesChange}
            placeholder="مثال: S"
            hint="اكتب المقاس ثم اضغط Enter أو فاصلة ، للانتقال للتالي"
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
            إنشاء جدول الكميات
            <span className="var-matrix-btn-arrow">←</span>
          </button>
          <p className="var-matrix-generate-hint">
            {matrix.colors.length} لون × {matrix.sizes.length} مقاس
            &nbsp;·&nbsp;
            {matrix.colors.length * matrix.sizes.length} خلية
          </p>
        </div>
      )}

      {/* ── Quantity matrix table ── */}
      {showTable && (
        <div className="var-matrix-table-section">
          <div className="var-matrix-table-label">
            الكمية المتاحة لكل مجموعة (لون × مقاس)
          </div>
          <div className="var-matrix-table-wrap">
            <table className="var-matrix-table">
              <thead>
                <tr>
                  <th className="var-matrix-corner">اللون \ المقاس</th>
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
                            aria-label={`كمية ${colorName} - ${size}`}
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
  const [nameInput, setNameInput] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [inputError, setInputError] = useState('');

  const add = () => {
    const name = nameInput.trim();
    const value = valueInput.trim();
    if (!name || !value) { setInputError('يرجى إدخال الاسم والقيمة'); return; }
    if (attributes.some(a => a.attribute_name === name)) {
      setInputError(`"${name}" موجود بالفعل`);
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
      <span className="tag-input-label">مواصفات المنتج</span>

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
          placeholder="الاسم (مثال: الخامة)"
          value={nameInput}
          onChange={e => { setNameInput(e.target.value); setInputError(''); }}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <input
          type="text"
          className="attr-input"
          placeholder="القيمة (مثال: قطن)"
          value={valueInput}
          onChange={e => { setValueInput(e.target.value); setInputError(''); }}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button type="button" className="attr-add-btn" onClick={add}>+ إضافة</button>
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
  const setVal = (id: string, vals: string[]) => onChange({ ...values, [id]: vals });

  const visibleFilters = filters.filter(f => f.filter_type !== 'color');
  if (visibleFilters.length === 0) return null;

  return (
    <div className="cat-filters-section">
      <div className="cat-filters-title">خصائص الفئة</div>
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
              <option value="">— اختر —</option>
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
              <span>نعم</span>
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
      setError('يرجى ملء الحقول المطلوبة');
      return;
    }

    setSaving(true);
    setError('');

    const uploadedUrls: string[] = [];
    let imageError = '';
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${product.id}/${Date.now()}_${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true });
      if (uploadErr) {
        console.error('[EditModal] image upload failed:', uploadErr);
        imageError = 'تعذّر رفع الصورة: ' + uploadErr.message;
        continue;
      }
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
      setError('تعذّر تحديث المنتج: ' + updateErr.message);
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
        setError('تعذّر حفظ المتغيرات: ' + varErr.message);
        setSaving(false);
        return;
      }
    }

    await supabase.from('product_attributes').delete().eq('product_id', product.id);
    if (attributes.length > 0) {
      const attrRows = attributes.map(a => ({ product_id: product.id, attribute_name: a.attribute_name, attribute_value: a.attribute_value }));
      const { error: attrErr } = await supabase.from('product_attributes').insert(attrRows);
      if (attrErr) {
        setError('تعذّر حفظ المواصفات: ' + attrErr.message);
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
        setError('تعذّر حفظ خصائص الفئة: ' + filterInsertErr.message);
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
    setSaving(false);
    if (imageError) {
      setError(imageError + ' — تم حفظ باقي التعديلات، حاول رفع الصورة مرة أخرى');
      return;
    }
    onClose();
  };

  return (
    <div className="apm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="apm-modal">
        <div className="apm-header">
          <h3>تعديل المنتج</h3>
          <button type="button" className="apm-close" onClick={onClose}>✕</button>
        </div>

        <div className="apm-fields">
          <div className="apm-field">
            <label>صور المنتج</label>
            <div className="apm-imgs-row">
              {existingUrls.map((url, idx) => (
                <div key={`ex-${idx}`} className="apm-img-thumb">
                  <img src={url} alt={`صورة ${idx + 1}`} />
                  <button type="button" className="apm-img-remove" onClick={() => removeExisting(idx)}>✕</button>
                </div>
              ))}
              {previewUrls.map((url, idx) => (
                <div key={`new-${idx}`} className="apm-img-thumb">
                  <img src={url} alt={`صورة جديدة ${idx + 1}`} />
                  <button type="button" className="apm-img-remove" onClick={() => removeNew(idx)}>✕</button>
                </div>
              ))}
              <div className="apm-img-add" onClick={() => imgInputRef.current?.click()}>
                <span>📷</span>
                <span>إضافة صورة</span>
              </div>
            </div>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="mep-file-hidden" aria-label="اختر صور المنتج" />
          </div>

          <div className="apm-field">
            <label>اسم المنتج *</label>
            <input type="text" placeholder="مثال: قميص صيفي" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>وصف المنتج</label>
            <textarea placeholder="اكتب وصفاً مختصراً..." value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>السعر الأساسي (₪) *</label>
            <input type="number" min="0" step="0.5" placeholder="150" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>الكمية الإجمالية المتاحة *</label>
            <input type="number" min="0" placeholder="20" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>نسبة الخصم (%)</label>
            <input type="number" min="0" max="100" step="1" placeholder="بدون خصم" value={form.discount}
              onChange={e => setForm(f => ({ ...f, discount: e.target.value }))} />
            <span className="cap-hint">اتركه فارغاً لإزالة الخصم — يظهر للزبائن كشارة "خصم %"</span>
          </div>

          <div className="apm-field">
            <label>حجم المنتج للتوصيل</label>
            <select
              className="cap-select"
              aria-label="حجم المنتج للتوصيل"
              value={capacityUnits}
              onChange={e => setCapacityUnits(Number(e.target.value))}
              title="حجم المنتج للتوصيل"
            >
              {[1, 2, 3, 4, 5].map(v => (
                <option key={v} value={v}>{v} — {CAPACITY_LABELS[v]}</option>
              ))}
            </select>
            <span className="cap-hint">يُستخدم لحساب سعة الشاحنة عند التوصيل</span>
          </div>

          {catFiltersLoading && (
            <div className="cat-filters-loading">جاري تحميل خصائص الفئة...</div>
          )}
          {catFiltersError && (
            <div className="cat-filters-fetch-error">⚠ خطأ في تحميل خصائص الفئة: {catFiltersError}</div>
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
            {saving ? 'جاري الحفظ...' : '💾 حفظ التعديلات'}
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
      setError('يرجى ملء الحقول المطلوبة');
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
      setError('تعذّر إضافة المنتج: ' + (insertErr?.message ?? 'خطأ غير معروف'));
      setSaving(false);
      return;
    }

    const productId = data.id as string;

    const uploadedUrls: string[] = [];
    let imageError = '';
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${productId}/${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true });
      if (uploadErr) {
        console.error('[AddModal] image upload failed:', uploadErr);
        imageError = 'تعذّر رفع الصورة: ' + uploadErr.message;
        continue;
      }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    if (uploadedUrls.length > 0) {
      const { error: imgUpdateErr } = await supabase.from('products').update({ image_urls: uploadedUrls }).eq('id', productId);
      if (imgUpdateErr) {
        console.error('[AddModal] saving image_urls failed:', imgUpdateErr);
        imageError = 'تعذّر حفظ رابط الصورة: ' + imgUpdateErr.message;
      }
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
        setError('تعذّر حفظ المتغيرات: ' + varErr.message);
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
        setError('تعذّر حفظ خصائص الفئة: ' + filterInsertErr.message);
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
    setSaving(false);
    if (imageError) {
      setError(imageError + ' — تم حفظ باقي بيانات المنتج، يمكنك إعادة رفع الصورة من خلال تعديل المنتج');
      return;
    }
    onClose();
  };

  return (
    <div className="apm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="apm-modal">
        <div className="apm-header">
          <h3>إضافة منتج جديد</h3>
          <button type="button" className="apm-close" onClick={onClose}>✕</button>
        </div>

        <div className="apm-fields">
          <div className="apm-field">
            <label>صور المنتج</label>
            <div className="apm-imgs-row">
              {previewUrls.map((url, idx) => (
                <div key={idx} className="apm-img-thumb">
                  <img src={url} alt={`صورة ${idx + 1}`} />
                  <button type="button" className="apm-img-remove" onClick={() => removeImage(idx)}>✕</button>
                </div>
              ))}
              <div className="apm-img-add" onClick={() => imgInputRef.current?.click()}>
                <span>📷</span>
                <span>إضافة صورة</span>
              </div>
            </div>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="mep-file-hidden" aria-label="اختر صور المنتج" />
          </div>

          <div className="apm-field">
            <label>اسم المنتج *</label>
            <input type="text" placeholder="مثال: قميص صيفي" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>وصف المنتج</label>
            <textarea placeholder="اكتب وصفاً مختصراً..." value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>السعر الأساسي (₪) *</label>
            <input type="number" min="0" step="0.5" placeholder="150" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>الكمية الإجمالية المتاحة *</label>
            <input type="number" min="0" placeholder="20" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>

          {catFiltersLoading && (
            <div className="cat-filters-loading">جاري تحميل خصائص الفئة...</div>
          )}
          {catFiltersError && (
            <div className="cat-filters-fetch-error">⚠ خطأ في تحميل خصائص الفئة: {catFiltersError}</div>
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
            {saving ? 'جاري الحفظ...' : '➕ إضافة المنتج'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MerchantEditPage ───────────────────────────────────────────────────────────
export default function MerchantEditPage() {
  const { merchant } = useMerchantAuth();
  const shop = merchant!.shop;

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
      setDeleteMsg('حدث خطأ أثناء الحذف، يرجى المحاولة مرة أخرى');
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
      setDeleteMsg('تعذر حذف المنتج من كتالوج Meta، يرجى المحاولة مرة أخرى');
      return;
    }

    const { error } = await supabase
      .from('products')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('shop_id', shop.shop_id);
    if (error) {
      setDeleteStatus('error');
      setDeleteMsg('تم الحذف من Meta لكن حدث خطأ في تحديث السجل، يرجى المحاولة مرة أخرى');
      return;
    }
    setProducts(prev => prev.filter(p => p.id !== id));
    closedDeleteModal();
  };

  if (!shop) {
    return (
      <div className="mep-root">
        <h1 className="mep-title">إدارة المنتجات</h1>
        <div className="mep-section">
          <div className="mr-empty">
            يجب إنشاء متجرك أولاً قبل إضافة منتجات.<br />
            اذهب إلى <strong>إعدادات المتجر</strong> من القائمة أعلاه لإنشاء متجرك.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mep-root">
      <h1 className="mep-title">إدارة المنتجات</h1>

      <div className="mep-section">
        <div className="mep-products-header">
          <h2 className="mep-section-title mep-section-title--flush">📦 المنتجات</h2>
          <button type="button" className="mep-add-product-btn" onClick={() => setShowAddModal(true)}>
            ➕ إضافة منتج
          </button>
        </div>

        {loadingProducts ? (
          <div className="md-page-loading">جاري تحميل المنتجات...</div>
        ) : products.length === 0 ? (
          <div className="mr-empty mep-products-gap">لا توجد منتجات — أضف أول منتج لك!</div>
        ) : (
          <div className="mep-products-grid mep-products-gap">
            {products.map(p => (
              <div key={p.id} className="mep-product-card">
                <div className="mep-product-actions">
                  <button type="button" className="mep-product-edit-btn" onClick={() => setEditingProduct(p)} title="تعديل المنتج">✏️</button>
                  <button type="button" className="mep-product-del-btn" onClick={() => setPendingDeleteId(p.id)} title="حذف المنتج">🗑</button>
                </div>
                <div className="mep-product-img">
                  {p.image_urls?.[0] ? <img src={p.image_urls[0]} alt={p.title} /> : '📦'}
                </div>
                <div className="mep-product-name">{p.title}</div>
                {p.product_source === 'meta_import' && (
                  <span className="meta-import-badge">مستورد من Meta</span>
                )}
                <div className="mep-product-footer">
                  <span className="mep-product-price">{Number(p.price).toLocaleString('ar-SA')} ₪</span>
                  <span className="mep-product-qty">الكمية: {p.stock_Quantity}</span>
                </div>
                {p.capacity_units != null && (
                  <div className="mep-product-capacity" title="حجم المنتج للتوصيل">
                    <span className="cap-badge cap-badge--{p.capacity_units}">
                      📦 {p.capacity_units} — {CAPACITY_LABELS[p.capacity_units]}
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
            <div className="mep-del-modal-title">🗑 حذف المنتج</div>
            <div className="mep-del-modal-msg">
              هل تريد حذف المنتج من الموقع فقط، أم من الموقع ومن كتالوج Meta أيضًا؟
            </div>

            {deleteStatus === 'loading' && (
              <div className="mep-del-modal-loading">جارٍ التنفيذ...</div>
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
                حذف من الموقع و Meta
              </button>
              <button
                type="button"
                className="mep-del-btn-site"
                disabled={deleteStatus === 'loading'}
                onClick={() => handleDeleteSiteOnly(pendingDeleteId)}
              >
                حذف من الموقع فقط
              </button>
              <button
                type="button"
                className="mep-del-btn-cancel"
                disabled={deleteStatus === 'loading'}
                onClick={closedDeleteModal}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
