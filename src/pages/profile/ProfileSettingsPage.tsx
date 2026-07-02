import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import {
  fetchProfile,
  saveProfile,
  emptyProfile,
  profilesEqual,
  type ProfileData,
} from '../../lib/profile';
import Topbar from '../../components/Topbar';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import LocationPicker, { type PlaceMeta } from '../../components/LocationPicker';
import { fetchZones, zoneCenter, type Zone } from '../../lib/zones';
import { parsePhone } from '../../lib/formValidation';
import { useFieldHint } from '../auth/useFieldHint';
import './ProfileSettingsPage.css';

type TabKey = 'account' | 'address' | 'security' | 'preferences';
type IconName = 'user' | 'pin' | 'lock' | 'gear' | 'box' | 'heart';

type NavItem =
  | { kind: 'tab'; key: TabKey; label: string; hint: string; icon: IconName }
  | { kind: 'link'; to: string; label: string; icon: IconName };

function NavIcon({ name }: { name: IconName }) {
  const p = {
    width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'user':  return <svg {...p}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></svg>;
    case 'pin':   return <svg {...p}><path d="M12 21.5c4-4.2 6.5-7.6 6.5-11A6.5 6.5 0 0 0 5.5 10.5c0 3.4 2.5 6.8 6.5 11Z" /><circle cx="12" cy="10.2" r="2.3" /></svg>;
    case 'lock':  return <svg {...p}><rect x="4.8" y="10.5" width="14.4" height="9.5" rx="2.2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;
    case 'gear':  return <svg {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19" /></svg>;
    case 'box':   return <svg {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>;
    case 'heart': return <svg {...p}><path d="M12 20s-7-4.4-9.2-8.7C1.4 8.2 3 4.8 6.3 4.8c1.9 0 3.1 1.1 3.9 2.2.8-1.1 2-2.2 3.9-2.2 3.3 0 4.9 3.4 3.5 6.5C19 15.6 12 20 12 20Z" /></svg>;
  }
}

export default function ProfileSettingsPage() {
  const { t } = useTranslation('cart-checkout');
  const { direction } = useLanguage();
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  const NAV: NavItem[] = [
    { kind: 'tab',  key: 'account',     label: t('profile.tabs.account'),     hint: t('profile.tabs.accountHint'),     icon: 'user' },
    { kind: 'tab',  key: 'address',     label: t('profile.tabs.address'),     hint: t('profile.tabs.addressHint'),     icon: 'pin'  },
    { kind: 'tab',  key: 'security',    label: t('profile.tabs.security'),    hint: t('profile.tabs.securityHint'),    icon: 'lock' },
    { kind: 'tab',  key: 'preferences', label: t('profile.tabs.preferences'), hint: t('profile.tabs.preferencesHint'), icon: 'gear' },
    { kind: 'link', to: '/orders',      label: t('profile.tabs.orders'),      icon: 'box'   },
    { kind: 'link', to: '/favorites',   label: t('profile.tabs.favorites'),   icon: 'heart' },
  ];

  const [tab, setTab] = useState<TabKey>('account');
  const [pwOpen, setPwOpen] = useState(false);

  const [form, setForm] = useState<ProfileData>(emptyProfile());
  const [saved, setSavedSnapshot] = useState<ProfileData>(emptyProfile());
  const [zones, setZones] = useState<Zone[]>([]);

  const [phoneCode, setPhoneCode]   = useState('970');
  const [phoneLocal, setPhoneLocal] = useState('');
  const phoneHint     = useFieldHint();
  const firstNameHint = useFieldHint();
  const lastNameHint  = useFieldHint();

  useEffect(() => {
    fetchZones().then(setZones).catch(() => setZones([]));
  }, []);

  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = useMemo(() => !profilesEqual(form, saved), [form, saved]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProfile();
        if (!cancelled) {
          const { code, local } = parsePhone(data.phone);
          setPhoneCode(code);
          setPhoneLocal(local);
          const normalized = { ...data, phone: local ? `${code}5${local}` : '' };
          setForm(normalized);
          setSavedSnapshot(normalized);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('profile.errors.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = (field: keyof ProfileData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setJustSaved(false);
    };

  const updateName = (field: 'firstName' | 'lastName', hint: ReturnType<typeof useFieldHint>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (/[0-9]/.test(raw)) hint.show(t('profile.errors.noNumbers'));
      else hint.clear();
      setForm((prev) => ({ ...prev, [field]: raw.replace(/[0-9]/g, '') }));
      setJustSaved(false);
    };

  const onPhoneCode = (code: string) => {
    setPhoneCode(code);
    setForm((prev) => ({ ...prev, phone: phoneLocal ? `${code}5${phoneLocal}` : '' }));
    setJustSaved(false);
  };
  const onPhoneLocal = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (/[^\d]/.test(raw)) phoneHint.show(t('profile.errors.digitsOnly'));
    else if (digits.length > 8) phoneHint.show(t('profile.errors.maxDigits'));
    else phoneHint.clear();
    const local = digits.slice(0, 8);
    setPhoneLocal(local);
    setForm((prev) => ({ ...prev, phone: local ? `${phoneCode}5${local}` : '' }));
    setJustSaved(false);
  };

  const setZone = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const z = zones.find(zz => zz.id === e.target.value) ?? null;
    setForm((prev) => ({ ...prev, dropoffZoneId: z?.id ?? null, dropoffZone: z?.name ?? '' }));
    setJustSaved(false);
  };

  const setCoords = (latitude: number, longitude: number, meta?: PlaceMeta) => {
    setForm((prev) => ({
      ...prev,
      latitude,
      longitude,
      placeId: meta?.placeId ?? '',
      formattedAddress: meta?.formattedAddress ?? prev.formattedAddress,
    }));
    setJustSaved(false);
  };

  const clearCoords = () => {
    setForm((prev) => ({ ...prev, latitude: null, longitude: null, placeId: '' }));
    setJustSaved(false);
  };

  const selectedZone = zones.find(z => z.id === form.dropoffZoneId) ?? null;

  const handleSave = async () => {
    if (phoneLocal.length > 0 && phoneLocal.length !== 8) {
      setError(t('profile.errors.phoneInvalid'));
      return;
    }
    setSavingState(true);
    setError(null);
    setJustSaved(false);
    try {
      const updated = await saveProfile(form);
      setForm(updated);
      setSavedSnapshot(updated);
      setJustSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.errors.saveError'));
    } finally {
      setSavingState(false);
    }
  };

  return (
    <div className="ps-page" dir={direction}>
      <Topbar />

      <div className="ps-shell">
        {loading ? (
          <div className="ps-loading-card">{t('profile.loading')}</div>
        ) : (
          <div className="ps-layout">
            {/* ── Sidebar ── */}
            <nav className="ps-sidebar" aria-label={t('profile.title')}>
              <h1 className="ps-sidebar-title">{t('profile.title')}</h1>

              <div className="ps-navlist">
                {NAV.map((item) =>
                  item.kind === 'tab' ? (
                    <button
                      key={item.key}
                      type="button"
                      className={`ps-navitem ${tab === item.key ? 'is-active' : ''}`}
                      onClick={() => setTab(item.key)}
                      aria-current={tab === item.key}
                    >
                      <span className="ps-navicon" aria-hidden><NavIcon name={item.icon} /></span>
                      <span className="ps-navtext">
                        <span className="ps-navlabel">{item.label}</span>
                        <span className="ps-navhint">{item.hint}</span>
                      </span>
                    </button>
                  ) : (
                    <button
                      key={item.to}
                      type="button"
                      className="ps-navitem ps-navitem--link"
                      onClick={() => navigate(item.to)}
                    >
                      <span className="ps-navicon" aria-hidden><NavIcon name={item.icon} /></span>
                      <span className="ps-navtext">
                        <span className="ps-navlabel">{item.label}</span>
                      </span>
                    </button>
                  ),
                )}
              </div>
            </nav>

            {/* ── Active section ── */}
            <section className="ps-panel">
              {tab === 'account' && (
                <AccountSection
                  t={t}
                  form={form}
                  email={customer?.email ?? ''}
                  updateName={updateName}
                  firstNameHint={firstNameHint}
                  lastNameHint={lastNameHint}
                  phoneCode={phoneCode}
                  phoneLocal={phoneLocal}
                  onPhoneCode={onPhoneCode}
                  onPhoneLocal={onPhoneLocal}
                  phoneHint={phoneHint}
                />
              )}

              {tab === 'address' && (
                <AddressSection
                  t={t}
                  form={form}
                  update={update}
                  setCoords={setCoords}
                  clearCoords={clearCoords}
                  zones={zones}
                  setZone={setZone}
                  selectedZone={selectedZone}
                />
              )}

              {tab === 'security' && (
                <SecuritySection t={t} onChangePassword={() => setPwOpen(true)} />
              )}

              {tab === 'preferences' && <PreferencesSection t={t} />}

              {error && <div className="ps-error">{error}</div>}
              {justSaved && !dirty && <div className="ps-success">{t('profile.savebar.success')}</div>}
            </section>
          </div>
        )}
      </div>

      {!loading && dirty && (
        <div className="ps-savebar" role="region" aria-label={t('profile.savebar.ariaLabel')}>
          <span className="ps-savebar-text">{t('profile.savebar.unsaved')}</span>
          <div className="ps-savebar-actions">
            <button
              type="button"
              className="ps-savebar-discard"
              onClick={() => { setForm(saved); setError(null); }}
              disabled={savingState}
            >
              {t('profile.savebar.discard')}
            </button>
            <button
              type="button"
              className="ps-savebar-save"
              onClick={handleSave}
              disabled={savingState}
            >
              {savingState ? t('profile.savebar.saving') : t('profile.savebar.save')}
            </button>
          </div>
        </div>
      )}

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}

/* ───────────────────────── Account ───────────────────────── */

function AccountSection({
  t, form, email, updateName, firstNameHint, lastNameHint,
  phoneCode, phoneLocal, onPhoneCode, onPhoneLocal, phoneHint,
}: {
  t: ReturnType<typeof useTranslation<'cart-checkout'>>['t'];
  form: ProfileData;
  email: string;
  updateName: (f: 'firstName' | 'lastName', hint: ReturnType<typeof useFieldHint>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => void;
  firstNameHint: ReturnType<typeof useFieldHint>;
  lastNameHint: ReturnType<typeof useFieldHint>;
  phoneCode: string;
  phoneLocal: string;
  onPhoneCode: (code: string) => void;
  onPhoneLocal: (raw: string) => void;
  phoneHint: ReturnType<typeof useFieldHint>;
}) {
  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">{t('profile.account.sectionTitle')}</h2>
        <p className="ps-card-desc">{t('profile.account.sectionDesc')}</p>
      </div>

      <div className="ps-row">
        <Field label={t('profile.account.firstName')}>
          <input placeholder={t('profile.account.firstNamePlaceholder')} value={form.firstName} onChange={updateName('firstName', firstNameHint)} />
          {firstNameHint.hint && <span className="ps-field-hint">{firstNameHint.hint}</span>}
        </Field>
        <Field label={t('profile.account.lastName')}>
          <input placeholder={t('profile.account.lastNamePlaceholder')} value={form.lastName} onChange={updateName('lastName', lastNameHint)} />
          {lastNameHint.hint && <span className="ps-field-hint">{lastNameHint.hint}</span>}
        </Field>
      </div>

      <Field label={t('profile.account.email')} note={t('profile.account.emailNote')}>
        <input type="email" value={email} disabled readOnly />
      </Field>

      <Field label={t('profile.account.phone')}>
        <div className="ps-phone-split" dir="ltr">
          <select
            title={t('profile.account.countryCode')}
            className="ps-phone-code"
            value={phoneCode}
            onChange={(e) => onPhoneCode(e.target.value)}
          >
            <option value="970">+970</option>
            <option value="972">+972</option>
          </select>
          <span className="ps-phone-prefix">05</span>
          <input
            type="text"
            className="ps-phone-local"
            dir="ltr"
            inputMode="numeric"
            placeholder="XXXXXXXX"
            value={phoneLocal}
            onChange={(e) => onPhoneLocal(e.target.value)}
          />
        </div>
        {phoneHint.hint && <span className="ps-field-hint">{phoneHint.hint}</span>}
      </Field>
    </div>
  );
}

/* ───────────────────────── Address Book ───────────────────────── */

function AddressSection({
  t, form, update, setCoords, clearCoords, zones, setZone, selectedZone,
}: {
  t: ReturnType<typeof useTranslation<'cart-checkout'>>['t'];
  form: ProfileData;
  update: (f: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  setCoords: (lat: number, lng: number, meta?: PlaceMeta) => void;
  clearCoords: () => void;
  zones: Zone[];
  setZone: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  selectedZone: Zone | null;
}) {
  const hasPin = form.latitude != null && form.longitude != null;

  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">{t('profile.address.sectionTitle')}</h2>
        <p className="ps-card-desc">{t('profile.address.sectionDesc')}</p>
      </div>

      <Field label={t('profile.address.zone')}>
        <select className="ps-select" title={t('profile.address.zone')} value={form.dropoffZoneId ?? ''} onChange={setZone}>
          <option value="">{t('profile.address.zoneSelect')}</option>
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </Field>

      <div className="ps-map-block">
        <div className="ps-map-head">
          <h3 className="ps-map-title">{t('profile.address.mapTitle')}</h3>
          {hasPin && (
            <button type="button" className="ps-link-btn" onClick={clearCoords}>
              {t('profile.address.removePin')}
            </button>
          )}
        </div>
        <LocationPicker
          value={{ lat: form.latitude, lng: form.longitude }}
          onChange={setCoords}
          recenterTo={selectedZone ? zoneCenter(selectedZone) : null}
        />
      </div>

      <Field label={t('profile.address.instructions')}>
        <textarea
          className="ps-textarea"
          rows={3}
          placeholder={t('profile.address.instructionsPlaceholder')}
          value={form.deliveryDescription}
          onChange={update('deliveryDescription')}
        />
      </Field>
    </div>
  );
}

/* ───────────────────────── Security ───────────────────────── */

function SecuritySection({
  t, onChangePassword,
}: {
  t: ReturnType<typeof useTranslation<'cart-checkout'>>['t'];
  onChangePassword: () => void;
}) {
  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">{t('profile.security.sectionTitle')}</h2>
        <p className="ps-card-desc">{t('profile.security.sectionDesc')}</p>
      </div>

      <div className="ps-action-row">
        <div className="ps-action-info">
          <span className="ps-action-label">{t('profile.security.password')}</span>
          <span className="ps-action-sub">{t('profile.security.passwordSub')}</span>
        </div>
        <button type="button" className="ps-action-btn" onClick={onChangePassword}>
          {t('profile.security.changePassword')}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Preferences ───────────────────────── */

const NOTIF_KEY = 'sl_notif_prefs';

function PreferencesSection({
  t,
}: {
  t: ReturnType<typeof useTranslation<'cart-checkout'>>['t'];
}) {
  const [prefs, setPrefs] = useState({ orderUpdates: true, promos: false });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_KEY);
      if (raw) setPrefs((p) => ({ ...p, ...JSON.parse(raw) }));
    } catch { /* ignore corrupt/blocked storage */ }
  }, []);

  const toggle = (key: 'orderUpdates' | 'promos') => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(NOTIF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">{t('profile.preferences.sectionTitle')}</h2>
        <p className="ps-card-desc">{t('profile.preferences.sectionDesc')}</p>
      </div>

      <Toggle
        label={t('profile.preferences.orderUpdates')}
        sub={t('profile.preferences.orderUpdatesSub')}
        checked={prefs.orderUpdates}
        onChange={() => toggle('orderUpdates')}
      />
      <Toggle
        label={t('profile.preferences.promos')}
        sub={t('profile.preferences.promosSub')}
        checked={prefs.promos}
        onChange={() => toggle('promos')}
      />
    </div>
  );
}

/* ───────────────────────── Small shared bits ───────────────────────── */

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="ps-field">
      <label>{label}</label>
      {children}
      {note && <span className="ps-field-note">{note}</span>}
    </div>
  );
}

function Toggle({
  label, sub, checked, onChange,
}: { label: string; sub: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" className="ps-toggle-row" onClick={onChange} aria-pressed={checked}>
      <span className="ps-toggle-info">
        <span className="ps-toggle-label">{label}</span>
        <span className="ps-toggle-sub">{sub}</span>
      </span>
      <span className={`ps-switch ${checked ? 'is-on' : ''}`} aria-hidden>
        <span className="ps-switch-knob" />
      </span>
    </button>
  );
}
