import { useState } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import './Auth.css';

export default function Activate() {
  const [platformEmail, setPlatformEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    setLoading(true);

    // 1. Check merchant_applications first
    const { data: merchantApp } = await supabase
      .from('merchant_applications')
      .select('name_of_owner, platform_email')
      .eq('platform_email', platformEmail.trim())
      .eq('status', 'approved')
      .maybeSingle();

    // 2. If not found, check delivery_applications
    let applicantName: string | null = null;
    let role: 'merchant' | 'delivery' | 'hubworker' = 'merchant';

    if (merchantApp) {
      applicantName = merchantApp.name_of_owner;
      role = 'merchant';
    } else {
      const { data: deliveryApp } = await supabase
        .from('delivery_applications')
        .select('name, platform_email')
        .eq('platform_email', platformEmail.trim())
        .eq('status', 'approved')
        .maybeSingle();

      if (deliveryApp) {
        applicantName = deliveryApp.name;
        role = 'delivery';
      } else {
        const { data: hubApp } = await supabase
          .from('hubworker_applications')
          .select('name, platform_email')
          .eq('platform_email', platformEmail.trim())
          .eq('status', 'approved')
          .maybeSingle();

        if (hubApp) {
          applicantName = hubApp.name;
          role = 'hubworker';
        }
      }
    }

    if (!applicantName) {
      setLoading(false);
      setError('هذا البريد الإلكتروني غير مرتبط بطلب معتمد. تحقق من البريد الذي أرسلناه لك.');
      return;
    }

    // 3. Create auth account
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: platformEmail.trim(),
      password,
      options: {
        data: { full_name: applicantName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (signUpError || !data.user) {
      setLoading(false);
      if (signUpError?.message?.includes('already registered')) {
        setError('هذا البريد الإلكتروني مسجل مسبقاً — يمكنك تسجيل الدخول مباشرة.');
      } else {
        setError(signUpError?.message ?? 'حدث خطأ غير متوقع');
      }
      return;
    }

    // 4. Create or update public.Users record
    const { error: insertError } = await supabase.from('Users').upsert({
      user_id: data.user.id,
      email: platformEmail.trim(),
      role,
      status: 'approved',
      name: applicantName,
    }, { onConflict: 'user_id' });

    if (insertError) {
      setLoading(false);
      setError('حدث خطأ في إعداد الملف الشخصي: ' + insertError.message);
      return;
    }

    // 5. Sign out so they log in properly
    await supabase.auth.signOut();
    setLoading(false);
    setSuccess(true);
  };

  if (success) {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">🎉</div>
          <h2 className="auth-title">تم تفعيل حسابك بنجاح!</h2>
          <p className="auth-success-msg">
            أرسلنا رسالة تأكيد إلى بريدك الإلكتروني الرسمي.<br /><br />
            افتح الرسالة واضغط على رابط التأكيد، ثم سجّل الدخول باستخدام بريدك الرسمي وكلمة المرور التي أنشأتها.
          </p>
          <Link to="/login" className="auth-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card">
        <div className="auth-logo">🔐</div>
        <h1 className="auth-title">تفعيل الحساب</h1>
        <p className="auth-sub">أدخل بريدك الإلكتروني الرسمي وأنشئ كلمة مرور لحسابك</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>البريد الإلكتروني الرسمي</label>
            <input
              type="email"
              placeholder="البريد الذي أرسلناه لك في رسالة القبول"
              value={platformEmail}
              onChange={e => setPlatformEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label>كلمة المرور</label>
            <input
              type="password"
              placeholder="6 أحرف على الأقل"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="auth-field">
            <label>تأكيد كلمة المرور</label>
            <input
              type="password"
              placeholder="أعد كتابة كلمة المرور"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'جارٍ تفعيل الحساب...' : 'تفعيل الحساب'}
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
