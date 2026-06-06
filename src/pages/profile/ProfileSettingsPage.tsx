import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { fetchProfile, saveProfile, emptyProfile, type ProfileData } from '../../lib/profile';
import Topbar from '../../components/Topbar';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import './ProfileSettingsPage.css';

/**
 * User Profile Settings page (Phase 1).
 *
 * - On mount, GET /api/profile and populate the form.
 * - User edits the fields (basic details + default shipping address).
 * - "Save" PUTs /api/profile.
 *
 * The actual fetch/save lives in src/lib/profile.ts so the Checkout page can
 * reuse the exact same model and endpoints.
 */
export default function ProfileSettingsPage() {
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  // Controls the reused ChangePasswordModal (handles Google-linked accounts itself).
  const [pwOpen, setPwOpen] = useState(false);

  // The form's working copy. Starts blank so every <input> is controlled from
  // the first render (no "uncontrolled → controlled" warnings).
  const [form, setForm] = useState<ProfileData>(emptyProfile());

  const [loading, setLoading] = useState(true);   // initial GET in flight
  const [saving, setSaving] = useState(false);     // PUT in flight
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);       // brief "saved!" confirmation

  // ── Load the saved profile once, when the component mounts ───────────
  useEffect(() => {
    let cancelled = false; // guard against setState after unmount

    (async () => {
      try {
        const data = await fetchProfile();
        if (!cancelled) setForm(data);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ في التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Generic field updater — keeps every input's onChange to a one-liner.
  const update = (field: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setSaved(false); // any edit invalidates the previous "saved" badge
  };

  // ── Save modifications (Phase 1: PUT /api/profile) ──────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await saveProfile(form);
      setForm(updated);  // sync with what the server actually stored
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ps-page" dir="rtl">
      <Topbar />
      <h1 className="ps-page-title">إعدادات الملف الشخصي</h1>

      <form className="ps-wrap" onSubmit={handleSave}>
        {loading ? (
          <div className="ps-section"><p className="ps-loading">جارٍ تحميل بياناتك…</p></div>
        ) : (
          <>
            {/* Basic details */}
            <section className="ps-section">
              <h2 className="ps-section-title">المعلومات الأساسية</h2>

              <div className="ps-row">
                <div className="ps-field">
                  <label>الاسم الأول</label>
                  <input placeholder="أدخل الاسم الأول" value={form.firstName} onChange={update('firstName')} />
                </div>
                <div className="ps-field">
                  <label>الاسم الأخير</label>
                  <input placeholder="أدخل الاسم الأخير" value={form.lastName} onChange={update('lastName')} />
                </div>
              </div>

              {/* Email is owned by the auth account — shown read-only for context. */}
              <div className="ps-field">
                <label>البريد الإلكتروني</label>
                <input type="email" value={customer?.email ?? ''} disabled readOnly />
              </div>

              <div className="ps-field">
                <label>رقم الهاتف</label>
                <input type="tel" placeholder="+970 5x xxx xxxx" value={form.phone} onChange={update('phone')} />
              </div>
            </section>

            {/* Default shipping address */}
            <section className="ps-section">
              <h2 className="ps-section-title">العنوان الافتراضي</h2>

              <div className="ps-field">
                <label>العنوان (الشارع ورقم المنزل)</label>
                <input placeholder="اسم الشارع ورقم المنزل" value={form.street} onChange={update('street')} />
              </div>

              <div className="ps-field">
                <label>الشقة / الدور (اختياري)</label>
                <input placeholder="رقم الشقة أو الدور" value={form.apartment} onChange={update('apartment')} />
              </div>

              <div className="ps-row">
                <div className="ps-field">
                  <label>المدينة</label>
                  <input placeholder="مثال: رام الله" value={form.city} onChange={update('city')} />
                </div>
                <div className="ps-field">
                  <label>الرمز البريدي</label>
                  <input placeholder="12345" value={form.postalCode} onChange={update('postalCode')} />
                </div>
              </div>
            </section>

            {/* Feedback + actions */}
            {error && <div className="ps-error">{error}</div>}
            {saved && <div className="ps-success">✓ تم حفظ التعديلات بنجاح</div>}

            <button type="submit" className="ps-save-btn" disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
            </button>

            {/* Account & Security — reuses the existing ChangePasswordModal.
                type="button" so it never submits the profile form. */}
            <section className="ps-section ps-section--standalone">
              <h2 className="ps-section-title">الحساب والأمان</h2>
              <button type="button" className="ps-action-btn" onClick={() => setPwOpen(true)}>
                🔑 تغيير كلمة المرور
              </button>
            </section>

            {/* Quick links to the rest of the account area */}
            <section className="ps-section ps-section--standalone">
              <h2 className="ps-section-title">روابط سريعة</h2>
              <div className="ps-quicklinks">
                <button type="button" className="ps-quicklink" onClick={() => navigate('/orders')}>
                  <span className="ps-quicklink-icon">📦</span>
                  <span>طلباتي</span>
                </button>
                <button type="button" className="ps-quicklink" onClick={() => navigate('/favorites')}>
                  <span className="ps-quicklink-icon">❤️</span>
                  <span>المفضلة</span>
                </button>
              </div>
            </section>
          </>
        )}
      </form>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}
