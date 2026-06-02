import { useEffect, useRef, useState } from 'react';
import AppNav from '../components/Topbar';
import StoreNav from '../components/StoreNav';
import './MetaConnectPage.css';
import Topbar from '../components/Topbar';
import supabase from '../lib/supabase';

const APP_ID = '1539852660587503';
const REDIRECT_URI = 'https://souq-link.com/auth/callback';
const SCOPE = 'catalog_management';

const PERMISSIONS = [
  {
    name: 'قراءة كتالوج المنتجات',
    desc: 'الاطلاع على بيانات منتجاتك لاستيرادها إلى Meta Business',
    chip: 'قراءة',
    chipClass: 'chip-blue',
    dotClass: 'dot-blue',
  },
  {
    name: 'مزامنة المخزون تلقائياً',
    desc: 'تحديث الكميات والتوافر في الوقت الفعلي دون تدخل يدوي',
    chip: 'مزامنة',
    chipClass: 'chip-green',
    dotClass: 'dot-green',
  },
  {
    name: 'تعديل الأسعار في الكتالوج',
    desc: 'تحديث أسعار المنتجات على Meta عند تغييرها في متجرك',
    chip: 'كتابة',
    chipClass: 'chip-amber',
    dotClass: 'dot-amber',
  },
];

const WHY_ITEMS = [
  'عرض منتجاتك في إعلانات فيسبوك وإنستغرام مباشرةً من متجرك دون رفع يدوي',
  'تجنب الأخطاء في الأسعار والمخزون بفضل المزامنة الفورية بين المنصتين',
  'توسيع نطاق مبيعاتك والوصول إلى عملاء جدد عبر منتجات Meta الإعلانية',
];

const CheckIcon = () => (
  <span className="mcp-check-icon" aria-hidden="true">
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,6 5,9 10,3"/>
    </svg>
  </span>
);

