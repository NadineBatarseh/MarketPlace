import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

/**
 * Customer Settings — redesigned as a categorised, sidebar-driven layout.
 *
 * One shared `form` (ProfileData) backs every tab, and one Save action persists
 * the whole profile via PUT /api/profile (see src/lib/profile.ts). The active
 * tab only decides which section is visible — so a user can edit their name in
 * "Account", drop a pin in "Address Book", and save once.
 *
 * Tabs:
 *   • account      — name, email (read-only), phone
 *   • address      — text address + Google Maps delivery pin (lat/lng)
 *   • security     — change password (reuses ChangePasswordModal)
 *   • preferences  — device-local notification toggles + quick links
 */

type TabKey = 'account' | 'address' | 'security' | 'preferences';
type IconName = 'user' | 'pin' | 'lock' | 'gear' | 'box' | 'heart';

// Settings tabs (switch the central panel) and navigation links (route away),
// rendered as ONE connected sidebar list in this order.
type NavItem =
  | { kind: 'tab'; key: TabKey; label: string; hint: string; icon: IconName }
  | { kind: 'link'; to: string; label: string; icon: IconName };

const NAV: NavItem[] = [
  { kind: 'tab',  key: 'account',     label: 'الحساب',        hint: 'الاسم ومعلومات التواصل', icon: 'user' },
  { kind: 'tab',  key: 'address',     label: 'دفتر العناوين', hint: 'عنوان وموقع التسليم',    icon: 'pin'  },
  { kind: 'tab',  key: 'security',    label: 'الأمان',         hint: 'كلمة المرور والدخول',    icon: 'lock' },
  { kind: 'tab',  key: 'preferences', label: 'التفضيلات',      hint: 'الإشعارات والروابط',     icon: 'gear' },
  { kind: 'link', to: '/orders',      label: 'طلباتي',         icon: 'box'   },
  { kind: 'link', to: '/favorites',   label: 'المفضلة',        icon: 'heart' },
];

