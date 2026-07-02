import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMerchantAuth, MerchantShop } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import supabase from '../../lib/supabase';
import { usePublishReadiness } from '../hooks/usePublishReadiness';
import MetaCatalogSettingsCard from '../components/MetaCatalogSettingsCard';

interface Zone { id: string; name: string; }

// Red star shown on required field labels
const Req = () => <span className="mep-req">*</span>;

interface Props {
  onNavigate?: (page: string) => void;
  highlightIncomplete?: boolean;
}

type SettingsTab = 'basic' | 'social' | 'connected' | 'integrations';

export default function MerchantShopSettings({ onNavigate, highlightIncomplete = false }: Props) {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
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
  const [activeTab, setActiveTab]   = useState<SettingsTab>('basic');

  // Publish readiness
  const { checks, allPassed } = usePublishReadiness(shop);
  const [publishing, setPublishing]       = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishError, setPublishError]   = useState('');
  const [showMissingAlert, setShowMissingAlert] = useState(false);

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
  const basicIncomplete = logoMissing || nameMissing || descMissing || locationMissing;

  const handlePublish = async () => {
    if (!shop) return;
    if (!allPassed) {
      setShowMissingAlert(true);
      return;
    }
    setPublishing(true);
    setPublishError('');

    if (!navigator.geolocation) {
      setPublishError(t('shopSettings.errors.geoNotSupported'));
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
      setPublishError(t('shopSettings.errors.geoDenied'));
      setPublishing(false);
      return;
    }

    const { error } = await supabase
      .from('shops')
      .update({ status: 'published', shop_lat: publishLat, shop_lng: publishLng })
      .eq('shop_id', shop.shop_id);

    if (error) {
      setPublishError(t('shopSettings.errors.publishFailed', { message: error.message }));
    } else {
      updateShopLocally({ ...shop, status: 'published', latitude: publishLat, longitude: publishLng });
      setPublishSuccess(true);
    }
    setPublishing(false);
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
      setSaveError(t('shopSettings.errors.fillName'));
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
        setSaveError(t('shopSettings.errors.merchantNotFound'));
        setSaving(false);
        return;
      }

      const { data, error: insertErr } = await supabase
        .from('shops')
        .insert({ merchant_id: merchantRow.id, ...payload })
        .select().single();

      if (insertErr || !data) {
        setSaveError(t('shopSettings.errors.createFailed', { message: insertErr?.message ?? t('shopSettings.errors.unknownError') }));
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
      setSaveError(t('shopSettings.errors.saveFailed', { message: updateErr.message }));
      setSaving(false);
      return;
    }

    const savedRow = rows?.[0];
    if (!savedRow) {
      setSaveError(t('shopSettings.errors.noPermission'));
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
    <div className="mep-root" dir={direction}>
      <div className="mep-top-row">
        <h1 className="mep-title">{isCreate ? t('shopSettings.title.create') : t('shopSettings.title.edit')}</h1>

        {!isCreate && (
          shop?.status === 'published' ? (
            <div className="mep-published-badge">
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t('shopSettings.publishedBadge')}
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
                {publishing ? t('shopSettings.publishTop.publishing') : t('shopSettings.publishTop.publish')}
              </button>
            </div>
          )
        )}
      </div>

      {publishSuccess && <div className="mep-save-success">{t('shopSettings.publishSuccess')}</div>}

      {highlightIncomplete && (
        <div className="mep-incomplete-banner">
          {t('shopSettings.incompleteBanner')}
        </div>
      )}

      <div className="mep-settings-layout">

      {/* ── Tabs (vertical) ── */}
      <div className="mep-tabs-vertical">
        <button
          type="button"
          className={`mep-tab-vertical${activeTab === 'basic' ? ' mep-tab-vertical--active' : ''}`}
          onClick={() => setActiveTab('basic')}
        >
          {highlightIncomplete && basicIncomplete && <span className="mep-tab-dot" />}
          {t('shopSettings.tabs.basic')}
        </button>
        <button
          type="button"
          className={`mep-tab-vertical${activeTab === 'social' ? ' mep-tab-vertical--active' : ''}`}
          onClick={() => setActiveTab('social')}
        >
          {highlightIncomplete && socialMissing && <span className="mep-tab-dot" />}
          {t('shopSettings.tabs.social')}
        </button>
        {!isCreate && (
          <button
            type="button"
            className={`mep-tab-vertical${activeTab === 'connected' ? ' mep-tab-vertical--active' : ''}`}
            onClick={() => setActiveTab('connected')}
          >
            {t('shopSettings.tabs.connected')}
          </button>
        )}
        {!isCreate && (
          <button
            type="button"
            className={`mep-tab-vertical${activeTab === 'integrations' ? ' mep-tab-vertical--active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            {t('shopSettings.tabs.integrations')}
          </button>
        )}
      </div>

      <div className="mep-settings-content">

      {/* ── Basic info (logo + name + location + description) ── */}
      {activeTab === 'basic' && (
        <div className="mep-section">
          <h2 className="mep-section-title">{t('shopSettings.basic.logoSectionTitle')} <Req /></h2>
          <div className={`mep-logo-area${inc(logoMissing)}`}>
            <div
              className="mep-logo-preview"
              onClick={() => logoInputRef.current?.click()}
              title={t('shopSettings.basic.logoPreviewTitle')}
            >
              {logoUrl
                ? <img src={logoUrl} alt={t('shopSettings.basic.logoAlt')} />
                : <span className="mep-logo-placeholder">🏪</span>
              }
            </div>
            <div>
              <div className="mep-logo-info">
                {t('shopSettings.basic.logoInfoLine1')}<br />
                {t('shopSettings.basic.logoInfoLine2')}
              </div>
              <button type="button" className="mep-logo-btn" onClick={() => logoInputRef.current?.click()}>
                {t('shopSettings.basic.logoChooseBtn')}
              </button>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoChange}
              className="mep-file-hidden"
              aria-label={t('shopSettings.basic.logoInputAriaLabel')}
            />
          </div>

          <h2 className="mep-section-title" style={{ marginTop: '1.75rem' }}>{t('shopSettings.basic.infoSectionTitle')}</h2>
          <div className="mep-fields">

            <div className={`mep-field${inc(nameMissing)}`}>
              <label>{t('shopSettings.basic.nameLabel')} <Req /></label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('shopSettings.basic.namePlaceholder')}
              />
            </div>

            <div className={`mep-field${inc(locationMissing)}`}>
              <label>{t('shopSettings.basic.locationLabel')} <Req /></label>
              <select
                title={t('shopSettings.basic.locationSelectTitle')}
                value={zoneId}
                onChange={e => {
                  const selected = zones.find(z => z.id === e.target.value);
                  setZoneId(e.target.value);
                  setLocation(selected?.name ?? '');
                }}
                className="mep-location-select"
              >
                <option value="">{t('shopSettings.basic.locationPlaceholder')}</option>
                {zones.map(z => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>

            <div className={`mep-field${inc(descMissing)}`}>
              <label>
                {t('shopSettings.basic.descLabel')} <Req />
                <span className="mep-label-hint">{t('shopSettings.basic.descHint')}</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('shopSettings.basic.descPlaceholder')}
              />
            </div>

          </div>
        </div>
      )}

      {/* ── Social links ── */}
      {activeTab === 'social' && (
        <div className="mep-section">
          <h2 className="mep-section-title">
            {t('shopSettings.social.sectionTitle')}
            {highlightIncomplete && socialMissing && (
              <span className="mep-section-req-note">{t('shopSettings.social.requiredNote')}</span>
            )}
          </h2>
          <div className="mep-fields">

            <div className="mep-field">
              <label>{t('shopSettings.social.whatsappLabel')}</label>
              <div className="mep-whatsapp-split" dir="ltr">
                <select
                  title={t('shopSettings.social.countryCodeTitle')}
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
                  placeholder={t('shopSettings.social.whatsappPlaceholder')}
                  maxLength={8}
                  className="mep-whatsapp-local"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="mep-field">
              <label>{t('shopSettings.social.facebookLabel')}</label>
              <input
                type="text"
                value={facebook}
                onChange={e => setFacebook(e.target.value)}
                placeholder={t('shopSettings.social.facebookPlaceholder')}
                dir="ltr"
              />
            </div>

            <div className="mep-field">
              <label>{t('shopSettings.social.instagramLabel')}</label>
              <input
                type="text"
                value={instagram}
                onChange={e => setInstagram(e.target.value)}
                placeholder={t('shopSettings.social.instagramPlaceholder')}
                dir="ltr"
              />
            </div>

          </div>
        </div>
      )}

      {/* ── Connected Accounts ── */}
      {!isCreate && activeTab === 'connected' && (
        <div className="mep-section">
          <h2 className="mep-section-title">{t('shopSettings.connected.sectionTitle')}</h2>
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
                  <div className="ca-card-title">{t('shopSettings.connected.instagramBusiness')}</div>
                  {instagram.trim()
                    ? <div className="ca-badge ca-badge-connected">{t('shopSettings.connected.connected')}</div>
                    : <div className="ca-badge ca-badge-disconnected">{t('shopSettings.connected.disconnected')}</div>
                  }
                </div>
              </div>
              {instagram.trim()
                ? <p className="ca-card-desc">{t('shopSettings.connected.accountLabel')} <strong dir="ltr">{instagram}</strong></p>
                : <p className="ca-card-desc">{t('shopSettings.connected.addAccountHint')}</p>
              }
              <div className="ca-card-actions">
                <button type="button" className="ca-btn ca-btn-secondary" onClick={() => onNavigate?.('drafts')}>
                  {t('shopSettings.connected.viewDraftProducts')}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Integrations ── */}
      {!isCreate && activeTab === 'integrations' && (
        <div className="mep-section">
          <h2 className="mep-section-title">{t('shopSettings.integrations.sectionTitle')}</h2>
          <MetaCatalogSettingsCard />
        </div>
      )}

      {saveSuccess && (
        <div className="mep-save-success">
          {isCreate ? t('shopSettings.save.successCreate') : t('shopSettings.save.successUpdate')}
        </div>
      )}
      {saveError && <div className="md-page-error">{saveError}</div>}

      <button type="button" className="mep-save-btn" onClick={handleSave} disabled={saving}>
        {saving ? t('shopSettings.save.saving') : isCreate ? t('shopSettings.save.btnCreate') : t('shopSettings.save.btnUpdate')}
      </button>

      </div>
      </div>

      {showMissingAlert && (
        <div className="mep-alert-overlay" onClick={() => setShowMissingAlert(false)}>
          <div className="mep-alert-box" onClick={e => e.stopPropagation()}>
            <h3 className="mep-alert-title">{t('shopSettings.alert.title')}</h3>
            <ul className="mep-alert-list">
              {checks.filter(c => !c.passed).map(c => (
                <li key={c.id}>
                  <span className="mep-alert-x">✗</span> {c.label}
                </li>
              ))}
            </ul>
            <p className="mep-alert-hint">{t('shopSettings.alert.hint')}</p>
            <button type="button" className="mep-alert-close-btn" onClick={() => setShowMissingAlert(false)}>
              {t('shopSettings.alert.closeBtn')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
