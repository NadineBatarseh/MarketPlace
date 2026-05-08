import { useState, useRef, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

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
              title="حجم المنتج للتوصيل"
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

    if (uploadedUrls.length > 0) {
      await supabase.from('products').update({ image_urls: uploadedUrls }).eq('id', productId);
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
  const { merchant } = useMerchantAuth();
  const shop = merchant!.shop;

  const [products, setProducts] = useState<DBProduct[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DBProduct | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(!!shop?.shop_id);

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

  const deleteProduct = async (id: string) => {
    if (!shop?.shop_id) return;
    const { data: files } = await supabase.storage.from('product-images').list(id);
    if (files && files.length > 0) {
      await supabase.storage.from('product-images').remove(files.map(f => `${id}/${f.name}`));
      await supabase.storage.from('product-images').remove(files.map(f => `${id}/${f.name}`));
    }
    const { error } = await supabase.from('products').delete().eq('id', id).eq('shop_id', shop.shop_id);
    if (!error) setProducts(prev => prev.filter(p => p.id !== id));
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
                  <button type="button" className="mep-product-del-btn" onClick={() => deleteProduct(p.id)} title="حذف المنتج">🗑</button>
                </div>
                <div className="mep-product-img">
                  {p.image_urls?.[0] ? <img src={p.image_urls[0]} alt={p.title} /> : '📦'}
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
    </div>
  );
}
