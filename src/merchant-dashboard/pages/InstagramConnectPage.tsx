import { useEffect, useState } from 'react';
import supabase from '../../lib/supabase';
import './InstagramConnectPage.css';

interface ConnectionStatus {
  connected: boolean;
  username: string | null;
  connected_at: string | null;
}

export default function InstagramConnectPage() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
  const [info, setInfo] = useState<ConnectionStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  async function fetchStatus() {
    setStatus('loading');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('[Instagram] No session found — user not logged in');
        setStatus('error');
        return;
      }

      const res = await fetch('/api/instagram/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[Instagram] /api/instagram/status returned ${res.status}:`, text);
        setStatus('error');
        return;
      }
      const data = await res.json();
      setInfo(data);
      setStatus(data.connected ? 'connected' : 'disconnected');
    } catch (err) {
      console.error('[Instagram] fetchStatus error:', err);
      setStatus('error');
    }
  }

  useEffect(() => {
    // Check if we just returned from a successful OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      // Clean up URL param without a page reload
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      window.history.replaceState({}, '', url.toString());
    }
    fetchStatus();
  }, []);

  async function startOAuth() {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('error'); return; }

      // Backend generates a short state token and returns the full auth URL
      const res = await fetch('/api/instagram/init', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!data.ok || !data.auth_url) {
        console.error('[Instagram] /api/instagram/init failed:', data);
        setStatus('error');
        return;
      }

      window.location.href = data.auth_url;
    } catch (err) {
      console.error('[Instagram] startOAuth error:', err);
      setActionLoading(false);
      setStatus('error');
    }
  }

  async function disconnect() {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch('/api/instagram/disconnect', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setInfo(null);
      setStatus('disconnected');
    } catch {
      setStatus('error');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="igc-page">
      <div className="igc-header">
        <div className="igc-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
            <circle cx="12" cy="12" r="4"/>
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <div>
          <h1 className="igc-title">ربط حساب انستقرام</h1>
          <p className="igc-subtitle">
            اربط حسابك التجاري على انستقرام لاستيراد منتجاتك تلقائياً بواسطة الذكاء الاصطناعي
          </p>
        </div>
      </div>

      <div className="igc-card">
        {status === 'loading' && (
          <div className="igc-state igc-loading">
            <div className="igc-spinner" />
            <p>جارٍ التحقق من الاتصال…</p>
          </div>
        )}

        {status === 'connected' && info && (
          <div className="igc-state igc-connected">
            <div className="igc-connected-badge">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              متصل
            </div>
            <div className="igc-account-info">
              <span className="igc-account-label">الحساب</span>
              <span className="igc-account-name">
                {info.username ? `@${info.username}` : 'حساب تجاري'}
              </span>
            </div>
            {info.connected_at && (
              <div className="igc-account-info">
                <span className="igc-account-label">تاريخ الربط</span>
                <span className="igc-account-name">
                  {new Date(info.connected_at).toLocaleDateString('ar-EG')}
                </span>
              </div>
            )}
            <div className="igc-actions">
              <button className="igc-btn-primary" onClick={startOAuth} disabled={actionLoading}>
                إعادة الربط
              </button>
              <button className="igc-btn-danger" onClick={disconnect} disabled={actionLoading}>
                {actionLoading ? 'جارٍ القطع…' : 'قطع الاتصال'}
              </button>
            </div>
          </div>
        )}

        {status === 'disconnected' && (
          <div className="igc-state igc-disconnected">
            <div className="igc-disconnected-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
              </svg>
            </div>
            <h3>لم يتم ربط أي حساب</h3>
            <p>اربط حسابك التجاري على انستقرام حتى يتمكن الذكاء الاصطناعي من استيراد منتجاتك من منشوراتك.</p>
            <ul className="igc-perms">
              <li>قراءة منشوراتك ومقاطع الريلز</li>
              <li>استخراج بيانات المنتجات تلقائياً</li>
              <li>تحليل إحصائيات حسابك</li>
            </ul>
            <button className="igc-btn-connect" onClick={startOAuth} disabled={actionLoading}>
              {actionLoading ? (
                <><div className="igc-btn-spinner" /> جارٍ التوجيه…</>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                  ربط حساب انستقرام
                </>
              )}
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="igc-state igc-error">
            <p>حدث خطأ في التحقق. تأكد من تسجيل الدخول وأعد المحاولة.</p>
            <button className="igc-btn-primary" onClick={fetchStatus}>إعادة المحاولة</button>
          </div>
        )}
      </div>
    </div>
  );
}
