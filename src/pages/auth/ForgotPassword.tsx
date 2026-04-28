import { useState } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../../lib/supabase';
import './Auth.css';

type State = 'idle' | 'loading' | 'sent' | 'error';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setState('loading');

    const trimmed = email.trim().toLowerCase();

    // Step 1: check if email is registered
    const { data: userRow } = await supabase
      .from('Users')
      .select('email, provider')
      .eq('email', trimmed)
      .maybeSingle();

    if (!userRow) {
      setErrorMsg('هذا البريد الإلكتروني غير مسجل في النظام — هل تريد إنشاء حساب؟');
      setState('error');
      return;
    }

    if (userRow.provider === 'google') {
      setErrorMsg('هذا الحساب مرتبط بـ Google — سجّل دخولك عبر زر "تسجيل الدخول بـ Google" ولا تحتاج إلى كلمة مرور');
      setState('error');
      return;
    }

    // Step 2: send the reset link
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      const msg = error.message?.toLowerCase() ?? '';
      if (msg.includes('rate') || msg.includes('limit') || error.status === 429) {
        setErrorMsg('تم إرسال رابط مسبقاً — انتظر دقيقة ثم حاول مرة أخرى');
      } else if (msg.includes('email') && msg.includes('not')) {
        setErrorMsg('هذا البريد غير مسجل في نظام المصادقة — تواصل مع الدعم');
      } else {
        setErrorMsg('حدث خطأ أثناء إرسال الرابط، حاول مرة أخرى');
      }
      setState('error');
      return;
    }

    setState('sent');
  };

  if (state === 'sent') {
    return (
      <div className="auth-page" dir="rtl">
        <div className="auth-card auth-success-card">
          <div className="auth-success-icon">📩</div>
          <h1 className="auth-title">تحقق من بريدك</h1>
          <p className="auth-success-msg">
            أرسلنا رابط استعادة كلمة المرور إلى
            <br />
            <strong>{email.trim()}</strong>
            <br /><br />
            افتح بريدك الإلكتروني واضغط على الرابط — صلاحيته ساعة واحدة.
          </p>
          <Link to="/login" className="auth-submit auth-submit--link">
            العودة لتسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-card">
        <div className="auth-logo">🔑</div>
        <h1 className="auth-title">نسيت كلمة المرور؟</h1>
        <p className="auth-sub">أدخل بريدك الإلكتروني وسنرسل لك رابط الاستعادة</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>البريد الإلكتروني</label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              disabled={state === 'loading'}
              dir="ltr"
            />
          </div>

          {state === 'error' && (
            <p className="auth-error">{errorMsg}</p>
          )}

          <button type="submit" className="auth-submit" disabled={state === 'loading'}>
            {state === 'loading' ? 'جاري التحقق...' : 'إرسال رابط الاستعادة'}
          </button>
        </form>

        <p className="auth-switch">
          تذكرت كلمة المرور؟{' '}
          <Link to="/login">تسجيل الدخول</Link>
        </p>
        {state === 'error' && errorMsg.includes('إنشاء حساب') && (
          <p className="auth-switch auth-switch--spaced">
            <Link to="/signup">إنشاء حساب جديد</Link>
          </p>
        )}
      </div>
    </div>
  );
}
