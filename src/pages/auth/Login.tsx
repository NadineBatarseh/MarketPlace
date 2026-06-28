import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import './Auth.css';

export default function Login() {
  const navigate = useNavigate();
  const { signInWithGoogle } = useCustomerAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError || !data.user) {
      // Check if this is a Google account trying to use password login
      if (authError?.message === 'Invalid login credentials') {
        const { data: userRow } = await supabase
          .from('Users')
          .select('provider')
          .eq('email', email.trim().toLowerCase())
          .maybeSingle();

        if (userRow?.provider === 'google') {
          setLoading(false);
          setError('هذا الحساب مرتبط بـ Google — استخدم زر "تسجيل الدخول بـ Google" ولا تحتاج إلى كلمة مرور');
          return;
        }
      }

      setLoading(false);
      setError(
        authError?.message === 'Email not confirmed'
          ? 'لم يتم تأكيد البريد الإلكتروني بعد — تحقق من بريدك واضغط على رابط التأكيد'
          : authError?.message === 'Invalid login credentials'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          : 'حدث خطأ غير متوقع'
      );
      return;
    }

    const { data: userData } = await supabase
      .from('Users')
      .select('role')
      .eq('user_id', data.user.id)
      .maybeSingle();

    setLoading(false);

    const role = userData?.role?.trim() ?? 'customer';

    if (role === 'admin') {
      navigate('/admin-dashboard');
    } else if (role === 'merchant') {
      navigate('/merchant-dashboard');
    } else if (role === 'delivery') {
      navigate('/driver-dashboard');
    } else {
      navigate('/home');
    }
  };

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card">
        <img src="/logo.png" alt="سوق لينك" className="auth-logo auth-logo-img" />
        <h1 className="auth-title">تسجيل الدخول</h1>
        <p className="auth-sub">مرحباً بك في سوق لينك</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>البريد الإلكتروني</label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <div className="auth-field-label-row">
              <label>كلمة المرور</label>
              <Link to="/forgot-password" className="auth-forgot-link">نسيت كلمة المرور؟</Link>
            </div>
            <div className="auth-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button type="button" className="auth-eye" onClick={() => setShowPassword(v => !v)} aria-label="toggle password">
                {showPassword ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'جارٍ تسجيل الدخول...' : 'دخول'}
          </button>

          <div className="auth-divider"><span>أو</span></div>

          <button type="button" className="auth-google-btn" onClick={signInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            تسجيل الدخول بـ Google
          </button>
        </form>

        <p className="auth-switch">
          ليس لديك حساب؟{' '}
          <Link to="/signup">إنشاء حساب عميل</Link>
        </p>
        <p className="auth-switch auth-switch--spaced">
          تاجر جديد؟{' '}
          <Link to="/merchant-application">تقديم طلب تسجيل كتاجر</Link>
        </p>
        <p className="auth-switch auth-switch--spaced">
          مندوب توصيل؟{' '}
          <Link to="/delivery-application">تقديم طلب كمندوب توصيل</Link>
        </p>
      </div>
    </div>
  );
}
