import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import './InstagramConnectPage.css';

interface ConnectionStatus {
  connected: boolean;
  username: string | null;
  connected_at: string | null;
}

type ImportStatus = 'idle' | 'importing' | 'done' | 'error';

export default function InstagramConnectPage() {
  const { t } = useTranslation('merchant');
  const { direction, lang } = useLanguage();
  const { refreshShop } = useMerchantAuth();
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading');
  const [info, setInfo] = useState<ConnectionStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importResult, setImportResult] = useState<{ count: number; message: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      window.history.replaceState({}, '', url.toString());
      refreshShop();
    }
    fetchStatus();
  }, []);

  async function startOAuth() {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('error'); return; }

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
      refreshShop();
    } catch {
      setStatus('error');
    } finally {
      setActionLoading(false);
    }
  }

  async function startImport() {
    setImportStatus('importing');
    setImportResult(null);
    setImportError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setImportStatus('error'); setImportError(t('instagramConnect.sessionExpired')); return; }

      const res = await fetch('/api/instagram/import-products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setImportStatus('error');
        setImportError(data.error ?? t('instagramConnect.importFailed'));
        return;
      }

      setImportResult({ count: data.count, message: data.message });
      setImportStatus('done');
    } catch (err: any) {
      setImportStatus('error');
      setImportError(err.message ?? t('instagramConnect.unexpectedError'));
    }
  }

  return (
    <div className="igc-page" dir={direction}>
      <div className="igc-header">
        <div className="igc-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
            <circle cx="12" cy="12" r="4"/>
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <div>
          <h1 className="igc-title">{t('instagramConnect.title')}</h1>
          <p className="igc-subtitle">
            {t('instagramConnect.subtitle')}
          </p>
        </div>
      </div>

      <div className="igc-card">
        {status === 'loading' && (
          <div className="igc-state igc-loading">
            <div className="igc-spinner" />
            <p>{t('instagramConnect.checkingConnection')}</p>
          </div>
        )}

        {status === 'connected' && info && (
          <div className="igc-state igc-connected">
            <div className="igc-connected-badge">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {t('instagramConnect.connected')}
            </div>
            <div className="igc-account-info">
              <span className="igc-account-label">{t('instagramConnect.account')}</span>
              <span className="igc-account-name">
                {info.username ? `@${info.username}` : t('instagramConnect.businessAccount')}
              </span>
            </div>
            {info.connected_at && (
              <div className="igc-account-info">
                <span className="igc-account-label">{t('instagramConnect.connectedDate')}</span>
                <span className="igc-account-name">
                  {new Date(info.connected_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                </span>
              </div>
            )}
            <div className="igc-actions">
              <button type="button" className="igc-btn-primary" onClick={startOAuth} disabled={actionLoading}>
                {t('instagramConnect.reconnect')}
              </button>
              <button type="button" className="igc-btn-danger" onClick={disconnect} disabled={actionLoading}>
                {actionLoading ? t('instagramConnect.disconnecting') : t('instagramConnect.disconnect')}
              </button>
            </div>

            {/* ── Import section ── */}
            <div className="igc-import-section">
              <div className="igc-import-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>{t('instagramConnect.importSectionTitle')}</span>
              </div>
              <p className="igc-import-desc">
                {t('instagramConnect.importSectionDesc')}
              </p>

              {importStatus === 'idle' && (
                <button type="button" className="igc-btn-import" onClick={startImport}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                  {t('instagramConnect.importFromInstagram')}
                </button>
              )}

              {importStatus === 'importing' && (
                <div className="igc-import-loading">
                  <div className="igc-import-spinner" />
                  <div>
                    <p className="igc-import-loading-title">{t('instagramConnect.analyzingPosts')}</p>
                    <p className="igc-import-loading-sub">{t('instagramConnect.analyzingPostsSub')}</p>
                  </div>
                </div>
              )}

              {importStatus === 'done' && importResult && (
                <div className="igc-import-result igc-import-result--success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <div>
                    <p className="igc-import-result-title">
                      {importResult.count > 0
                        ? t('instagramConnect.importedCount', { count: importResult.count })
                        : t('instagramConnect.noNewProducts')}
                    </p>
                    <p className="igc-import-result-msg">{importResult.message}</p>
                  </div>
                  <button type="button" className="igc-import-retry" onClick={() => setImportStatus('idle')}>
                    {t('instagramConnect.importAgain')}
                  </button>
                </div>
              )}

              {importStatus === 'error' && (
                <div className="igc-import-result igc-import-result--error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div>
                    <p className="igc-import-result-title">{t('instagramConnect.importFailed')}</p>
                    <p className="igc-import-result-msg">{importError}</p>
                  </div>
                  <button type="button" className="igc-import-retry" onClick={() => setImportStatus('idle')}>
                    {t('instagramConnect.retry')}
                  </button>
                </div>
              )}
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
            <h3>{t('instagramConnect.noAccountLinked')}</h3>
            <p>{t('instagramConnect.noAccountLinkedDesc')}</p>
            <ul className="igc-perms">
              <li>{t('instagramConnect.permReadPosts')}</li>
              <li>{t('instagramConnect.permExtractProducts')}</li>
              <li>{t('instagramConnect.permAnalyzeStats')}</li>
            </ul>
            <button type="button" className="igc-btn-connect" onClick={startOAuth} disabled={actionLoading}>
              {actionLoading ? (
                <><div className="igc-btn-spinner" /> {t('instagramConnect.redirecting')}</>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                  {t('instagramConnect.connectAccount')}
                </>
              )}
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="igc-state igc-error">
            <p>{t('instagramConnect.errorCheckingConnection')}</p>
            <button type="button" className="igc-btn-primary" onClick={fetchStatus}>{t('instagramConnect.retry')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
