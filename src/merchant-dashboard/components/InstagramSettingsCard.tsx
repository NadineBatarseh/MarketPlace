import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import './InstagramSettingsCard.css';

interface ConnectionStatus {
  connected: boolean;
  username: string | null;
  connected_at: string | null;
}

type PageStatus = 'loading' | 'connected' | 'disconnected' | 'error';
type ImportStatus = 'idle' | 'importing' | 'done' | 'error';

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

export default function InstagramSettingsCard() {
  const { t } = useTranslation('merchant');
  const { direction, lang } = useLanguage();
  const { refreshShop } = useMerchantAuth();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [info, setInfo] = useState<ConnectionStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importResult, setImportResult] = useState<{ count: number; message: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  async function fetchStatus() {
    setStatus('loading');
    try {
      const headers = await authHeader();
      if (!headers) { setStatus('error'); return; }

      const res = await fetch('/api/instagram/status', { headers });
      if (!res.ok) { setStatus('error'); return; }
      const data = await res.json();
      setInfo(data);
      setStatus(data.connected ? 'connected' : 'disconnected');
    } catch (err) {
      console.error('[Instagram] fetchStatus error:', err);
      setStatus('error');
    }
  }

  useEffect(() => {
    // Only react to OUR OWN redirect marker — leave the URL untouched for any
    // other integration's redirect (e.g. Meta Catalog) handling its own params.
    const params = new URLSearchParams(window.location.search);
    if (params.get('integration') === 'instagram') {
      setExpanded(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('integration');
      url.searchParams.delete('connected');
      url.searchParams.delete('section');
      window.history.replaceState({}, '', url.toString());
      if (params.get('connected') === 'true') refreshShop();
    }

    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startOAuth() {
    setActionLoading(true);
    try {
      const headers = await authHeader();
      if (!headers) { setStatus('error'); return; }

      const res = await fetch('/api/instagram/init', { method: 'POST', headers });
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
      const headers = await authHeader();
      if (!headers) return;

      await fetch('/api/instagram/disconnect', { method: 'DELETE', headers });
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
      const headers = await authHeader();
      if (!headers) { setImportStatus('error'); setImportError(t('instagramSettings.sessionExpired')); return; }

      const res = await fetch('/api/instagram/import-products', { method: 'POST', headers });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setImportStatus('error');
        setImportError(data.error ?? t('instagramSettings.importFailed'));
        return;
      }

      setImportResult({ count: data.count, message: data.message });
      setImportStatus('done');
    } catch (err: any) {
      setImportStatus('error');
      setImportError(err.message ?? t('instagramSettings.unexpectedError'));
    }
  }

  return (
    <div className={`igc-shell${expanded ? ' igc-shell--expanded' : ''}`} dir={direction}>
      <button type="button" className="igc-summary" onClick={() => setExpanded((v) => !v)}>
        <div className="igc-summary-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="igc-summary-main">
          <div className="igc-summary-title-row">
            <span className="igc-summary-title">Instagram Business</span>
            {status === 'loading' ? (
              <span className="igc-pill igc-pill--idle">{t('instagramSettings.checking')}</span>
            ) : status === 'connected' ? (
              <span className="igc-pill igc-pill--on">{t('instagramSettings.connected')}</span>
            ) : (
              <span className="igc-pill igc-pill--off">{t('instagramSettings.notConnected')}</span>
            )}
          </div>
          <div className="igc-summary-meta">
            {status === 'connected' && info?.username && <span>@{info.username}</span>}
            {status !== 'connected' && <span>{t('instagramSettings.summaryHint')}</span>}
          </div>
        </div>
        <svg className={`igc-chevron${expanded ? ' igc-chevron--up' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="igc-body">
          {status === 'loading' && (
            <div className="igc-state igc-loading">
              <div className="igc-spinner" />
              <p>{t('instagramSettings.checkingConnection')}</p>
            </div>
          )}

          {status === 'connected' && info && (
            <div className="igc-state igc-connected">
              <div className="igc-connected-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('instagramSettings.connected')}
              </div>
              <div className="igc-account-info">
                <span className="igc-account-label">{t('instagramSettings.account')}</span>
                <span className="igc-account-name">{info.username ? `@${info.username}` : t('instagramSettings.businessAccount')}</span>
              </div>
              {info.connected_at && (
                <div className="igc-account-info">
                  <span className="igc-account-label">{t('instagramSettings.connectedDate')}</span>
                  <span className="igc-account-name">{new Date(info.connected_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}</span>
                </div>
              )}
              <div className="igc-actions">
                <button type="button" className="igc-btn-primary" onClick={startOAuth} disabled={actionLoading}>
                  {t('instagramSettings.reconnect')}
                </button>
                <button type="button" className="igc-btn-danger" onClick={() => setShowDisconnectConfirm(true)} disabled={actionLoading}>
                  {actionLoading ? t('instagramSettings.disconnecting') : t('instagramSettings.disconnect')}
                </button>
              </div>

              <div className="igc-import-section">
                <div className="igc-import-header">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{t('instagramSettings.importSectionTitle')}</span>
                </div>
                <p className="igc-import-desc">
                  {t('instagramSettings.importSectionDesc')}
                </p>

                {importStatus === 'idle' && (
                  <button type="button" className="igc-btn-import" onClick={startImport}>
                    {t('instagramSettings.importFromInstagram')}
                  </button>
                )}

                {importStatus === 'importing' && (
                  <div className="igc-import-loading">
                    <div className="igc-import-spinner" />
                    <div>
                      <p className="igc-import-loading-title">{t('instagramSettings.analyzingPosts')}</p>
                      <p className="igc-import-loading-sub">{t('instagramSettings.analyzingPostsSub')}</p>
                    </div>
                  </div>
                )}

                {importStatus === 'done' && importResult && (
                  <div className="igc-import-result igc-import-result--success">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <div>
                      <p className="igc-import-result-title">
                        {importResult.count > 0 ? t('instagramSettings.importedCount', { count: importResult.count }) : t('instagramSettings.noNewProducts')}
                      </p>
                      <p className="igc-import-result-msg">{importResult.message}</p>
                    </div>
                    <button type="button" className="igc-import-retry" onClick={() => setImportStatus('idle')}>
                      {t('instagramSettings.importAgain')}
                    </button>
                  </div>
                )}

                {importStatus === 'error' && (
                  <div className="igc-import-result igc-import-result--error">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div>
                      <p className="igc-import-result-title">{t('instagramSettings.importFailed')}</p>
                      <p className="igc-import-result-msg">{importError}</p>
                    </div>
                    <button type="button" className="igc-import-retry" onClick={() => setImportStatus('idle')}>
                      {t('instagramSettings.retry')}
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
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <h3>{t('instagramSettings.noAccountLinked')}</h3>
              <p>{t('instagramSettings.noAccountLinkedDesc')}</p>
              <ul className="igc-perms">
                <li>{t('instagramSettings.permReadPosts')}</li>
                <li>{t('instagramSettings.permExtractProducts')}</li>
                <li>{t('instagramSettings.permAnalyzeStats')}</li>
              </ul>
              <button type="button" className="igc-btn-connect" onClick={startOAuth} disabled={actionLoading}>
                {actionLoading ? (
                  <><div className="igc-btn-spinner" /> {t('instagramSettings.redirecting')}</>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                    </svg>
                    {t('instagramSettings.connectAccount')}
                  </>
                )}
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="igc-state igc-error">
              <p>{t('instagramSettings.errorCheckingConnection')}</p>
              <button type="button" className="igc-btn-primary" onClick={fetchStatus}>{t('instagramSettings.retry')}</button>
            </div>
          )}
        </div>
      )}

      {showDisconnectConfirm && (
        <div className="igc-confirm-overlay" onClick={() => setShowDisconnectConfirm(false)}>
          <div className="igc-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>{t('instagramSettings.confirmDisconnectTitle')}</h3>
            <p>{t('instagramSettings.confirmDisconnectDesc')}</p>
            <div className="igc-confirm-actions">
              <button type="button" className="igc-btn-danger" onClick={() => { setShowDisconnectConfirm(false); disconnect(); }}>
                {t('instagramSettings.confirmDisconnectBtn')}
              </button>
              <button type="button" className="igc-btn-primary" onClick={() => setShowDisconnectConfirm(false)}>
                {t('instagramSettings.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
