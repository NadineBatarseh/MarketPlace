import { useState, useRef } from 'react';
import { useMerchantAuth, MerchantShop } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

interface SyncResult {
  synced: number;
  batches: number;
  validationFailures?: { retailer_id: string; errors: string[] }[];
  errors?: string[];
}

const API_BASE = 'http://localhost:4000';

const STORE_TYPES = [
  'ملابس رجالية', 'ملابس نسائية', 'ملابس أطفال', 'ملابس رياضية',
  'عبايات وأزياء محتشمة', 'ملابس سهرة وزفاف', 'ملابس داخلية',
  'أحذية', 'حقائب وشنط', 'إكسسوارات', 'مجوهرات وأساور',
  'ساعات', 'نظارات', 'متجر أزياء متكامل',
];

export default function MerchantShopSettings({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { merchant, updateShopLocally } = useMerchantAuth();
  const shop = merchant!.shop;
  const isCreate = shop === null;

  const [name, setName] = useState(shop?.name ?? '');
  const [location, setLocation] = useState(shop?.location ?? '');
  const [description, setDescription] = useState(shop?.description ?? '');
  const [whatsapp, setWhatsapp] = useState(shop?.whatsapp ?? '');
  const [facebook, setFacebook] = useState(shop?.facebook ?? '');
  const [instagram, setInstagram] = useState(shop?.instagram ?? '');
  const [typeOfStore, setTypeOfStore] = useState<string>(shop?.Type_of_store ?? '');
  const [logoUrl, setLogoUrl] = useState<string | null>(shop?.shopLogo ?? null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Meta Catalog sync
  const [metaSyncing, setMetaSyncing] = useState(false);
  const [metaSyncResult, setMetaSyncResult] = useState<SyncResult | null>(null);
  const [metaSyncError, setMetaSyncError] = useState('');

  const handleMetaSync = async () => {
    setMetaSyncing(true);
    setMetaSyncResult(null);
    setMetaSyncError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setMetaSyncError('Session expired — please log in again.'); setMetaSyncing(false); return; }
      const res = await fetch(`${API_BASE}/api/catalog/sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) { setMetaSyncError(json.error ?? 'Sync failed'); }
      else { setMetaSyncResult(json as SyncResult); }
    } catch (e) {
      setMetaSyncError(e instanceof Error ? e.message : 'Network error');
    }
    setMetaSyncing(false);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!name.trim() || !location.trim() || !typeOfStore) {
      setSaveError('يرجى ملء اسم المتجر والموقع ونوع المتجر');
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
          Type_of_store: typeOfStore,
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
        Type_of_store: data.Type_of_store ?? null,
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
        Type_of_store: typeOfStore,
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
      Type_of_store: typeOfStore,
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
          <div className="mep-field">
            <label>نوع المتجر *</label>
            <select value={typeOfStore} onChange={e => setTypeOfStore(e.target.value)}>
              <option value="">-- اختر نوع المتجر --</option>
              {STORE_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
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

      {/* Connected Accounts */}
      {!isCreate && (
        <div className="mep-section">
          <h2 className="mep-section-title">🔌 الحسابات المرتبطة</h2>
          <div className="ca-grid">

            {/* Instagram card */}
            <div className="ca-card">
              <div className="ca-card-header">
                <div className="ca-card-icon ca-icon-instagram">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                </div>
                <div>
                  <div className="ca-card-title">Instagram Business</div>
                  {instagram.trim()
                    ? <div className="ca-badge ca-badge-connected">● مرتبط</div>
                    : <div className="ca-badge ca-badge-disconnected">○ غير مرتبط</div>
                  }
                </div>
              </div>
              {instagram.trim()
                ? <p className="ca-card-desc">الحساب: <strong dir="ltr">{instagram}</strong></p>
                : <p className="ca-card-desc">أضف حساب إنستجرام في قسم روابط التواصل الاجتماعي أعلاه لتفعيل استيراد المنتجات.</p>
              }
              <div className="ca-card-actions">
                <button type="button" className="ca-btn ca-btn-secondary" onClick={() => onNavigate?.('drafts')}>
                  عرض المنتجات المسودة
                </button>
              </div>
            </div>

            {/* Meta Catalog card */}
            <div className="ca-card">
              <div className="ca-card-header">
                <div className="ca-card-icon ca-icon-meta">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.04c-5.5 0-9.96 4.46-9.96 9.96 0 4.41 2.87 8.16 6.84 9.49.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0 1 12 6.84c.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A9.97 9.97 0 0 0 21.96 12c0-5.5-4.46-9.96-9.96-9.96z"/>
                  </svg>
                </div>
                <div>
                  <div className="ca-card-title">Meta Product Catalog</div>
                  <div className="ca-badge ca-badge-connected">● مُفعَّل</div>
                </div>
              </div>
              <p className="ca-card-desc">زامن منتجاتك مع كتالوج Meta لعرضها على Facebook وInstagram Shopping.</p>

              {metaSyncResult && (
                <div className="ca-sync-result ca-sync-ok">
                  ✓ تمت مزامنة {metaSyncResult.synced} منتج في {metaSyncResult.batches} دفعة
                  {metaSyncResult.validationFailures?.length ? ` (${metaSyncResult.validationFailures.length} تم تخطيها)` : ''}
                </div>
              )}
              {metaSyncError && <div className="ca-sync-result ca-sync-error">✕ {metaSyncError}</div>}

              <div className="ca-card-actions">
                <button type="button" className="ca-btn ca-btn-primary" onClick={handleMetaSync} disabled={metaSyncing}>
                  {metaSyncing ? 'جاري المزامنة...' : '↑ مزامنة جميع المنتجات'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

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
