import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { validateIsraeliId } from '../../utils/validateIsraeliId';
import { useFieldHint } from './useFieldHint';
import './Auth.css';

const MAX_DOC_BYTES = 5 * 1024 * 1024;

const VEHICLE_VALUES = ['motorcycle', 'car', 'van', 'bicycle'] as const;
type VehicleValue = typeof VEHICLE_VALUES[number];

export default function DeliveryApplication() {
  const { t } = useTranslation('auth');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    nationalId: '',
    vehicleType: '' as VehicleValue | '',
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
      setErr(t('shared.invalidFileType'));
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      setErr(t('shared.docTooLarge'));
      return;
    }
    setFile(file);
    if (file.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
  }, [t]);

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
      setError(t('deliveryApplication.errors.enterFullName'));
      return;
    }

    const idCheck = validateIsraeliId(form.nationalId);
    if (!idCheck.valid) {
      setError(idCheck.reason);
      return;
    }

    if (phoneLocal.trim().length !== 8) {
      setError(t('deliveryApplication.errors.invalidPhone'));
      return;
    }

    if (!form.vehicleType) {
      setError(t('deliveryApplication.errors.selectVehicleType'));
      return;
    }

    if (!idFrontFile) {
      setError(t('deliveryApplication.errors.uploadIdFront'));
      return;
    }
    if (!idBackFile) {
      setError(t('deliveryApplication.errors.uploadIdBack'));
      return;
    }
    if (!licenseFrontFile) {
      setError(t('deliveryApplication.errors.uploadLicenseFront'));
      return;
    }
    if (!licenseBackFile) {
      setError(t('deliveryApplication.errors.uploadLicenseBack'));
      return;
    }

    if (!privacyAccepted) {
      setError(t('deliveryApplication.errors.acceptPrivacy'));
      return;
    }

    setLoading(true);

    const folder = `${Date.now()}_${form.nationalId}`;

    let idFrontPath: string, idBackPath: string, licenseFrontPath: string, licenseBackPath: string;
    try {
      const formData = new FormData();
      formData.append('bucket', 'delivery-applications');
      formData.append('folder', folder);
      formData.append('idFront', idFrontFile!);
      formData.append('idBack', idBackFile!);
      formData.append('licenseFront', licenseFrontFile!);
      formData.append('licenseBack', licenseBackFile!);
      const res = await fetch('/api/applications/upload-docs', { method: 'POST', body: formData });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      const result = await res.json();
      idFrontPath = result.idFrontPath;
      idBackPath = result.idBackPath;
      licenseFrontPath = result.licenseFrontPath;
      licenseBackPath = result.licenseBackPath;
    } catch (err: unknown) {
      setError(t('deliveryApplication.errors.uploadDocsFailed') + ' ' + (err instanceof Error ? err.message : String(err)));
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
      setError(t('deliveryApplication.errors.submitFailed') + ' ' + dbError.message);
      return;
    }

    if (data?.id) setSubmissionId(String(data.id).slice(0, 8).toUpperCase());
    setSubmitted(true);
  };

  const idDocSlots = [
    { key: 'front', label: t('merchantApplication.nationalId.frontLabel'), file: idFrontFile, preview: idFrontPreview, ref: idFrontRef, setFile: setIdFrontFile, setPreview: setIdFrontPreview },
    { key: 'back',  label: t('merchantApplication.nationalId.backLabel'),  file: idBackFile,  preview: idBackPreview,  ref: idBackRef,  setFile: setIdBackFile,  setPreview: setIdBackPreview },
  ] as const;

  const licenseSlots = [
    { key: 'front', label: t('deliveryApplication.drivingLicense.frontLabel'), file: licenseFrontFile, preview: licenseFrontPreview, ref: licenseFrontRef, setFile: setLicenseFrontFile, setPreview: setLicenseFrontPreview },
    { key: 'back',  label: t('deliveryApplication.drivingLicense.backLabel'),  file: licenseBackFile,  preview: licenseBackPreview,  ref: licenseBackRef,  setFile: setLicenseBackFile,  setPreview: setLicenseBackPreview },
  ] as const;

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">✅</div>
          <h2 className="auth-title">{t('deliveryApplication.success.title')}</h2>
          <p className="auth-success-msg">
            {t('deliveryApplication.success.messagePre')} <strong>{form.fullName}</strong>{t('deliveryApplication.success.messageMid')}
            <br /><br />
            {t('deliveryApplication.success.messageContact')}{' '}
            <strong>{form.email}</strong> {t('deliveryApplication.success.messageDays')}
            {submissionId && (
              <>
                <br /><br />
                {t('deliveryApplication.success.refNumber')} <strong dir="ltr">#{submissionId}</strong>
              </>
            )}
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {t('deliveryApplication.success.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-wide-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">{t('deliveryApplication.title')}</h1>
        <p className="auth-sub">{t('merchantApplication.subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-row">
            <div className="auth-field">
              <label>{t('signup.nameLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
              <input
                placeholder={t('merchantApplication.ownerNamePlaceholder')}
                value={form.fullName}
                minLength={2}
                onChange={e => {
                  const raw = e.target.value;
                  if (/[0-9]/.test(raw)) nameHint.show(t('shared.noDigitsHint'));
                  setForm(f => ({ ...f, fullName: raw.replace(/[0-9]/g, '') }));
                }}
                required
              />
              {nameHint.hint && <p className="auth-phone-hint">{nameHint.hint}</p>}
            </div>
            <div className="auth-field">
              <label>{t('deliveryApplication.nationalIdLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
              <input
                placeholder="xxxxxxxxx"
                value={form.nationalId}
                inputMode="numeric"
                onChange={e => {
                  const raw = e.target.value;
                  const digits = raw.replace(/\D/g, '');
                  if (/\D/.test(raw)) idHint.show(t('shared.digitsOnly'));
                  else if (digits.length > 9) idHint.show(t('shared.maxDigits9'));
                  else idHint.clear();
                  setForm(f => ({ ...f, nationalId: digits.slice(0, 9) }));
                }}
                required
              />
              {idHint.hint && <p className="auth-phone-hint">{idHint.hint}</p>}
            </div>
          </div>

          <div className="auth-field">
            <label>{t('merchantApplication.emailLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <input type="email" placeholder="example@email.com" value={form.email} onChange={set('email')} required dir="ltr" />
          </div>

          <div className="auth-field">
            <label>{t('merchantApplication.phoneLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <div className="auth-phone-split" dir="ltr">
              <select
                title="Country code"
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
                  if (/[^\d]/.test(raw)) phoneHint.show(t('shared.digitsOnly'));
                  else if (digits.length > 8) phoneHint.show(t('shared.maxDigits8'));
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
            <label>{t('deliveryApplication.vehicleTypeLabel')} <span className="auth-required-star">{t('shared.required')}</span></label>
            <div className="auth-custom-select" ref={vehicleRef}>
              <button
                type="button"
                className={`auth-custom-select-trigger${!form.vehicleType ? ' auth-custom-select-placeholder' : ''}`}
                onClick={() => setVehicleOpen(o => !o)}
              >
                {form.vehicleType
                  ? t(`deliveryApplication.vehicleOptions.${form.vehicleType}`)
                  : t('deliveryApplication.vehicleTypePlaceholder')}
                <span className="auth-custom-select-arrow">{vehicleOpen ? '▲' : '▼'}</span>
              </button>
              {vehicleOpen && (
                <ul className="auth-custom-select-list">
                  {VEHICLE_VALUES.map(value => (
                    <li
                      key={value}
                      className={`auth-custom-select-option${form.vehicleType === value ? ' selected' : ''}`}
                      onMouseDown={() => {
                        setForm(f => ({ ...f, vehicleType: value }));
                        setVehicleOpen(false);
                      }}
                    >
                      {t(`deliveryApplication.vehicleOptions.${value}`)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="auth-doc-section">
            <div className="auth-doc-section-title">{t('merchantApplication.nationalId.title')}</div>
            <div className="auth-row">
              {idDocSlots.map(({ key, label, file, preview, ref, setFile, setPreview }) => (
                <div key={key} className="auth-field">
                  <label>{label} <span className="auth-required-star">{t('shared.required')}</span></label>
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
                        <span className="auth-doc-hint">{t('shared.uploadDragHint')}</span>
                        <span className="auth-doc-sub">{t('shared.uploadFormatHint')}</span>
                      </>
                    )}
                  </div>
                  <input ref={ref} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFile(f, setFile, setPreview, setError); }} />
                  {file && (
                    <button type="button" className="auth-doc-remove" onClick={() => { setFile(null); setPreview(null); }}>{t('shared.removeFile')}</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="auth-doc-section">
            <div className="auth-doc-section-title">{t('deliveryApplication.drivingLicense.title')}</div>
            <div className="auth-row">
              {licenseSlots.map(({ key, label, file, preview, ref, setFile, setPreview }) => (
                <div key={key} className="auth-field">
                  <label>{label} <span className="auth-required-star">{t('shared.required')}</span></label>
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
                        <span className="auth-doc-hint">{t('shared.uploadDragHint')}</span>
                        <span className="auth-doc-sub">{t('shared.uploadFormatHint')}</span>
                      </>
                    )}
                  </div>
                  <input ref={ref} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFile(f, setFile, setPreview, setError); }} />
                  {file && (
                    <button type="button" className="auth-doc-remove" onClick={() => { setFile(null); setPreview(null); }}>{t('shared.removeFile')}</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="auth-privacy-notice">
            {t('merchantApplication.privacyNotice')}
          </div>

          <label className="auth-privacy-check">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={e => setPrivacyAccepted(e.target.checked)}
            />
            {t('merchantApplication.privacyCheck')}
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading || !privacyAccepted}>
            {loading ? t('deliveryApplication.loading') : t('deliveryApplication.submit')}
          </button>
        </form>

        <p className="auth-switch">
          {t('shared.hasAccount')}{' '}
          <Link to="/login">{t('shared.backToLoginLink')}</Link>
        </p>
      </div>
    </div>
  );
}
