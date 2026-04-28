import { useState, useEffect, useRef } from 'react';
import supabase from '../lib/supabase';
import './ChangePasswordModal.css';

type Step = 'verify' | 'change' | 'success';

interface StrengthResult {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
}

function getStrength(pwd: string): StrengthResult {
  if (!pwd) return { level: 0, label: '' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const level = (score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4) as 1 | 2 | 3 | 4;
  const labels = ['', 'ضعيفة جداً', 'ضعيفة', 'متوسطة', 'قوية'];
  return { level, label: labels[level] };
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('verify');
  const [email, setEmail] = useState('');
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const strength = getStrength(newPassword);

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
                <div className="cpm-input-wrap">
                  <input
                    type={showCurrentPwd ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور الحالية"
                    autoFocus
                    disabled={loading}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="cpm-eye"
                    onClick={() => setShowCurrentPwd(v => !v)}
                    tabIndex={-1}
                    aria-label={showCurrentPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    <EyeIcon open={showCurrentPwd} />
                  </button>
                </div>
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
                <div className="cpm-input-wrap">
                  <input
                    type={showNewPwd ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="6 أحرف على الأقل"
                    autoFocus
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="cpm-eye"
                    onClick={() => setShowNewPwd(v => !v)}
                    tabIndex={-1}
                    aria-label={showNewPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    <EyeIcon open={showNewPwd} />
                  </button>
                </div>
                {newPassword && (
                  <div className="cpm-strength" data-level={strength.level}>
                    <div className="cpm-strength-bars">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="cpm-strength-bar" />
                      ))}
                    </div>
                    <span className="cpm-strength-label">{strength.label}</span>
                  </div>
                )}
              </div>
              <div className="cpm-field">
                <label>تأكيد كلمة المرور</label>
                <div className="cpm-input-wrap">
                  <input
                    type={showConfirmPwd ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="أعد إدخال كلمة المرور"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="cpm-eye"
                    onClick={() => setShowConfirmPwd(v => !v)}
                    tabIndex={-1}
                    aria-label={showConfirmPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    <EyeIcon open={showConfirmPwd} />
                  </button>
                </div>
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
