import { useState, useRef } from 'react';
import { useMerchantAuth, MerchantShop } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

const ALL_CATEGORIES = [
  'ملابس رجالية', 'ملابس نسائية', 'ملابس أطفال', 'إكسسوارات',
  'أدوات منزلية', 'إلكترونيات', 'مستلزمات مطبخ', 'عطور ومستحضرات',
  'رياضة وترفيه', 'ألعاب أطفال', 'كتب وقرطاسية', 'أخرى',
];

export default function MerchantShopSettings() {
  const { merchant, updateShopLocally } = useMerchantAuth();
  const shop = merchant!.shop;
  const isCreate = shop === null;

  const [name, setName] = useState(shop?.name ?? '');
  const [location, setLocation] = useState(shop?.location ?? '');
  const [description, setDescription] = useState(shop?.description ?? '');
  const [whatsapp, setWhatsapp] = useState(shop?.whatsapp ?? '');
  const [facebook, setFacebook] = useState(shop?.facebook ?? '');
  const [instagram, setInstagram] = useState(shop?.instagram ?? '');
  const [categories, setCategories] = useState<string[]>(shop?.categories ?? []);
  const [logoUrl, setLogoUrl] = useState<string | null>(shop?.shopLogo ?? null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  const handleSave = async () => {
    if (!name.trim() || !location.trim() || categories.length === 0) {
      setSaveError('يرجى ملء اسم المتجر والموقع واختيار فئة واحدة على الأقل');
      return;
    }
    setSaving(true);
    setSaveError('');

    if (isCreate) {
      const { data: merchantRow, error: mErr } = await supabase
        .from('merchants')
        .select('id')
        .eq('user_id', merchant!.id)
        .single();

      if (mErr || !merchantRow) {
        setSaveError('تعذر العثور على سجل التاجر');
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
          whatsapp: whatsapp.trim() || null,
          facebook: facebook.trim() || null,
          instagram: instagram.trim() || null,
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
      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      return;
    }

    // UPDATE
    const { error: updateErr } = await supabase
      .from('shops')
      .update({
        name: name.trim(),
        location: location.trim(),
        description: description.trim() || null,
        shopLogo: logoUrl,
        categories,
        whatsapp: whatsapp.trim() || null,
        facebook: facebook.trim() || null,
        instagram: instagram.trim() || null,
      })
      .eq('shop_id', shop!.shop_id)
      .eq('owner_id', merchant!.id);

    if (updateErr) {
      setSaveError('تعذّر الحفظ: ' + updateErr.message);
      setSaving(false);
      return;
    }

    updateShopLocally({
      ...shop!,
      name: name.trim(),
      location: location.trim(),
      description: description.trim() || null,
      shopLogo: logoUrl,
      categories,
      whatsapp: whatsapp.trim() || null,
      facebook: facebook.trim() || null,
      instagram: instagram.trim() || null,
    });
    setSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="mep-root">
      <h1 className="mep-title">{isCreate ? 'إنشاء متجرك' : 'إعدادات المتجر'}</h1>

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

      {/* Social links */}
      <div className="mep-section">
        <h2 className="mep-section-title">🔗 روابط التواصل الاجتماعي</h2>
        <div className="mep-fields">
          <div className="mep-field">
            <label>واتساب</label>
            <input type="text" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="مثال: 966501234567" dir="ltr" />
          </div>
          <div className="mep-field">
            <label>فيسبوك</label>
            <input type="text" value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="رابط صفحة الفيسبوك" dir="ltr" />
          </div>
          <div className="mep-field">
            <label>إنستجرام</label>
            <input type="text" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@username أو رابط الحساب" dir="ltr" />
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
          {isCreate ? '🚀 تم إنشاء متجرك بنجاح!' : '✅ تم حفظ إعدادات المتجر بنجاح!'}
        </div>
      )}
      {saveError && <div className="md-page-error">{saveError}</div>}

      <button type="button" className="mep-save-btn" onClick={handleSave} disabled={saving}>
        {saving ? 'جاري الحفظ...' : isCreate ? '🚀 إنشاء المتجر' : '💾 حفظ الإعدادات'}
      </button>
    </div>
  );
}