/** Minimalist line icons (single consistent stroke style) for the sidebar. */
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
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabKey>('account');
  const [pwOpen, setPwOpen] = useState(false);

  // Working copy + the last-saved snapshot (to detect unsaved changes).
  const [form, setForm] = useState<ProfileData>(emptyProfile());
  const [saved, setSavedSnapshot] = useState<ProfileData>(emptyProfile());
  const [zones, setZones] = useState<Zone[]>([]);

  // Phone is edited via a split control (country code + "05" prefix + 8 digits)
  // and recomposed into form.phone. Inline hints mirror the checkout form.
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

  // ── Load saved profile once ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProfile();
        if (!cancelled) {
          // Normalise the saved phone into the split control's canonical form so
          // the recomposed value doesn't read as an unsaved change.
          const { code, local } = parsePhone(data.phone);
          setPhoneCode(code);
          setPhoneLocal(local);
          const normalized = { ...data, phone: local ? `${code}5${local}` : '' };
          setForm(normalized);
          setSavedSnapshot(normalized);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ في التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Text-field updater (inputs, selects, textareas).
  const update = (field: keyof ProfileData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setJustSaved(false);
    };

  // Name updater — strips digits and flashes a hint (names can't contain numbers).
  const updateName = (field: 'firstName' | 'lastName', hint: ReturnType<typeof useFieldHint>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (/[0-9]/.test(raw)) hint.show('لا يُسمح بالأرقام في هذا الحقل');
      else hint.clear();
      setForm((prev) => ({ ...prev, [field]: raw.replace(/[0-9]/g, '') }));
      setJustSaved(false);
    };

  // Phone split → recompose into form.phone as `${code}5${local}`.
  const onPhoneCode = (code: string) => {
    setPhoneCode(code);
    setForm((prev) => ({ ...prev, phone: phoneLocal ? `${code}5${phoneLocal}` : '' }));
    setJustSaved(false);
  };
  const onPhoneLocal = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (/[^\d]/.test(raw)) phoneHint.show('أرقام فقط');
    else if (digits.length > 8) phoneHint.show('الحد الأقصى 8 أرقام');
    else phoneHint.clear();
    const local = digits.slice(0, 8);
    setPhoneLocal(local);
    setForm((prev) => ({ ...prev, phone: local ? `${phoneCode}5${local}` : '' }));
    setJustSaved(false);
  };

  // Zone dropdown → store both id and name.
  const setZone = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const z = zones.find(zz => zz.id === e.target.value) ?? null;
    setForm((prev) => ({ ...prev, dropoffZoneId: z?.id ?? null, dropoffZone: z?.name ?? '' }));
    setJustSaved(false);
  };

  // Map-pin updater — also captures place metadata from a search.
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
    // A phone, if entered, must be the full 8 digits after "05".
    if (phoneLocal.length > 0 && phoneLocal.length !== 8) {
      setError('رقم الهاتف غير صحيح — أدخل 8 أرقام بعد 05');
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
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSavingState(false);
    }
  };

  return (
    <div className="ps-page" dir="rtl">
      <Topbar />

      <div className="ps-shell">
        {loading ? (
          <div className="ps-loading-card">جارٍ تحميل بياناتك…</div>
        ) : (
          <div className="ps-layout">
            {/* ── Sidebar: title + one connected nav list ─────────── */}
            <nav className="ps-sidebar" aria-label="أقسام الإعدادات">
              <h1 className="ps-sidebar-title">الإعدادات</h1>

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

            {/* ── Active section ─────────────────────────────────── */}
            <section className="ps-panel">
              {tab === 'account' && (
                <AccountSection
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
                <SecuritySection onChangePassword={() => setPwOpen(true)} />
              )}

              {tab === 'preferences' && <PreferencesSection />}

              {/* Inline feedback */}
              {error && <div className="ps-error">{error}</div>}
              {justSaved && !dirty && <div className="ps-success">✓ تم حفظ التعديلات بنجاح</div>}
            </section>
          </div>
        )}
      </div>

      {/* Sticky save bar — only when there are unsaved changes (security &
          preferences have no savable fields, so nothing to lose there). */}
      {!loading && dirty && (
        <div className="ps-savebar" role="region" aria-label="حفظ التغييرات">
          <span className="ps-savebar-text">لديك تغييرات غير محفوظة</span>
          <div className="ps-savebar-actions">
            <button
              type="button"
              className="ps-savebar-discard"
              onClick={() => { setForm(saved); setError(null); }}
              disabled={savingState}
            >
              تجاهل
            </button>
            <button
              type="button"
              className="ps-savebar-save"
              onClick={handleSave}
              disabled={savingState}
            >
              {savingState ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
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
  form, email, updateName, firstNameHint, lastNameHint,
  phoneCode, phoneLocal, onPhoneCode, onPhoneLocal, phoneHint,
}: {
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
        <h2 className="ps-card-title">المعلومات الأساسية</h2>
        <p className="ps-card-desc">بياناتك الشخصية وطريقة التواصل معك.</p>
      </div>

      <div className="ps-row">
        <Field label="الاسم الأول">
          <input placeholder="أدخل الاسم الأول" value={form.firstName} onChange={updateName('firstName', firstNameHint)} />
          {firstNameHint.hint && <span className="ps-field-hint">{firstNameHint.hint}</span>}
        </Field>
        <Field label="الاسم الأخير">
          <input placeholder="أدخل الاسم الأخير" value={form.lastName} onChange={updateName('lastName', lastNameHint)} />
          {lastNameHint.hint && <span className="ps-field-hint">{lastNameHint.hint}</span>}
        </Field>
      </div>

      <Field label="البريد الإلكتروني" note="مرتبط بحسابك ولا يمكن تعديله من هنا">
        <input type="email" value={email} disabled readOnly />
      </Field>

      <Field label="رقم الهاتف">
        <div className="ps-phone-split" dir="ltr">
          <select
            title="رمز الدولة"
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
  form, update, setCoords, clearCoords, zones, setZone, selectedZone,
}: {
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
        <h2 className="ps-card-title">عنوان التسليم</h2>
        <p className="ps-card-desc">اختر المنطقة وحدّد موقعك على الخريطة بدقة، وأضف تعليمات تساعد المندوب على الوصول.</p>
      </div>

      <Field label="المنطقة">
        <select className="ps-select" title="المنطقة" value={form.dropoffZoneId ?? ''} onChange={setZone}>
          <option value="">اختر المنطقة</option>
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </Field>

      {/* Map pin */}
      <div className="ps-map-block">
        <div className="ps-map-head">
          <h3 className="ps-map-title">📍 الموقع على الخريطة</h3>
          {hasPin && (
            <button type="button" className="ps-link-btn" onClick={clearCoords}>
              إزالة الموقع
            </button>
          )}
        </div>
        <LocationPicker
          value={{ lat: form.latitude, lng: form.longitude }}
          onChange={setCoords}
          recenterTo={selectedZone ? zoneCenter(selectedZone) : null}
        />
      </div>

      <Field label="تعليمات توصيل إضافية">
        <textarea
          className="ps-textarea"
          rows={3}
          placeholder="اسم الشارع، رقم العمارة، الطابق، رقم الشقة، أقرب معلم، أو أي تعليمات للمندوب."
          value={form.deliveryDescription}
          onChange={update('deliveryDescription')}
        />
      </Field>
    </div>
  );
}

/* ───────────────────────── Security ───────────────────────── */

function SecuritySection({ onChangePassword }: { onChangePassword: () => void }) {
  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">الحساب والأمان</h2>
        <p className="ps-card-desc">حافظ على أمان حسابك.</p>
      </div>

      <div className="ps-action-row">
        <div className="ps-action-info">
          <span className="ps-action-label">كلمة المرور</span>
          <span className="ps-action-sub">يُنصح بتغييرها بشكل دوري</span>
        </div>
        <button type="button" className="ps-action-btn" onClick={onChangePassword}>
          🔑 تغيير كلمة المرور
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Preferences ───────────────────────── */

const NOTIF_KEY = 'sl_notif_prefs';

function PreferencesSection() {
  // Device-local notification preferences (no backend column yet → localStorage).
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
        <h2 className="ps-card-title">تفضيلات الحساب</h2>
        <p className="ps-card-desc">إدارة إعدادات الإشعارات والتواصل</p>
      </div>

      <Toggle
        label="تحديثات الطلبات"
        sub="تلقي إشعارات حالة الطلب عبر التطبيق والبريد الإلكتروني"
        checked={prefs.orderUpdates}
        onChange={() => toggle('orderUpdates')}
      />
      <Toggle
        label="العروض والتخفيضات"
        sub="تلقي عروض ترويجية من المتاجر المحلية"
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
