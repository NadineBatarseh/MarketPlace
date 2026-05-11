import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import './Auth.css';

interface Category {
  id: string;
  label: string;
}

interface Zone {
  id: string;
  name: string;
}

export default function MerchantApplication() {
  const [form, setForm] = useState({
    name_of_owner: '',
    name_of_store: '',
    email: '',
    phone_number: '',
    city: '',
    zone_id: '',
    type_of_store: '',
    description: '',
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [storeTypeOpen, setStoreTypeOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const storeTypeRef = useRef<HTMLDivElement>(null);
  const cityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from('categories')
      .select('id, label')
      .order('sort_order')
      .then(({ data }) => {
        if (data) setCategories(data);
      });

    supabase
      .from('zones')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        if (data) setZones(data);
      });
  }, []);

  useEffect(() => {
    if (!storeTypeOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (storeTypeRef.current && !storeTypeRef.current.contains(e.target as Node)) {
        setStoreTypeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [storeTypeOpen]);

  useEffect(() => {
    if (!cityOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) {
        setCityOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [cityOpen]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!/^(05\d{8}|\+9665\d{8})$/.test(form.phone_number.trim())) {
      setError('رقم الهاتف غير صحيح — يجب أن يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0512345678)');
      return;
    }

    setLoading(true);

    // Upload pictures to storage under {name_of_store}/0.ext, 1.ext, ...
    const uploadedUrls: string[] = [];
    const folderName = form.name_of_store.trim() || 'unknown';
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${folderName}/${i}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('merchant-applications')
        .upload(path, file, { upsert: true });
      if (uploadErr) { setError('تعذّر رفع الصورة: ' + uploadErr.message); setLoading(false); return; }
      const { data: urlData } = supabase.storage.from('merchant-applications').getPublicUrl(uploadData.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    // Insert into merchant_applications table
    const { error: dbError } = await supabase.from('merchant_applications').insert({
      name_of_owner: form.name_of_owner,
      name_of_store: form.name_of_store,
      email: form.email,
      phone_number: form.phone_number,
      city: form.city,
      zone_id: form.zone_id || null,
      Type_of_store: form.type_of_store,
      description: form.description,
      pictures: uploadedUrls.length > 0 ? uploadedUrls : null,
      status: 'pending',
    });

    setLoading(false);

    if (dbError) {
      setError('حدث خطأ أثناء إرسال الطلب: ' + dbError.message);
      return;
    }

    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">✅</div>
          <h2 className="auth-title">تم إرسال طلبك بنجاح!</h2>
          <p className="auth-success-msg">
            شكراً لك <strong>{form.name_of_owner}</strong>، تم استلام طلب تسجيلك كتاجر.
            <br /><br />
            سيقوم فريقنا بمراجعة طلبك والتواصل معك عبر البريد الإلكتروني{' '}
            <strong>{form.email}</strong> خلال 1–3 أيام عمل.
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card auth-wide-card">
        <div className="auth-logo">🏪</div>
        <h1 className="auth-title">طلب تسجيل تاجر</h1>
        <p className="auth-sub">أكمل النموذج وسيتم مراجعة طلبك من قِبل الإدارة</p>

        <form className="auth-form" onSubmit={handleSubmit}>

          <div className="auth-row">
            <div className="auth-field">
              <label>اسم صاحب العمل</label>
              <input placeholder="الاسم الكامل" value={form.name_of_owner} onChange={set('name_of_owner')} required />
            </div>
            <div className="auth-field">
              <label>اسم المتجر</label>
              <input placeholder="اسم المتجر أو الشركة" value={form.name_of_store} onChange={set('name_of_store')} required />
            </div>
          </div>

          <div className="auth-field">
            <label>البريد الإلكتروني</label>
            <input type="email" placeholder="example@email.com" value={form.email} onChange={set('email')} required />
          </div>

          <div className="auth-row">
            <div className="auth-field">
              <label>رقم الهاتف</label>
              <input type="tel" placeholder="+966 5x xxx xxxx" value={form.phone_number} onChange={set('phone_number')} required />
            </div>
            <div className="auth-field">
              <label>المدينة</label>
              <div className="auth-custom-select" ref={cityRef}>
                <button
                  type="button"
                  className={`auth-custom-select-trigger${!form.city ? ' auth-custom-select-placeholder' : ''}`}
                  onClick={() => setCityOpen(o => !o)}
                >
                  {form.city || 'اختر المدينة'}
                  <span className="auth-custom-select-arrow">{cityOpen ? '▲' : '▼'}</span>
                </button>
                {cityOpen && (
                  <ul className="auth-custom-select-list">
                    {zones.map(zone => (
                      <li
                        key={zone.id}
                        className={`auth-custom-select-option${form.city === zone.name ? ' selected' : ''}`}
                        onMouseDown={() => {
                          setForm(f => ({ ...f, city: zone.name, zone_id: zone.id }));
                          setCityOpen(false);
                        }}
                      >
                        {zone.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <input type="hidden" value={form.city} required />
            </div>
          </div>

          <div className="auth-field">
            <label>نوع المتجر</label>
            <div className="auth-custom-select" ref={storeTypeRef}>
              <button
                type="button"
                className={`auth-custom-select-trigger${!form.type_of_store ? ' auth-custom-select-placeholder' : ''}`}
                onClick={() => setStoreTypeOpen(o => !o)}
              >
                {form.type_of_store || 'اختر النوع'}
                <span className="auth-custom-select-arrow">{storeTypeOpen ? '▲' : '▼'}</span>
              </button>
              {storeTypeOpen && (
                <ul className="auth-custom-select-list">
                  {categories.map(cat => (
                    <li
                      key={cat.id}
                      className={`auth-custom-select-option${form.type_of_store === cat.label ? ' selected' : ''}`}
                      onMouseDown={() => {
                        setForm(f => ({ ...f, type_of_store: cat.label }));
                        setStoreTypeOpen(false);
                      }}
                    >
                      {cat.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* hidden input to keep form validation */}
            <input type="hidden" value={form.type_of_store} required />
          </div>

          <div className="auth-field">
            <label>وصف النشاط التجاري</label>
            <textarea
              placeholder="اكتب نبذة مختصرة عن نشاطك التجاري والمنتجات التي تبيعها..."
              value={form.description}
              onChange={set('description')}
              rows={4}
              required
            />
          </div>

          <div className="auth-field">
            <label>صور المتجر أو النشاط التجاري</label>
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
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageChange}
              className="mep-file-hidden"
              aria-label="اختر صور المتجر"
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'جارٍ إرسال الطلب...' : 'إرسال الطلب'}
          </button>
        </form>

        <p className="auth-switch">
          لديك حساب بالفعل؟{' '}
          <Link to="/login">تسجيل الدخول</Link>
        </p>
      </div>
    </div>
  );
}
