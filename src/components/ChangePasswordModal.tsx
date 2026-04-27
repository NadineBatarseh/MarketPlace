import { useState, useEffect, useRef } from 'react';
import supabase from '../lib/supabase';
import './ChangePasswordModal.css';

type Step = 'verify' | 'change' | 'success';

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('verify');
  const [email, setEmail] = useState('');
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setEmail(data.user.email ?? '');
        setIsGoogleUser(data.user.app_metadata?.provider === 'google');
      }
    });
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!currentPassword) { setError('أدخل كلمة المرور الحالية'); return; }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    setLoading(false);
    if (authError) { setError('كلمة المرور الحالية غير صحيحة'); return; }
    setStep('change');
  };

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    if (newPassword !== confirmPassword) { setError('كلمتا المرور غير متطابقتين'); return; }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) { setError('حدث خطأ أثناء تغيير كلمة المرور، حاول مرة أخرى'); return; }
    setStep('success');
  };

  return (
    <div
      className="cpm-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="cpm-modal">
        <button className="cpm-close" onClick={onClose} aria-label="إغلاق">✕</button>

        {isGoogleUser ? (
          <div className="cpm-centered">
            <span className="cpm-icon">🔒</span>
            <h2>تغيير كلمة المرور</h2>
            <p>حسابك مرتبط بـ Google — لا يمكن تغيير كلمة المرور من هنا.</p>
            <button className="cpm-submit" onClick={onClose}>حسناً</button>
          </div>
        ) : step === 'verify' ? (
          <>
            <div className="cpm-header">
              <span className="cpm-icon">🔑</span>
              <h2>تغيير كلمة المرور</h2>
              <p>أدخل كلمة المرور الحالية للتحقق من هويتك</p>
            </div>
            <form className="cpm-form" onSubmit={handleVerify}>
              <div className="cpm-field">
                <label>كلمة المرور الحالية</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور الحالية"
                  autoFocus
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>
              {error && <div className="cpm-error" role="alert">{error}</div>}
              <button type="submit" className="cpm-submit" disabled={loading}>
                {loading ? 'جاري التحقق...' : 'التحقق والمتابعة'}
              </button>
            </form>
          </>
        ) : step === 'change' ? (
          <>
            <div className="cpm-header">
              <span className="cpm-icon">🔒</span>
              <h2>كلمة المرور الجديدة</h2>
              <p>أدخل كلمة مرور جديدة وأكدها</p>
            </div>
            <form className="cpm-form" onSubmit={handleChange}>
              <div className="cpm-field">
                <label>كلمة المرور الجديدة</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="6 أحرف على الأقل"
                  autoFocus
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              <div className="cpm-field">
                <label>تأكيد كلمة المرور</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="أعد إدخال كلمة المرور"
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              {error && <div className="cpm-error" role="alert">{error}</div>}
              <button type="submit" className="cpm-submit" disabled={loading}>
                {loading ? 'جاري التغيير...' : 'تغيير كلمة المرور'}
              </button>
            </form>
          </>
        ) : (
          <div className="cpm-centered">
            <span className="cpm-icon">✅</span>
            <h2>تم التغيير بنجاح</h2>
            <p>تم تغيير كلمة المرور بنجاح</p>
            <button className="cpm-submit" onClick={onClose}>إغلاق</button>
          </div>
        )}
      </div>
    </div>
  );
}
