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
import LocationPicker from '../../components/LocationPicker';
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
        if (!cancelled) { setForm(data); setSavedSnapshot(data); }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ في التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Text-field updater.
  const update = (field: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setJustSaved(false);
  };

  // Map-pin updater.
  const setCoords = (latitude: number, longitude: number) => {
    setForm((prev) => ({ ...prev, latitude, longitude }));
    setJustSaved(false);
  };

  const clearCoords = () => {
    setForm((prev) => ({ ...prev, latitude: null, longitude: null }));
    setJustSaved(false);
  };

  const handleSave = async () => {
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
                <AccountSection form={form} email={customer?.email ?? ''} update={update} />
              )}

              {tab === 'address' && (
                <AddressSection
                  form={form}
                  update={update}
                  setCoords={setCoords}
                  clearCoords={clearCoords}
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
  form, email, update,
}: {
  form: ProfileData;
  email: string;
  update: (f: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">المعلومات الأساسية</h2>
        <p className="ps-card-desc">بياناتك الشخصية وطريقة التواصل معك.</p>
      </div>

      <div className="ps-row">
        <Field label="الاسم الأول">
          <input placeholder="أدخل الاسم الأول" value={form.firstName} onChange={update('firstName')} />
        </Field>
        <Field label="الاسم الأخير">
          <input placeholder="أدخل الاسم الأخير" value={form.lastName} onChange={update('lastName')} />
        </Field>
      </div>

      <Field label="البريد الإلكتروني" note="مرتبط بحسابك ولا يمكن تعديله من هنا">
        <input type="email" value={email} disabled readOnly />
      </Field>

      <Field label="رقم الهاتف">
        <input type="tel" placeholder="+970 5x xxx xxxx" value={form.phone} onChange={update('phone')} />
      </Field>
    </div>
  );
}

/* ───────────────────────── Address Book ───────────────────────── */

function AddressSection({
  form, update, setCoords, clearCoords,
}: {
  form: ProfileData;
  update: (f: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setCoords: (lat: number, lng: number) => void;
  clearCoords: () => void;
}) {
  const hasPin = form.latitude != null && form.longitude != null;

  return (
    <div className="ps-card">
      <div className="ps-card-head">
        <h2 className="ps-card-title">عنوان التسليم</h2>
        <p className="ps-card-desc">العنوان النصّي يساعد المندوب، وتحديد الموقع على الخريطة يضمن وصوله بدقة.</p>
      </div>

      <Field label="العنوان (الشارع ورقم المنزل)">
        <input placeholder="اسم الشارع ورقم المنزل" value={form.street} onChange={update('street')} />
      </Field>

      <Field label="الشقة / الدور (اختياري)">
        <input placeholder="رقم الشقة أو الدور" value={form.apartment} onChange={update('apartment')} />
      </Field>

      <div className="ps-row">
        <Field label="المدينة">
          <input placeholder="مثال: رام الله" value={form.city} onChange={update('city')} />
        </Field>
        <Field label="الرمز البريدي">
          <input placeholder="12345" value={form.postalCode} onChange={update('postalCode')} />
        </Field>
      </div>

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
        />
      </div>
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
