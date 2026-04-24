import { useState } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import supabase from '../../lib/supabase';

export default function MerchantSettings() {
  const { merchant } = useMerchantAuth();

  const [displayName, setDisplayName] = useState(merchant?.displayName ?? '');
  const [nameStatus, setNameStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pwError, setPwError] = useState('');

  const handleSaveName = async () => {
    if (!displayName.trim()) return;
    setNameStatus('saving');
    const { error } = await supabase.auth.updateUser({
      data: { full_name: displayName.trim() },
    });
    setNameStatus(error ? 'error' : 'saved');
    setTimeout(() => setNameStatus('idle'), 3000);
  };

  const handleChangePassword = async () => {
    setPwError('');
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwError('يرجى ملء جميع الحقول');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('كلمة المرور الجديدة غير متطابقة');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setPwStatus('saving');
    // Re-authenticate with old password first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: merchant!.email,
      password: oldPassword,
    });
    if (signInError) {
      setPwError('كلمة المرور الحالية غير صحيحة');
      setPwStatus('error');
      setTimeout(() => setPwStatus('idle'), 3000);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPwError(error.message);
      setPwStatus('error');
    } else {
      setPwStatus('saved');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setTimeout(() => setPwStatus('idle'), 3000);
  };

  return (
    <div className="ms-root">
      <h1 className="ms-title">إعدادات الحساب</h1>

      {/* Profile info card */}
      <section className="ms-card">
        <h2 className="ms-card-title">معلومات الملف الشخصي</h2>

        <div className="ms-field">
          <label className="ms-label">البريد الإلكتروني</label>
          <input
            type="email"
            className="ms-input ms-input-readonly"
            value={merchant?.email ?? ''}
            readOnly
          />
          <span className="ms-hint">لا يمكن تغيير البريد الإلكتروني</span>
        </div>

        <div className="ms-field">
          <label className="ms-label">الاسم المعروض</label>
          <input
            type="text"
            className="ms-input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="اسمك أو اسم متجرك"
          />
        </div>

        <button
          type="button"
          className={`ms-btn ms-btn-primary${nameStatus === 'saving' ? ' ms-btn-loading' : ''}`}
          onClick={handleSaveName}
          disabled={nameStatus === 'saving'}
        >
          {nameStatus === 'saving' ? 'جاري الحفظ...' : nameStatus === 'saved' ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
        </button>
        {nameStatus === 'error' && <p className="ms-error">حدث خطأ أثناء الحفظ</p>}
      </section>

      {/* Change password card */}
      <section className="ms-card">
        <h2 className="ms-card-title">تغيير كلمة المرور</h2>

        <div className="ms-field">
          <label className="ms-label">كلمة المرور الحالية</label>
          <input
            type="password"
            className="ms-input"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <div className="ms-field">
          <label className="ms-label">كلمة المرور الجديدة</label>
          <input
            type="password"
            className="ms-input"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <div className="ms-field">
          <label className="ms-label">تأكيد كلمة المرور الجديدة</label>
          <input
            type="password"
            className="ms-input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {pwError && <p className="ms-error">{pwError}</p>}

        <button
          type="button"
          className={`ms-btn ms-btn-primary${pwStatus === 'saving' ? ' ms-btn-loading' : ''}`}
          onClick={handleChangePassword}
          disabled={pwStatus === 'saving'}
        >
          {pwStatus === 'saving' ? 'جاري التغيير...' : pwStatus === 'saved' ? 'تم التغيير ✓' : 'تغيير كلمة المرور'}
        </button>
      </section>
    </div>
  );
}
