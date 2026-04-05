import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import './Auth.css';

export default function Login() {
  const navigate = useNavigate();

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
      setLoading(false);
      const AUTH_ERRORS: Record<string, string> = {
        'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
        'Email not confirmed':       'يرجى تأكيد بريدك الإلكتروني أولاً',
        'User not found':            'لا يوجد حساب بهذا البريد الإلكتروني',
        'Too many requests':         'محاولات كثيرة جداً، حاول لاحقاً',
      };
      setError(AUTH_ERRORS[authError?.message ?? ''] ?? authError?.message ?? 'حدث خطأ غير متوقع');
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
      navigate('/delivery');
    } else {
      navigate('/store');
    }
  };

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card">
        <div className="auth-logo">🛒</div>
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
            <label>كلمة المرور</label>
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
