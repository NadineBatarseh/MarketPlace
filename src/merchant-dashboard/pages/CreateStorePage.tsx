import { useState, useRef, ChangeEvent } from 'react';
import { useMerchantAuth, MerchantShop } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

const ALL_CATEGORIES = [
  'ملابس رجالية', 'ملابس نسائية', 'ملابس أطفال', 'إكسسوارات',
  'أدوات منزلية', 'إلكترونيات', 'مستلزمات مطبخ', 'عطور ومستحضرات',
  'رياضة وترفيه', 'ألعاب أطفال', 'كتب وقرطاسية', 'أخرى',
];

interface Props {
  onCreated: (shop: MerchantShop) => void;
}

export default function CreateStorePage({ onCreated }: Props) {
  const { merchant } = useMerchantAuth();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const toggleCategory = (cat: string) => {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };


  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');

  if (!name.trim()) { setError('يرجى إدخال اسم المتجر'); return; }
  if (!location.trim()) { setError('يرجى إدخال موقع المتجر'); return; }
  if (categories.length === 0) { setError('يرجى اختيار فئة واحدة على الأقل'); return; }
  if (!merchant) { setError('يجب تسجيل الدخول أولاً'); return; }

  setSaving(true);

  // 1) get merchant row from merchants table
  const { data: merchantRow, error: merchantErr } = await supabase    .from('merchants')
    .select('id, user_id')
    .eq('user_id', merchant.id)
    .single();

  if (merchantErr || !merchantRow) {
    setError('تعذر العثور على سجل التاجر في جدول merchants');
    setSaving(false);
    return;
  }
  



  // 2) use correct ids
  const { data, error: insertErr } = await supabase
    .from('shops')
    .insert({
      owner_id: merchant.id,         // Users.user_id
      merchant_id: merchantRow.id,   // merchants.id
      name: name.trim(),
      location: location.trim(),
      description: description.trim() || null,
      shopLogo: logoUrl,
      status: 'pending',
      categories,
    })
    .select()
    .single();

  if (insertErr || !data) {
    setError('تعذّر إنشاء المتجر: ' + (insertErr?.message ?? 'خطأ غير معروف'));
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
    categories
  };

  onCreated(newShop);
  setSaving(false);
};

  // function handleLogoChange(event: ChangeEvent<HTMLInputElement>): void {
  //   throw new Error('Function not implemented.');
  // }

  // function toggleCategory(cat: string): void {
  //   throw new Error('Function not implemented.');
  // }

  return (
    <div className="csp-root">
      <h1 className="csp-title">أنشئ صفحة متجرك</h1>
      <p className="csp-subtitle">
        أدخل بيانات متجرك وسيتم مراجعتها من قِبل الإدارة قبل النشر على المنصة
      </p>

      <form className="csp-form-card" onSubmit={handleSubmit}>
        {/* Logo */}
        <div className="csp-field">
          <label>شعار المتجر</label>
          <div className="csp-logo-upload">
            <div className="csp-logo-preview" onClick={() => logoInputRef.current?.click()} title="انقر لاختيار شعار">
              {logoUrl
                ? <img src={logoUrl} alt="الشعار" />
                : <span className="csp-logo-placeholder">🏪</span>
              }
            </div>
            <div className="csp-logo-hint">
              اختر صورة تعبر عن هوية متجرك<br />
              (اختياري — يمكنك إضافته لاحقاً)
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="mep-file-hidden" aria-label="اختر شعار المتجر" />
          </div>
        </div>

        {/* Store name */}
        <div className="csp-field">
          <label htmlFor="csp-name">اسم المتجر *</label>
          <input id="csp-name" type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="مثال: متجر النور" autoFocus />
        </div>

        {/* Location */}
        <div className="csp-field">
          <label htmlFor="csp-location">الموقع / المنطقة *</label>
          <input id="csp-location" type="text" value={location} onChange={e => setLocation(e.target.value)}
            placeholder="مثال: القاهرة، مدينة نصر" />
        </div>

        {/* Description */}
        <div className="csp-field">
          <label htmlFor="csp-desc">وصف المتجر</label>
          <input id="csp-desc" type="text" value={description} onChange={e => setDescription(e.target.value)}
            placeholder="وصف مختصر عن متجرك (اختياري)" />
        </div>

        {/* Categories */}
        <div className="csp-field">
          <label>فئات المتجر * (اختر واحدة أو أكثر)</label>
          <div className="csp-categories">
            {ALL_CATEGORIES.map(cat => (
              <button
                type="button"
                key={cat}
                className={`csp-cat-chip${categories.includes(cat) ? ' selected' : ''}`}
                onClick={() => toggleCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="csp-error" role="alert">{error}</div>}

        <button type="submit" className="csp-submit-btn" disabled={saving}>
          {saving ? 'جاري الإرسال...' : '🚀 إرسال الطلب للمراجعة'}
        </button>
      </form>
    </div>
  );
}
