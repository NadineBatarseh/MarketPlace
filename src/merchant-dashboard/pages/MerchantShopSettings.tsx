import { useState, useRef, useEffect } from 'react';
import { useMerchantAuth, MerchantShop } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';
import { usePublishReadiness } from '../hooks/usePublishReadiness';

interface Zone { id: string; name: string; }

interface SyncResult {
  synced: number;
  batches: number;
  validationFailures?: { retailer_id: string; errors: string[] }[];
  errors?: string[];
}

const API_BASE = 'http://localhost:4000';

// Red star shown on required field labels
const Req = () => <span className="mep-req">*</span>;

interface Props {
  onNavigate?: (page: string) => void;
  highlightIncomplete?: boolean;
}

export default function MerchantShopSettings({ onNavigate, highlightIncomplete = false }: Props) {
  const { merchant, updateShopLocally } = useMerchantAuth();
  const shop = merchant!.shop;
  const isCreate = shop === null;

  const [zones, setZones]           = useState<Zone[]>([]);
  const [name, setName]             = useState(shop?.name ?? '');
  const [location, setLocation]     = useState(shop?.location ?? '');
  const [zoneId, setZoneId]         = useState(shop?.zone_id ?? '');
  const [description, setDescription] = useState(shop?.description ?? '');
  const _initWA = (() => {
    const d = (shop?.whatsapp ?? '').replace(/\D/g, '');
    if (d.startsWith('972') && d.length > 4) return { code: '972', local: d.slice(4) };
    if (d.startsWith('970') && d.length > 4) return { code: '970', local: d.slice(4) };
    if (d.startsWith('05')) return { code: '970', local: d.slice(2) };
    if (d.startsWith('5') && d.length <= 9) return { code: '970', local: d.slice(1) };
    return { code: '970', local: d };
  })();
  const [whatsappCode, setWhatsappCode] = useState(_initWA.code);
  const [whatsappLocal, setWhatsappLocal] = useState(_initWA.local);
  const [facebook, setFacebook]     = useState(shop?.facebook ?? '');
  const [instagram, setInstagram]   = useState(shop?.instagram ?? '');
  const [logoUrl, setLogoUrl]       = useState<string | null>(shop?.shopLogo ?? null);
  const [saving, setSaving]         = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError]   = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Publish readiness
  const { checks, allPassed } = usePublishReadiness(shop);
  const [publishing, setPublishing]       = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishError, setPublishError]   = useState('');
  const [showMissingAlert, setShowMissingAlert] = useState(false);

  // Meta Catalog sync
  const [metaSyncing, setMetaSyncing]       = useState(false);
  const [metaSyncResult, setMetaSyncResult] = useState<SyncResult | null>(null);
  const [metaSyncError, setMetaSyncError]   = useState('');

  // Load zones and (on create) pre-populate location from the approved application
  useEffect(() => {
    supabase.from('zones').select('id, name').order('name').then(({ data }) => {
      if (data) setZones(data);
    });

    if (isCreate && merchant) {
      supabase
        .from('merchant_applications')
        .select('city, zone_id')
        .eq('platform_email', merchant.email)
        .eq('status', 'approved')
        .maybeSingle()
        .then(({ data }) => {
          if (data?.city) setLocation(data.city);
          if (data?.zone_id) setZoneId(data.zone_id);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returns orange class when field is incomplete and highlight mode is on
  const inc = (missing: boolean) =>
    highlightIncomplete && missing ? ' mep-field--incomplete' : '';

  const logoMissing     = !logoUrl;
  const nameMissing     = name.trim().length === 0;
  const descMissing     = description.trim().length < 20;
  const locationMissing = location.trim().length === 0;
  const socialMissing   = !instagram.trim() && !facebook.trim() && !whatsappLocal.trim();

  const handlePublish = async () => {
    if (!shop) return;
    if (!allPassed) {
      setShowMissingAlert(true);
      return;
    }
    setPublishing(true);
    setPublishError('');

    if (!navigator.geolocation) {
      setPublishError('متصفحك لا يدعم تحديد الموقع — يرجى استخدام متصفح حديث');
      setPublishing(false);
      return;
    }

    let publishLat: number;
    let publishLng: number;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      publishLat = pos.coords.latitude;
      publishLng = pos.coords.longitude;
    } catch {
      setPublishError('تعذّر الوصول إلى موقعك — يرجى السماح بالوصول للموقع لنشر المتجر');
      setPublishing(false);
      return;
    }

    const { error } = await supabase
      .from('shops')
      .update({ status: 'published', shop_lat: publishLat, shop_lng: publishLng })
      .eq('shop_id', shop.shop_id);

    if (error) {
      setPublishError('تعذّر نشر المتجر: ' + error.message);
    } else {
      updateShopLocally({ ...shop, status: 'published', latitude: publishLat, longitude: publishLng });
      setPublishSuccess(true);
    }
    setPublishing(false);
  };

  const handleMetaSync = async () => {
    setMetaSyncing(true);
    setMetaSyncResult(null);
    setMetaSyncError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setMetaSyncError('Session expired — please log in again.');
        setMetaSyncing(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/catalog/sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) setMetaSyncError(json.error ?? 'Sync failed');
      else setMetaSyncResult(json as SyncResult);
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
    if (!name.trim()) {
      setSaveError('يرجى ملء اسم المتجر');
      return;
    }
    setSaving(true);
    setSaveError('');

    const whatsappFull = whatsappLocal.trim()
      ? whatsappCode + '5' + whatsappLocal.trim()
      : null;

    const payload = {
      name: name.trim(),
      location: location.trim() || null,
      zone_id: zoneId || null,
      description: description.trim() || null,
      shopLogo: logoUrl,
      whatsapp: whatsappFull,
      facebook: facebook.trim() || null,
      instagram: instagram.trim() || null,
    };

    if (isCreate) {
      const { data: merchantRow, error: mErr } = await supabase
        .from('merchants').select('id').eq('user_id', merchant!.id).single();

      if (mErr || !merchantRow) {
        setSaveError('تعذر العثور على سجل التاجر');
        setSaving(false);
        return;
      }

      const { data, error: insertErr } = await supabase
        .from('shops')
        .insert({ owner_id: merchant!.id, merchant_id: merchantRow.id, ...payload })
        .select().single();

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
        zone_id: data.zone_id ?? null,
        description: data.description ?? null,
        whatsapp: data.whatsapp ?? null,
        facebook: data.facebook ?? null,
        instagram: data.instagram ?? null,
        merchant_id: data.merchant_id,
        Type_of_store: data.Type_of_store ?? null,
        latitude: data.shop_lat ?? null,
        longitude: data.shop_lng ?? null,
        status: (data.status ?? 'pending').replace(/^'|'$/g, ''),
      };
      updateShopLocally(newShop);
      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      return;
    }

    // UPDATE

    const { data: rows, error: updateErr } = await supabase
      .from('shops').update(payload)
      .eq('shop_id', shop!.shop_id)
      .select();

    if (updateErr) {
      setSaveError('تعذّر الحفظ: ' + updateErr.message);
      setSaving(false);
      return;
    }

    const savedRow = rows?.[0];
    if (!savedRow) {
      setSaveError('تعذّر الحفظ: لا توجد صلاحية لتعديل هذا المتجر — تحقق من إعدادات RLS في Supabase');
      setSaving(false);
      return;
    }

    updateShopLocally({
      ...shop!,
      name: savedRow.name ?? name.trim(),
      location: savedRow.location ?? (location.trim() || null),
      zone_id: savedRow.zone_id ?? (zoneId || null),
      description: savedRow.description ?? (description.trim() || null),
      shopLogo: savedRow.shopLogo ?? logoUrl,
      Type_of_store: savedRow.Type_of_store ?? shop!.Type_of_store,
      whatsapp: savedRow.whatsapp ?? whatsappFull,
      facebook: savedRow.facebook ?? (facebook.trim() || null),
      instagram: savedRow.instagram ?? (instagram.trim() || null),
      latitude: savedRow.shop_lat ?? shop!.latitude,
      longitude: savedRow.shop_lng ?? shop!.longitude,
      status: (savedRow.status as string ?? shop!.status).replace(/^'|'$/g, ''),
    });
    setSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="mep-root">
      <div className="mep-top-row">
        <h1 className="mep-title">{isCreate ? 'إنشاء متجرك' : 'إعدادات المتجر'}</h1>

        {!isCreate && (
          shop?.status === 'published' ? (
            <div className="mep-published-badge">
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              منشور
            </div>
          ) : (
            <div className="mep-publish-top-wrap">
              {publishError && <p className="mep-publish-error-inline">{publishError}</p>}
              <button
                type="button"
                className="mep-publish-btn-top"
                onClick={handlePublish}
                disabled={publishing}
              >
                {publishing ? 'جاري النشر...' : 'انشر المتجر'}
              </button>
            </div>
          )
        )}
      </div>

      {publishSuccess && <div className="mep-save-success">🎉 تم نشر متجرك بنجاح!</div>}

      {highlightIncomplete && (
        <div className="mep-incomplete-banner">
          أكمل الحقول المميزة بالبرتقالي لتتمكن من نشر متجرك
        </div>
      )}

      {/* ── Logo ── */}
      <div className="mep-section">
        <h2 className="mep-section-title">🖼️ شعار المتجر <Req /></h2>
        <div className={`mep-logo-area${inc(logoMissing)}`}>
          <div
            className="mep-logo-preview"
            onClick={() => logoInputRef.current?.click()}
            title="انقر لتغيير الشعار"
          >
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
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoChange}
            className="mep-file-hidden"
            aria-label="اختر شعار المتجر"
          />
        </div>
      </div>

      {/* ── Basic info ── */}
      <div className="mep-section">
        <h2 className="mep-section-title">📋 معلومات المتجر</h2>
        <div className="mep-fields">

          <div className={`mep-field${inc(nameMissing)}`}>
            <label>اسم المتجر <Req /></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="أدخل اسم متجرك"
            />
          </div>

          <div className={`mep-field${inc(locationMissing)}`}>
            <label>المنطقة / المدينة <Req /></label>
            <select
              title="المنطقة / المدينة"
              value={zoneId}
              onChange={e => {
                const selected = zones.find(z => z.id === e.target.value);
                setZoneId(e.target.value);
                setLocation(selected?.name ?? '');
              }}
              className="mep-location-select"
            >
              <option value="">اختر المنطقة</option>
              {zones.map(z => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>

          <div className={`mep-field${inc(descMissing)}`}>
            <label>
              وصف المتجر <Req />
              <span className="mep-label-hint">(20 حرف على الأقل)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="وصف مختصر عن متجرك ومنتجاتك"
            />
          </div>

        </div>
      </div>

      {/* ── Social links ── */}
      <div className="mep-section">
        <h2 className="mep-section-title">
          🔗 روابط التواصل الاجتماعي
          {highlightIncomplete && socialMissing && (
            <span className="mep-section-req-note">مطلوب واحد على الأقل</span>
          )}
        </h2>
        <div className="mep-fields">

          <div className="mep-field">
            <label>واتساب</label>
            <div className="mep-whatsapp-split" dir="ltr">
              <select
                title="رمز الدولة"
                value={whatsappCode}
                onChange={e => setWhatsappCode(e.target.value)}
                className="mep-whatsapp-code"
              >
                <option value="970">+970</option>
                <option value="972">+972</option>
              </select>
              <span className="mep-whatsapp-prefix">05</span>
              <input
                type="text"
                value={whatsappLocal}
                onChange={e => setWhatsappLocal(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="XXXXXXXX"
                maxLength={8}
                className="mep-whatsapp-local"
                dir="ltr"
              />
            </div>
          </div>

          <div className="mep-field">
            <label>فيسبوك</label>
            <input
              type="text"
              value={facebook}
              onChange={e => setFacebook(e.target.value)}
              placeholder="رابط صفحة الفيسبوك"
              dir="ltr"
            />
          </div>

          <div className="mep-field">
            <label>إنستجرام</label>
            <input
              type="text"
              value={instagram}
              onChange={e => setInstagram(e.target.value)}
              placeholder="@username أو رابط الحساب"
              dir="ltr"
            />
          </div>

        </div>
      </div>

      {/* ── Connected Accounts ── */}
      {!isCreate && (
        <div className="mep-section">
          <h2 className="mep-section-title">🔌 الحسابات المرتبطة</h2>
          <div className="ca-grid">

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

      {showMissingAlert && (
        <div className="mep-alert-overlay" onClick={() => setShowMissingAlert(false)}>
          <div className="mep-alert-box" onClick={e => e.stopPropagation()}>
            <h3 className="mep-alert-title">أكمل هذه الخطوات لنشر متجرك</h3>
            <ul className="mep-alert-list">
              {checks.filter(c => !c.passed).map(c => (
                <li key={c.id}>
                  <span className="mep-alert-x">✗</span> {c.label}
                </li>
              ))}
            </ul>
            <p className="mep-alert-hint">احفظ الإعدادات أولاً ثم اضغط «انشر المتجر»</p>
            <button type="button" className="mep-alert-close-btn" onClick={() => setShowMissingAlert(false)}>
              حسناً، سأكملها
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
