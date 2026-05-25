import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { validateIsraeliId } from '../../utils/validateIsraeliId';
import { useFieldHint } from './useFieldHint';
import './Auth.css';

const MAX_IMAGES = 8;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const DESC_MAX = 500;

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
    national_id: '',
    name_of_store: '',
    email: '',
    city: '',
    zone_id: '',
    type_of_store_id: '',
    description: '',
  });
  const [phoneCode, setPhoneCode] = useState('970');
  const [phoneLocal, setPhoneLocal] = useState('');
  const phoneHint = useFieldHint();
  const nameHint = useFieldHint();
  const idHint = useFieldHint();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
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
      .then(({ data }) => { if (data) setCategories(data); });

    supabase
      .from('zones')
      .select('id, name')
      .order('name')
      .then(({ data }) => { if (data) setZones(data); });
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

    const oversized = files.filter(f => f.size > MAX_FILE_BYTES);
    if (oversized.length > 0) {
      setError(`حجم الصورة يجب أن لا يتجاوز 5 ميغابايت: ${oversized.map(f => f.name).join('، ')}`);
      return;
    }

    const totalAfter = pendingFiles.length + files.length;
    if (totalAfter > MAX_IMAGES) {
      setError(`الحد الأقصى ${MAX_IMAGES} صور`);
      return;
    }

    setError('');
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

    if (form.name_of_owner.trim().length < 2) {
      setError('يرجى إدخال الاسم الكامل');
      return;
    }

    const idCheck = validateIsraeliId(form.national_id);
    if (!idCheck.valid) {
      setError(idCheck.reason);
      return;
    }

    if (phoneLocal.trim().length !== 8) {
      setError('رقم الهاتف غير صحيح — أدخل 8 أرقام بعد 05');
      return;
    }

    if (!form.city) {
      setError('يرجى اختيار المدينة');
      return;
    }

    if (!form.type_of_store_id) {
      setError('يرجى اختيار نوع المتجر');
      return;
    }

    if (pendingFiles.length === 0) {
      setError('يرجى إضافة صورة واحدة على الأقل للمتجر أو النشاط التجاري');
      return;
    }

    setLoading(true);

    const folderName = `${Date.now()}_${form.name_of_store.trim() || 'unknown'}`;
    setUploadProgress({ current: 0, total: pendingFiles.length });

    let uploadedUrls: string[];
    try {
      uploadedUrls = await Promise.all(
        pendingFiles.map(async (file, i) => {
          const ext = file.name.split('.').pop();
          const path = `${folderName}/${i}.${ext}`;
          const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('merchant-applications')
            .upload(path, file, { upsert: true });
          if (uploadErr) throw new Error(uploadErr.message);
          const { data: urlData } = supabase.storage.from('merchant-applications').getPublicUrl(uploadData.path);
          setUploadProgress(p => ({ ...p, current: p.current + 1 }));
          return urlData.publicUrl;
        })
      );
    } catch (err: unknown) {
      setError('تعذّر رفع الصورة: ' + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
      return;
    }

    const { data, error: dbError } = await supabase
      .from('merchant_applications')
      .insert({
        name_of_owner: form.name_of_owner,
        national_id: form.national_id,
        name_of_store: form.name_of_store,
        email: form.email,
        phone_number: phoneCode + '5' + phoneLocal.trim(),
        city: form.city,
        zone_id: form.zone_id || null,
        Type_of_store: form.type_of_store_id,
        description: form.description,
        pictures: uploadedUrls.length > 0 ? uploadedUrls : null,
        status: 'pending',
      })
      .select('id')
      .single();

    setLoading(false);

    if (dbError) {
      setError('حدث خطأ أثناء إرسال الطلب: ' + dbError.message);
      return;
    }

    if (data?.id) setSubmissionId(String(data.id).slice(0, 8).toUpperCase());
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setSubmitted(true);
  };

  const selectedCategoryLabel = categories.find(c => c.id === form.type_of_store_id)?.label;

  const loadingLabel = (() => {
    if (!loading) return 'إرسال الطلب';
    if (uploadProgress.total > 0 && uploadProgress.current < uploadProgress.total) {
      return `جارٍ رفع الصور (${uploadProgress.current}/${uploadProgress.total})...`;
    }
    return 'جارٍ إرسال الطلب...';
  })();

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
            {submissionId && (
              <>
                <br /><br />
                رقم طلبك المرجعي: <strong dir="ltr">#{submissionId}</strong>
              </>
            )}
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
              <label>اسم صاحب العمل <span className="auth-required-star">*</span></label>
              <input
                placeholder="الاسم الكامل"
                value={form.name_of_owner}
                minLength={2}
                onChange={e => {
                  const raw = e.target.value;
                  if (/[0-9]/.test(raw)) nameHint.show('لا يُسمح بالأرقام في هذا الحقل');
                  setForm(f => ({ ...f, name_of_owner: raw.replace(/[0-9]/g, '') }));
                }}
                required
              />
              {nameHint.hint && <p className="auth-phone-hint">{nameHint.hint}</p>}
            </div>
            <div className="auth-field">
              <label>رقم الهوية <span className="auth-required-star">*</span></label>
              <input
                placeholder="xxxxxxxxx"
                value={form.national_id}
                inputMode="numeric"
                onChange={e => {
                  const raw = e.target.value;
                  const digits = raw.replace(/\D/g, '');
                  if (/\D/.test(raw)) idHint.show('أرقام فقط');
                  else if (digits.length > 9) idHint.show('الحد الأقصى 9 أرقام');
                  else idHint.clear();
                  setForm(f => ({ ...f, national_id: digits.slice(0, 9) }));
                }}
                required
              />
              {idHint.hint && <p className="auth-phone-hint">{idHint.hint}</p>}
            </div>
          </div>

          <div className="auth-field">
            <label>اسم المتجر <span className="auth-required-star">*</span></label>
            <input placeholder="اسم المتجر أو الشركة" value={form.name_of_store} onChange={set('name_of_store')} required />
          </div>

          <div className="auth-field">
            <label>البريد الإلكتروني <span className="auth-required-star">*</span></label>
            <input type="email" placeholder="example@email.com" value={form.email} onChange={set('email')} required />
          </div>

          <div className="auth-row">
            <div className="auth-field">
              <label>رقم الهاتف <span className="auth-required-star">*</span></label>
              <div className="auth-phone-split" dir="ltr">
                <select
                  title="رمز الدولة"
                  value={phoneCode}
                  onChange={e => setPhoneCode(e.target.value)}
                  className="auth-phone-code"
                >
                  <option value="970">+970</option>
                  <option value="972">+972</option>
                </select>
                <span className="auth-phone-prefix">05</span>
                <input
                  type="text"
                  value={phoneLocal}
                  inputMode="numeric"
                  onChange={e => {
                    const raw = e.target.value;
                    const digits = raw.replace(/\D/g, '');
                    if (/[^\d]/.test(raw)) phoneHint.show('أرقام فقط');
                    else if (digits.length > 8) phoneHint.show('الحد الأقصى 8 أرقام');
                    else phoneHint.clear();
                    setPhoneLocal(digits.slice(0, 8));
                  }}
                  placeholder="XXXXXXXX"
                  className="auth-phone-local"
                  dir="ltr"
                  required
                />
              </div>
              {phoneHint.hint && <p className="auth-phone-hint">{phoneHint.hint}</p>}
            </div>
            <div className="auth-field">
              <label>المدينة <span className="auth-required-star">*</span></label>
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
            </div>
          </div>

          <div className="auth-field">
            <label>نوع المتجر <span className="auth-required-star">*</span></label>
            <div className="auth-custom-select" ref={storeTypeRef}>
              <button
                type="button"
                className={`auth-custom-select-trigger${!form.type_of_store_id ? ' auth-custom-select-placeholder' : ''}`}
                onClick={() => setStoreTypeOpen(o => !o)}
              >
                {selectedCategoryLabel || 'اختر النوع'}
                <span className="auth-custom-select-arrow">{storeTypeOpen ? '▲' : '▼'}</span>
              </button>
              {storeTypeOpen && (
                <ul className="auth-custom-select-list">
                  {categories.map(cat => (
                    <li
                      key={cat.id}
                      className={`auth-custom-select-option${form.type_of_store_id === cat.id ? ' selected' : ''}`}
                      onMouseDown={() => {
                        setForm(f => ({ ...f, type_of_store_id: cat.id }));
                        setStoreTypeOpen(false);
                      }}
                    >
                      {cat.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="auth-field">
            <label>وصف النشاط التجاري <span className="auth-required-star">*</span></label>
            <textarea
              placeholder="اكتب نبذة مختصرة عن نشاطك التجاري والمنتجات التي تبيعها..."
              value={form.description}
              onChange={e => {
                if (e.target.value.length <= DESC_MAX) set('description')(e);
              }}
              rows={4}
              required
            />
            <p className="auth-phone-hint" style={{ opacity: form.description.length > DESC_MAX * 0.8 ? 1 : 0.5 }}>
              {form.description.length}/{DESC_MAX}
            </p>
          </div>

          <div className="auth-field">
            <label>
              ارفع بعض صور من منتجاتك <span className="auth-required-star">*</span>
              <span style={{ fontWeight: 400, fontSize: '0.82em', marginRight: '6px', opacity: 0.6 }}>
                (حتى {MAX_IMAGES} صور، 5 ميغابايت لكل صورة)
              </span>
            </label>
            <div className="apm-imgs-row">
              {previewUrls.map((url, idx) => (
                <div key={idx} className="apm-img-thumb">
                  <img src={url} alt={`صورة ${idx + 1}`} />
                  <button type="button" className="apm-img-remove" onClick={() => removeImage(idx)}>✕</button>
                </div>
              ))}
              {pendingFiles.length < MAX_IMAGES && (
                <div className="apm-img-add" onClick={() => imgInputRef.current?.click()}>
                  <span>📷</span>
                  <span>إضافة صورة</span>
                </div>
              )}
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
            {loadingLabel}
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
