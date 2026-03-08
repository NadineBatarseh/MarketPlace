import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const APP_ID = '1539852660587503';
const REDIRECT_URI = 'https://attently-hard-juanita.ngrok-free.dev/auth/callback';
const SCOPE = 'catalog_management';

export default function MetaConnectPage({ onConnected }: { onConnected: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const userTokenRef = useRef<string | null>(null);

  useEffect(() => {
    async function init() {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'asshabmalak@gmail.com',
        password: 'e6jM&9p5wNWVy!E',
      });
      if (error) {
        setStatus('error');
        return;
      }
      userTokenRef.current = data.session.access_token;
      setStatus('ready');
    }
    init();
  }, []);

  function startAuth() {
    const token = userTokenRef.current;
    if (!token) {
      alert('يجب تسجيل الدخول أولاً. انتظر لحظة ثم حاول مرة أخرى.');
      return;
    }
    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${SCOPE}` +
      `&response_type=code` +
      `&state=${encodeURIComponent(token)}`;
    window.location.href = authUrl;
  }

  return (
    <div style={{
      fontFamily: 'Arial, sans-serif',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      backgroundColor: '#f0f2f5',
      direction: 'rtl',
    }}>
      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        textAlign: 'center',
        maxWidth: 400,
      }}>
        <h2>مرحباً بك في سوق لينك</h2>
        <p>ابدأ بربط منتجاتك من Meta Catalog لتظهر في السوق الموحد</p>

        {status === 'loading' && <p>جاري التحميل...</p>}

        {status === 'ready' && (
          <>
            <button onClick={startAuth} style={btnStyle}>
              احصل على صلاحية الوصول للكتالوج
            </button>
            <br /><br />
            <button onClick={onConnected} style={{ ...btnStyle, backgroundColor: '#42b883', fontSize: 14 }}>
              تخطي ← الذهاب إلى المتجر
            </button>
          </>
        )}

        {status === 'error' && (
          <p style={{ color: 'red' }}>❌ فشل تسجيل الدخول. تحقق من بيانات الاعتماد أو الاتصال.</p>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  backgroundColor: '#1877f2',
  color: 'white',
  border: 'none',
  padding: '12px 24px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '16px',
  fontWeight: 'bold',
};
