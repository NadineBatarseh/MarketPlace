import { useState, useRef, useEffect } from 'react';
import { useMerchantAuth, MerchantShop } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

const ALL_CATEGORIES = [
  'ملابس رجالية', 'ملابس نسائية', 'ملابس أطفال', 'إكسسوارات',
  'أدوات منزلية', 'إلكترونيات', 'مستلزمات مطبخ', 'عطور ومستحضرات',
  'رياضة وترفيه', 'ألعاب أطفال', 'كتب وقرطاسية', 'أخرى',
];

interface DBProduct {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  price: number;
  image_urls: string[] | null;
  stock_Quantity: number;
  capacity_units: number | null;
}

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
}

function EditProductModal({ product, onSave, onClose }: { product: DBProduct; onSave: (p: DBProduct) => void; onClose: () => void }) {
  const [form, setForm] = useState<ProductForm>({
    name: product.title,
    description: product.description ?? '',
    price: String(product.price),
    quantity: String(product.stock_Quantity),
  });
  const [existingUrls, setExistingUrls] = useState<string[]>(product.image_urls ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [capacityUnits, setCapacityUnits] = useState<number>(product.capacity_units ?? 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imgInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';
    const previews = files.map(f => URL.createObjectURL(f));
    setPendingFiles(prev => [...prev, ...files]);
    setPreviewUrls(prev => [...prev, ...previews]);
  };

  const removeExisting = (idx: number) => {
    setExistingUrls(prev => prev.filter((_, i) => i !== idx));
  };

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

    // Upload new images
    const uploadedUrls: string[] = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${product.id}/${Date.now()}_${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true });
      if (uploadErr) { setError('تعذّر رفع الصورة: ' + uploadErr.message); continue; }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    // Delete removed existing images from storage
    const removedUrls = (product.image_urls ?? []).filter(u => !existingUrls.includes(u));
    for (const url of removedUrls) {
      const storagePath = url.split('/product-images/')[1];
      if (storagePath) {
        await supabase.storage.from('product-images').remove([storagePath]);
      }
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
      })
      .eq('id', product.id);

    if (updateErr) {
      setError('تعذّر تحديث المنتج: ' + updateErr.message);
      setSaving(false);
      return;
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
    });
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
            <label>السعر (ر.س) *</label>
            <input type="number" min="0" step="0.5" placeholder="150" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>الكمية المتاحة *</label>
            <input type="number" min="0" placeholder="20" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>حجم المنتج للتوصيل</label>
            <select
              className="cap-select"
              value={capacityUnits}
              onChange={e => setCapacityUnits(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map(v => (
                <option key={v} value={v}>{v} — {CAPACITY_LABELS[v]}</option>
              ))}
            </select>
            <span className="cap-hint">يُستخدم لحساب سعة الشاحنة عند التوصيل</span>
          </div>

          {error && <div className="md-page-error">{error}</div>}

          <button type="button" className="apm-add-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'جاري الحفظ...' : '💾 حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddProductModal({ shopId, onAdd, onClose }: { shopId: string; shopName: string; onAdd: (p: DBProduct) => void; onClose: () => void }) {
  const [form, setForm] = useState<ProductForm>({ name: '', description: '', price: '', quantity: '' });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imgInputRef = useRef<HTMLInputElement>(null);

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

    // Step 1: Insert product without images to get the product ID
    const { data, error: insertErr } = await supabase
      .from('products')
      .insert({
        shop_id: shopId,
        title: form.name.trim(),
        description: form.description.trim() || null,
        price: parseFloat(form.price) || 0,
        image_urls: null,
        stock_Quantity: parseInt(form.quantity) || 0,
      })
      .select()
      .single();

    if (insertErr || !data) {
      setError('تعذّر إضافة المنتج: ' + (insertErr?.message ?? 'خطأ غير معروف'));
      setSaving(false);
      return;
    }

    const productId = data.id as string;

    // Step 2: Upload images to {productId}/{index}.{ext}
    const uploadedUrls: string[] = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${productId}/${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true });
      if (uploadErr) { setError('تعذّر رفع الصورة: ' + uploadErr.message); continue; }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    // Step 3: Update product with image URLs if any were uploaded
    if (uploadedUrls.length > 0) {
      await supabase.from('products').update({
        image_urls: uploadedUrls,
      }).eq('id', productId);
    }

    // Step 4: Auto-classify capacity_units via backend
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
    } catch { /* non-blocking — product still saved without capacity */ }

    previewUrls.forEach(url => URL.revokeObjectURL(url));
    onAdd({ ...data, image_urls: uploadedUrls.length > 0 ? uploadedUrls : null, capacity_units } as DBProduct);
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
            <label>السعر (ر.س) *</label>
            <input type="number" min="0" step="0.5" placeholder="150" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>

          <div className="apm-field">
            <label>الكمية المتاحة *</label>
            <input type="number" min="0" placeholder="20" value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>

          {error && <div className="md-page-error">{error}</div>}

          <button type="button" className="apm-add-btn" onClick={handleAdd} disabled={saving}>
            {saving ? 'جاري الحفظ...' : '➕ إضافة المنتج'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MerchantEditPage() {
  const { merchant, updateShopLocally } = useMerchantAuth();
  const shop = merchant!.shop;
  const isCreate = shop === null;

  const [activeTab, setActiveTab] = useState<'settings' | 'products'>('settings');
  const [name, setName] = useState(shop?.name ?? '');
  const [location, setLocation] = useState(shop?.location ?? '');
  const [description, setDescription] = useState(shop?.description ?? '');
  const [categories, setCategories] = useState<string[]>(shop?.categories ?? []);
  const [logoUrl, setLogoUrl] = useState<string | null>(shop?.shopLogo ?? null);
  const [products, setProducts] = useState<DBProduct[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DBProduct | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(!isCreate);
  const logoInputRef = useRef<HTMLInputElement>(null);
  // After a successful create, hold the new shop_id so products can be added
  const [createdShopId, setCreatedShopId] = useState<string | null>(null);

  const activeShopId = shop?.shop_id ?? createdShopId;

  useEffect(() => {
    if (!shop?.shop_id) { setLoadingProducts(false); return; }
    supabase
      .from('products')
      .select('id, shop_id, title, description, price, image_urls, stock_Quantity, capacity_units')
      .eq('shop_id', shop.shop_id)
      .eq('isPublish', true)
      .then(({ data, error }) => {
        if (!error && data) setProducts(data as DBProduct[]);
        setLoadingProducts(false);
      });
  }, [shop?.shop_id]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const toggleCategory = (cat: string) => {
    setCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const deleteProduct = async (id: string) => {
    if (!activeShopId) return;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';

    const res = await fetch(`${API_BASE}/api/products/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert('تعذّر حذف المنتج: ' + (body.error ?? res.statusText));
      return;
    }

    // Clean up storage files after successful DB delete
    const { data: files } = await supabase.storage.from('product-images').list(id);
    if (files && files.length > 0) {
      await supabase.storage.from('product-images').remove(files.map(f => `${id}/${f.name}`));
    }

    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const handleSave = async () => {
    if (!name.trim() || !location.trim() || categories.length === 0) {
      setSaveError('يرجى ملء اسم المتجر والموقع واختيار فئة واحدة على الأقل');
      return;
    }
    setSaving(true);
    setSaveError('');

    if (isCreate) {
      // ── CREATE ──
      // shops.merchant_id is a FK to merchants.id (not the auth UUID)
      const { data: merchantRow, error: mErr } = await supabase
        .from('merchants')
        .select('id')
        .eq('user_id', merchant!.id)
        .single();

      if (mErr || !merchantRow) {
        setSaveError('تعذر العثور على سجل التاجر — تأكد من وجود سجل في جدول merchants');
        setSaving(false);
        return;
      }

      const { data, error: insertErr } = await supabase
        .from('shops')
        .insert({
          owner_id: merchant!.id,
          merchant_id: merchantRow.id,
          name: name.trim(),
          location: location.trim(),
          description: description.trim() || null,
          shopLogo: logoUrl,
          categories,
        })
        .select()
        .single();

      if (insertErr || !data) {
        setSaveError('تعذّر إنشاء المتجر: ' + (insertErr?.message ?? 'خطأ غير معروف'));
        setSaving(false);
        return;
      }

      const newShop: MerchantShop = {
        shop_id: data.shop_id,
        name: data.name,
        shopLogo: data.shopLogo ?? null,
        location: data.location ?? null,
        description: data.description ?? null,
        whatsapp: data.whatsapp ?? null,
        facebook: data.facebook ?? null,
        instagram: data.instagram ?? null,
        merchant_id: data.merchant_id,
        categories: data.categories ?? [],
      };
      updateShopLocally(newShop);
      setCreatedShopId(data.shop_id);
      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      return;
    }

    // ── UPDATE ──
    const { error: updateErr } = await supabase
      .from('shops')
      .update({
        name: name.trim(),
        location: location.trim(),
        description: description.trim() || null,
        shopLogo: logoUrl,
        categories,
      })
      .eq('shop_id', shop!.shop_id)
      .eq('owner_id', merchant!.id);

    if (updateErr) {
      setSaveError('تعذّر الحفظ: ' + updateErr.message);
      setSaving(false);
      return;
    }

    const updatedShop: MerchantShop = {
      ...shop!,
      name: name.trim(),
      location: location.trim(),
      description: description.trim() || null,
      shopLogo: logoUrl,
      categories,
    };
    updateShopLocally(updatedShop);
    setSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const pageTitle = isCreate ? 'إنشاء متجرك' : 'تعديل صفحة المتجر';

  const saveBtnLabel = saving
    ? 'جاري الحفظ...'
    : isCreate
      ? '🚀 إنشاء المتجر'
      : '💾 حفظ التعديلات';

  const shopExists = shop !== null || createdShopId !== null;

  return (
    <div className="mep-root">
      <h1 className="mep-title">{pageTitle}</h1>

      {/* Tab switcher */}
      <div className="mep-tabs">
        <button
          type="button"
          className={`mep-tab${activeTab === 'settings' ? ' mep-tab--active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          🏪 إعدادات المتجر
        </button>
        <button
          type="button"
          className={`mep-tab${activeTab === 'products' ? ' mep-tab--active' : ''}${!shopExists ? ' mep-tab--disabled' : ''}`}
          onClick={() => { if (shopExists) setActiveTab('products'); }}
          disabled={!shopExists}
          title={!shopExists ? 'أنشئ المتجر أولاً لإضافة منتجات' : undefined}
        >
          📦 المنتجات {shopExists && products.length > 0 ? `(${products.length})` : ''}
        </button>
      </div>

      {/* ── SETTINGS TAB ── */}
      {activeTab === 'settings' && (
        <>
          {/* Logo */}
          <div className="mep-section">
            <h2 className="mep-section-title">🖼️ شعار المتجر</h2>
            <div className="mep-logo-area">
              <div className="mep-logo-preview" onClick={() => logoInputRef.current?.click()} title="انقر لتغيير الشعار">
                {logoUrl
                  ? <img src={logoUrl} alt="شعار المتجر" />
                  : <span className="mep-logo-placeholder">🏪</span>
                }
              </div>
              <div>
                <div className="mep-logo-info">
                  اختر صورة بجودة عالية لتمثيل متجرك<br />
                  الصيغ المدعومة: JPG، PNG، WEBP
                </div>
                <button type="button" className="mep-logo-btn" onClick={() => logoInputRef.current?.click()}>
                  📁 اختر صورة
                </button>
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="mep-file-hidden" aria-label="اختر شعار المتجر" />
            </div>
          </div>

          {/* Basic info */}
          <div className="mep-section">
            <h2 className="mep-section-title">📋 معلومات المتجر</h2>
            <div className="mep-fields">
              <div className="mep-field">
                <label>اسم المتجر</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="أدخل اسم متجرك" />
              </div>
              <div className="mep-field">
                <label>الموقع / المنطقة</label>
                <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="مثال: الرياض، حي النزهة" />
              </div>
              <div className="mep-field">
                <label>وصف المتجر</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="وصف مختصر عن متجرك" />
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="mep-section">
            <h2 className="mep-section-title">🏷️ فئات المتجر</h2>
            <div className="mep-categories">
              {ALL_CATEGORIES.map(cat => (
                <button
                  type="button"
                  key={cat}
                  className={`mep-cat-chip${categories.includes(cat) ? ' selected' : ''}`}
                  onClick={() => toggleCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {saveSuccess && (
            <div className="mep-save-success">
              {isCreate ? '🚀 تم إنشاء متجرك بنجاح!' : '✅ تم حفظ التعديلات بنجاح!'}
            </div>
          )}
          {saveError && <div className="md-page-error">{saveError}</div>}

          <button type="button" className="mep-save-btn" onClick={handleSave} disabled={saving}>
            {saveBtnLabel}
          </button>
        </>
      )}

      {/* ── PRODUCTS TAB ── */}
      {activeTab === 'products' && shopExists && (
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
                  <div className="mep-product-img">
                    {p.image_urls?.[0] ? <img src={p.image_urls[0]} alt={p.title} /> : '📦'}
                  </div>
                  <div className="mep-product-actions">
                    <button type="button" className="mep-product-edit-btn" onClick={() => setEditingProduct(p)} title="تعديل المنتج">✏️</button>
                    <button type="button" className="mep-product-del-btn" onClick={() => deleteProduct(p.id)} title="حذف المنتج">🗑</button>
                  </div>
                  <div className="mep-product-name">{p.title}</div>
                  {p.description && <div className="mep-product-desc">{p.description}</div>}
                  <div className="mep-product-footer">
                    <span className="mep-product-price">{Number(p.price).toLocaleString('ar-SA')} ر.س</span>
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
      )}

      {showAddModal && activeShopId && (
        <AddProductModal
          shopId={activeShopId}
          shopName={name}
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
    </div>
  );
}