export default function MetaConnectPage({ onConnected = () => {} }: { onConnected?: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const userTokenRef = useRef<string | null>(null);

  async function init() {
    setStatus('loading');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'asshabmalak@gmail.com',
      password: 'e6jM&9p5wNWVy!E',
    });
    if (error) { setStatus('error'); return; }
    userTokenRef.current = data.session.access_token;
    setStatus('ready');
  }

  useEffect(() => { init(); }, []);

  function startAuth() {
    const token = userTokenRef.current;
    if (!token) return;
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
    <div className="mcp-page">
      <Topbar />

      {/* ── Hero ── */}
      <section className="mcp-hero">
        <div className="mcp-hero-inner">

          {/* Badge pill */}
          <div className="mcp-badge">
            <span className="mcp-badge-dot" />
            <span className="mcp-badge-text">تكامل رسمي مع</span>
            {/* Meta wordmark */}
            <svg width="42" height="14" viewBox="0 0 120 38" fill="none" aria-label="Meta">
              <path d="M12 6C8.2 6 5.3 8.4 3.2 11.9 1.1 15.5 0 20.6 0 26.5 0 30.3.8 33.4 2.3 35.6 3.7 37.6 5.7 38.8 8 38.8c2 0 3.8-.8 5.8-2.7 2-1.9 4-4.9 6.1-9.1l1.3-2.5c1.6-3.1 3-5.4 4.2-7.1-1.7-4.6-4.3-11.4-13.4-11.4zm0 3.5c5.5 0 8.5 4 10.3 8.2-1.2 1.8-2.6 4.1-4.1 7l-1.3 2.5c-2 3.8-3.8 6.4-5.3 7.9-1.4 1.3-2.5 1.8-3.6 1.8-1.3 0-2.6-.8-3.6-2.4-1.2-1.8-1.9-4.5-1.9-7.9 0-5.5 1-10.1 2.8-13.1C7.1 10.9 9.2 9.5 12 9.5z" fill="white" opacity=".9"/>
              <path d="M36 6c-3.5 0-6.2 1.9-8.4 4.7-2.2 2.9-3.8 6.9-4.6 11.3l-.1.7 1.7 3.2.3-.7c.7-2.1 1.9-4.8 3.5-7.7 1.7-2.9 3.4-5 5.1-6.3 1.5-1.1 2.8-1.7 4.3-1.7 2.3 0 4.1 1.4 5.4 3.8 1.1 2.1 1.7 5 1.7 8.6 0 3.3-.6 6-1.7 7.9-1 1.7-2.3 2.5-4 2.5-1.2 0-2.3-.5-3.6-1.7-1.2-1.1-2.5-3-3.9-5.5l-1.3-2.5c-1.7-3.3-3.1-5.5-4.5-7.2l-.4 2.1c.9 1.5 2 3.5 3.3 5.9l1.3 2.5c1.5 2.8 3 4.9 4.5 6.3 1.7 1.5 3.4 2.3 5.3 2.3 2.8 0 5.1-1.3 6.8-3.8 1.6-2.4 2.4-5.8 2.4-9.9 0-4.2-.9-7.7-2.5-10.2C41.5 7.4 39 6 36 6z" fill="white" opacity=".9"/>
              <path d="M56.5 11.2l-8.8 16.6h4.1l2-3.9h8.5l2 3.9h4.2l-8.8-16.6h-3.2zm1.6 3.8l3 5.7H55l3.1-5.7z" fill="white" opacity=".9"/>
              <path d="M73.3 11.2v3.2h5.2v13.4h3.8V14.4h5.2v-3.2H73.3z" fill="white" opacity=".9"/>
            </svg>
          </div>

          <h1>ربط كتالوج <em>Meta</em> بمتجرك</h1>
          <p className="mcp-hero-sub">
            زامن منتجاتك تلقائياً مع فيسبوك وإنستغرام وأعرضها أمام ملايين المتسوقين — بخطوة واحدة وبدون أي تعقيد تقني.
          </p>
        </div>
      </section>

      {/* ── Card ── */}
      <main className="mcp-card-wrapper">
        <div className="mcp-main-card">

          {/* 1. Permissions */}
          <section className="mcp-card-section">
            <div className="mcp-section-header">
              <div className="mcp-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
              </div>
              <h2 className="mcp-section-title">الصلاحيات المطلوبة</h2>
            </div>

            {PERMISSIONS.map(p => (
              <div key={p.name} className="mcp-perm-row">
                <div className="mcp-perm-left">
                  <span className={`mcp-perm-dot ${p.dotClass}`} />
                  <div>
                    <strong className="mcp-perm-name">{p.name}</strong>
                    <span className="mcp-perm-desc">{p.desc}</span>
                  </div>
                </div>
                <span className={`mcp-chip ${p.chipClass}`}>{p.chip}</span>
              </div>
            ))}
          </section>

          {/* 2. Why */}
          <section className="mcp-card-section">
            <div className="mcp-why-box">
              <h3 className="mcp-why-title">لماذا نحتاج هذا الربط؟</h3>
              <ul className="mcp-why-list">
                {WHY_ITEMS.map(item => (
                  <li key={item} className="mcp-why-item">
                    <CheckIcon />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* 3. Actions */}
          <div className="mcp-actions">
            {status === 'loading' && (
              <div className="mcp-loading">
                <div className="mcp-spinner" />
                <p>جارٍ التحقق من بياناتك…</p>
              </div>
            )}

            {status === 'ready' && (
              <>
                <button className="mcp-btn-primary" onClick={startAuth}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                    <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073c0 6.022 4.388 11.013 10.125 11.927v-8.437H7.078v-3.49h3.047V9.43c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.235 2.686.235v2.97h-1.514c-1.491 0-1.956.931-1.956 1.886v2.253h3.328l-.532 3.49h-2.796v8.437C19.612 23.086 24 18.095 24 12.073z"/>
                  </svg>
                  ربط حساب Meta الآن
                </button>
                <button className="mcp-btn-ghost" onClick={onConnected}>
                  تخطّى والذهاب إلى المتجر
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
              </>
            )}

            {status === 'error' && (
              <div className="mcp-error">
                <div className="mcp-error-icon">⚠️</div>
                <p>فشل الاتصال. تحقق من الإنترنت وحاول مرة أخرى.</p>
                <button className="mcp-btn-retry" onClick={init}>إعادة المحاولة</button>
              </div>
            )}

            <p className="mcp-tos">
              بالمتابعة، أنت توافق على{' '}
              <a href="https://www.facebook.com/policies" target="_blank" rel="noopener noreferrer">سياسة Meta للبيانات</a>
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}
