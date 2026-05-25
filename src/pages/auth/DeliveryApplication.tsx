import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { validateIsraeliId } from '../../utils/validateIsraeliId';
import { useFieldHint } from './useFieldHint';
import './Auth.css';

const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB

const VEHICLE_OPTIONS = [
  { value: 'motorcycle', label: 'دراجة نارية' },
  { value: 'car', label: 'سيارة' },
  { value: 'van', label: 'فان' },
  { value: 'bicycle', label: 'دراجة هوائية' },
];

export default function DeliveryApplication() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    nationalId: '',
    vehicleType: '',
  });
  const [phoneCode, setPhoneCode] = useState('970');
  const [phoneLocal, setPhoneLocal] = useState('');
  const phoneHint = useFieldHint();
  const nameHint = useFieldHint();
  const idHint = useFieldHint();
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idFrontPreview, setIdFrontPreview] = useState<string | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [idBackPreview, setIdBackPreview] = useState<string | null>(null);
  const [licenseFrontFile, setLicenseFrontFile] = useState<File | null>(null);
  const [licenseFrontPreview, setLicenseFrontPreview] = useState<string | null>(null);
  const [licenseBackFile, setLicenseBackFile] = useState<File | null>(null);
  const [licenseBackPreview, setLicenseBackPreview] = useState<string | null>(null);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const vehicleRef = useRef<HTMLDivElement>(null);
  const idFrontRef = useRef<HTMLInputElement>(null);
  const idBackRef = useRef<HTMLInputElement>(null);
  const licenseFrontRef = useRef<HTMLInputElement>(null);
  const licenseBackRef = useRef<HTMLInputElement>(null);

  const handleDocFile = useCallback((
    file: File,
    setFile: (f: File | null) => void,
    setPreview: (url: string | null) => void,
    setErr: (msg: string) => void
  ) => {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setErr('يُقبل فقط صور (JPG/PNG) أو PDF');
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      setErr('الحجم الأقصى للملف 5 ميجابايت');
      return;
    }
    setFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }, []);

  useEffect(() => {
    if (!vehicleOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (vehicleRef.current && !vehicleRef.current.contains(e.target as Node)) {
        setVehicleOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [vehicleOpen]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.fullName.trim().length < 2) {
      setError('يرجى إدخال الاسم الكامل');
      return;
    }

    const idCheck = validateIsraeliId(form.nationalId);
    if (!idCheck.valid) {
      setError(idCheck.reason);
      return;
    }

    if (phoneLocal.trim().length !== 8) {
      setError('رقم الهاتف غير صحيح — أدخل 8 أرقام بعد 05');
      return;
    }

    if (!form.vehicleType) {
      setError('يرجى اختيار نوع المركبة');
      return;
    }

    if (!idFrontFile) {
      setError('يرجى رفع الوجه الأمامي للهوية الوطنية');
      return;
    }
    if (!idBackFile) {
      setError('يرجى رفع الوجه الخلفي للهوية الوطنية');
      return;
    }
    if (!licenseFrontFile) {
      setError('يرجى رفع الوجه الأمامي لرخصة القيادة');
      return;
    }
    if (!licenseBackFile) {
      setError('يرجى رفع الوجه الخلفي لرخصة القيادة');
      return;
    }

    if (!privacyAccepted) {
      setError('يرجى الموافقة على سياسة الخصوصية للمتابعة');
      return;
    }

    setLoading(true);

    const folder = `${Date.now()}_${form.nationalId}`;

    const uploadDoc = async (file: File, name: string) => {
      const ext = file.name.split('.').pop();
      const path = `${folder}/${name}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('delivery-applications')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw new Error(uploadErr.message);
      return uploadData.path;
    };

    let idFrontPath: string, idBackPath: string, licenseFrontPath: string, licenseBackPath: string;
    try {
      [idFrontPath, idBackPath, licenseFrontPath, licenseBackPath] = await Promise.all([
        uploadDoc(idFrontFile, 'id-front'),
        uploadDoc(idBackFile, 'id-back'),
        uploadDoc(licenseFrontFile, 'license-front'),
        uploadDoc(licenseBackFile, 'license-back'),
      ]);
    } catch (err: unknown) {
      setError('تعذّر رفع المستندات: ' + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
      return;
    }

    const { data, error: dbError } = await supabase
      .from('delivery_applications')
      .insert({
        name: form.fullName,
        email: form.email,
        phone_number: phoneCode + '5' + phoneLocal.trim(),
        ID_number: form.nationalId,
        type_of_vehicle: form.vehicleType,
        id_front_url: idFrontPath,
        id_back_url: idBackPath,
        license_front_url: licenseFrontPath,
        license_back_url: licenseBackPath,
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
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">✅</div>
          <h2 className="auth-title">تم إرسال طلبك بنجاح!</h2>
          <p className="auth-success-msg">
            شكراً لك <strong>{form.fullName}</strong>، تم استلام طلب انضمامك كمندوب توصيل.
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
        <div className="auth-logo">🚚</div>
        <h1 className="auth-title">طلب الانضمام كمندوب توصيل</h1>
        <p className="auth-sub">أكمل النموذج وسيتم مراجعة طلبك من قِبل الإدارة</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-row">
            <div className="auth-field">
              <label>الاسم الكامل <span className="auth-required-star">*</span></label>
              <input
                placeholder="الاسم الكامل"
                value={form.fullName}
                minLength={2}
                onChange={e => {
                  const raw = e.target.value;
                  if (/[0-9]/.test(raw)) nameHint.show('لا يُسمح بالأرقام في هذا الحقل');
                  setForm(f => ({ ...f, fullName: raw.replace(/[0-9]/g, '') }));
                }}
                required
              />
              {nameHint.hint && <p className="auth-phone-hint">{nameHint.hint}</p>}
            </div>
            <div className="auth-field">
              <label>رقم الهوية الوطنية <span className="auth-required-star">*</span></label>
              <input
                placeholder="xxxxxxxxx"
                value={form.nationalId}
                inputMode="numeric"
                onChange={e => {
                  const raw = e.target.value;
                  const digits = raw.replace(/\D/g, '');
                  if (/\D/.test(raw)) idHint.show('أرقام فقط');
                  else if (digits.length > 9) idHint.show('الحد الأقصى 9 أرقام');
                  else idHint.clear();
                  setForm(f => ({ ...f, nationalId: digits.slice(0, 9) }));
                }}
                required
              />
              {idHint.hint && <p className="auth-phone-hint">{idHint.hint}</p>}
            </div>
          </div>

          <div className="auth-field">
            <label>البريد الإلكتروني <span className="auth-required-star">*</span></label>
            <input type="email" placeholder="example@email.com" value={form.email} onChange={set('email')} required />
          </div>

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
            <label>نوع المركبة <span className="auth-required-star">*</span></label>
            <div className="auth-custom-select" ref={vehicleRef}>
              <button
                type="button"
                className={`auth-custom-select-trigger${!form.vehicleType ? ' auth-custom-select-placeholder' : ''}`}
                onClick={() => setVehicleOpen(o => !o)}
              >
                {VEHICLE_OPTIONS.find(v => v.value === form.vehicleType)?.label || 'اختر النوع'}
                <span className="auth-custom-select-arrow">{vehicleOpen ? '▲' : '▼'}</span>
              </button>
              {vehicleOpen && (
                <ul className="auth-custom-select-list">
                  {VEHICLE_OPTIONS.map(opt => (
                    <li
                      key={opt.value}
                      className={`auth-custom-select-option${form.vehicleType === opt.value ? ' selected' : ''}`}
                      onMouseDown={() => {
                        setForm(f => ({ ...f, vehicleType: opt.value }));
                        setVehicleOpen(false);
                      }}
                    >
                      {opt.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="auth-doc-section">
            <div className="auth-doc-section-title">🪪 الهوية الوطنية</div>
            <div className="auth-row">
              {([
                { label: 'الوجه الأمامي', file: idFrontFile, preview: idFrontPreview, ref: idFrontRef, setFile: setIdFrontFile, setPreview: setIdFrontPreview },
                { label: 'الوجه الخلفي',  file: idBackFile,  preview: idBackPreview,  ref: idBackRef,  setFile: setIdBackFile,  setPreview: setIdBackPreview  },
              ] as const).map(({ label, file, preview, ref, setFile, setPreview }) => (
                <div key={label} className="auth-field">
                  <label>{label} <span className="auth-required-star">*</span></label>
                  <div
                    className={`auth-doc-upload${file ? ' auth-doc-upload--filled' : ''}`}
                    onClick={() => ref.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleDocFile(f, setFile, setPreview, setError); }}
                  >
                    {preview ? (
                      <img src={preview} alt={label} className="auth-doc-preview-img" />
                    ) : file ? (
                      <span className="auth-doc-filename">{file.name}</span>
                    ) : (
                      <>
                        <span className="auth-doc-icon">📄</span>
                        <span className="auth-doc-hint">اضغط أو اسحب الملف هنا</span>
                        <span className="auth-doc-sub">JPG / PNG / PDF — حتى 5 ميجابايت</span>
                      </>
                    )}
                  </div>
                  <input ref={ref} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFile(f, setFile, setPreview, setError); }} />
                  {file && (
                    <button type="button" className="auth-doc-remove" onClick={() => { setFile(null); setPreview(null); }}>× إزالة</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="auth-doc-section">
            <div className="auth-doc-section-title">🚗 رخصة القيادة</div>
            <div className="auth-row">
              {([
                { label: 'الوجه الأمامي', file: licenseFrontFile, preview: licenseFrontPreview, ref: licenseFrontRef, setFile: setLicenseFrontFile, setPreview: setLicenseFrontPreview },
                { label: 'الوجه الخلفي',  file: licenseBackFile,  preview: licenseBackPreview,  ref: licenseBackRef,  setFile: setLicenseBackFile,  setPreview: setLicenseBackPreview  },
              ] as const).map(({ label, file, preview, ref, setFile, setPreview }) => (
                <div key={label} className="auth-field">
                  <label>{label} <span className="auth-required-star">*</span></label>
                  <div
                    className={`auth-doc-upload${file ? ' auth-doc-upload--filled' : ''}`}
                    onClick={() => ref.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleDocFile(f, setFile, setPreview, setError); }}
                  >
                    {preview ? (
                      <img src={preview} alt={label} className="auth-doc-preview-img" />
                    ) : file ? (
                      <span className="auth-doc-filename">{file.name}</span>
                    ) : (
                      <>
                        <span className="auth-doc-icon">📄</span>
                        <span className="auth-doc-hint">اضغط أو اسحب الملف هنا</span>
                        <span className="auth-doc-sub">JPG / PNG / PDF — حتى 5 ميجابايت</span>
                      </>
                    )}
                  </div>
                  <input ref={ref} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFile(f, setFile, setPreview, setError); }} />
                  {file && (
                    <button type="button" className="auth-doc-remove" onClick={() => { setFile(null); setPreview(null); }}>× إزالة</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="auth-privacy-notice">
            🔒 <strong>خصوصية بياناتك:</strong> يتم تخزين المستندات المرفوعة بشكل آمن، ولا يمكن الاطلاع عليها إلا من قِبل فريق الإدارة المخوّل. لن تُستخدم بياناتك لأي غرض خارج نطاق مراجعة طلبك.
          </div>

          <label className="auth-privacy-check">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={e => setPrivacyAccepted(e.target.checked)}
            />
            أوافق على استخدام بياناتي ومستنداتي لأغراض مراجعة طلب الانضمام فقط
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading || !privacyAccepted}>
            {loading ? 'جارٍ إرسال الطلب...' : 'إرسال الطلب'}
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
