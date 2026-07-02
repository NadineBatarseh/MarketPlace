import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';
import './MetaCatalogSettingsCard.css';

interface ConnectionStatus {
  connected: boolean;
  business_name: string | null;
  catalog_id: string | null;
  catalog_name: string | null;
  connected_at: string | null;
}

interface MetaCatalog {
  catalog_id: string;
  catalog_name: string;
  business_id: string;
  business_name: string;
}

interface MetaPreviewProduct {
  meta_product_id: string;
  name: string;
  description: string | null;
  price: string | null;
  currency: string | null;
  image_url: string | null;
  availability: string | null;
  brand: string | null;
  already_imported: boolean;
}

type PageStatus = 'loading' | 'disconnected' | 'picking_catalog' | 'connected' | 'error';
type ImportStatus = 'idle' | 'importing' | 'done' | 'error';

type SyncFieldKey = 'price' | 'quantity' | 'availability' | 'details' | 'images';
type SyncFields = Record<SyncFieldKey, boolean>;

const SYNC_FIELD_KEYS: SyncFieldKey[] = ['price', 'quantity', 'availability', 'details', 'images'];

const DEFAULT_SYNC_FIELDS: SyncFields = {
  price: true,
  quantity: true,
  availability: true,
  details: false,
  images: false,
};

interface SyncSettings {
  auto_import_new_products: boolean;
  auto_export_new_products: boolean;
  auto_sync_meta_updates_to_souqlink: boolean;
  auto_sync_souqlink_updates_to_meta: boolean;
  inbound_sync_fields: SyncFields;
  outbound_sync_fields: SyncFields;
  settings_updated_at: string | null;
}

function settingsEqual(a: SyncSettings | null, b: SyncSettings | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.auto_import_new_products === b.auto_import_new_products &&
    a.auto_export_new_products === b.auto_export_new_products &&
    a.auto_sync_meta_updates_to_souqlink === b.auto_sync_meta_updates_to_souqlink &&
    a.auto_sync_souqlink_updates_to_meta === b.auto_sync_souqlink_updates_to_meta &&
    SYNC_FIELD_KEYS.every((k) => a.inbound_sync_fields[k] === b.inbound_sync_fields[k]) &&
    SYNC_FIELD_KEYS.every((k) => a.outbound_sync_fields[k] === b.outbound_sync_fields[k])
  );
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

function FieldCheckboxes({
  fields,
  labels,
  onToggle,
}: {
  fields: SyncFields;
  labels: Record<SyncFieldKey, string>;
  onToggle: (key: SyncFieldKey, checked: boolean) => void;
}) {
  return (
    <div className="mcs-field-grid">
      {SYNC_FIELD_KEYS.map((key) => (
        <label key={key} className="mcs-field-checkbox">
          <input
            type="checkbox"
            checked={fields[key]}
            onChange={(e) => onToggle(key, e.target.checked)}
          />
          <span>{labels[key]}</span>
        </label>
      ))}
    </div>
  );
}

export default function MetaCatalogSettingsCard() {
  const { t } = useTranslation('merchant');
  const { direction, lang } = useLanguage();

  const INBOUND_FIELD_LABELS: Record<SyncFieldKey, string> = {
    price: t('metaCatalog.fieldSyncPrice'),
    quantity: t('metaCatalog.fieldSyncQuantity'),
    availability: t('metaCatalog.fieldSyncAvailability'),
    details: t('metaCatalog.fieldSyncDetails'),
    images: t('metaCatalog.fieldSyncImages'),
  };

  const OUTBOUND_FIELD_LABELS: Record<SyncFieldKey, string> = {
    price: t('metaCatalog.fieldSendPrice'),
    quantity: t('metaCatalog.fieldSendQuantity'),
    availability: t('metaCatalog.fieldSendAvailability'),
    details: t('metaCatalog.fieldSendDetails'),
    images: t('metaCatalog.fieldSendImages'),
  };

  function onLabel(on: boolean) { return on ? t('metaCatalog.statusOn') : t('metaCatalog.statusOff'); }

  function summarizeDirection(newEnabled: boolean, updatesEnabled: boolean): string {
    if (newEnabled && updatesEnabled) return t('metaCatalog.summaryNewAndUpdates');
    if (newEnabled) return t('metaCatalog.summaryNewOnly');
    if (updatesEnabled) return t('metaCatalog.summaryUpdatesOnly');
    return t('metaCatalog.statusOff');
  }

  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [info, setInfo] = useState<ConnectionStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [redirectError, setRedirectError] = useState<string | null>(null);

  const [catalogs, setCatalogs] = useState<MetaCatalog[]>([]);
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pickedCatalogId, setPickedCatalogId] = useState<string | null>(null);

  const [products, setProducts] = useState<MetaPreviewProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importResult, setImportResult] = useState<{ count: number; message: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SyncSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showChangeCatalogConfirm, setShowChangeCatalogConfirm] = useState(false);

  const [manualSyncing, setManualSyncing] = useState(false);
  const [manualSyncResult, setManualSyncResult] = useState<{ synced: number; batches: number } | null>(null);
  const [manualSyncError, setManualSyncError] = useState<string | null>(null);

  function parseSettingsResponse(data: any): SyncSettings {
    return {
      auto_import_new_products: !!data.auto_import_new_products,
      auto_export_new_products: !!data.auto_export_new_products,
      auto_sync_meta_updates_to_souqlink: !!data.auto_sync_meta_updates_to_souqlink,
      auto_sync_souqlink_updates_to_meta: !!data.auto_sync_souqlink_updates_to_meta,
      inbound_sync_fields: { ...DEFAULT_SYNC_FIELDS, ...(data.inbound_sync_fields ?? {}) },
      outbound_sync_fields: { ...DEFAULT_SYNC_FIELDS, ...(data.outbound_sync_fields ?? {}) },
      settings_updated_at: data.settings_updated_at ?? null,
    };
  }

  async function fetchSettings() {
    setSettingsLoading(true);
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch('/api/meta-catalog/settings', { headers });
      const data = await res.json();
      if (data.ok) {
        const s = parseSettingsResponse(data);
        setSettings(s);
        setSettingsDraft(s);
      }
    } catch (err) {
      console.error('[MetaCatalog] fetchSettings error:', err);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function fetchStatus() {
    setStatus('loading');
    try {
      const headers = await authHeader();
      if (!headers) { setStatus('error'); return; }

      const res = await fetch('/api/meta-catalog/status', { headers });
      if (!res.ok) { setStatus('error'); return; }
      const data = await res.json();
      setInfo(data);

      if (!data.connected) {
        setStatus('disconnected');
      } else if (!data.catalog_id) {
        setStatus('picking_catalog');
        fetchSettings();
      } else {
        setStatus('connected');
        fetchSettings();
      }
    } catch (err) {
      console.error('[MetaCatalog] fetchStatus error:', err);
      setStatus('error');
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get('integration');
    const errParam = params.get('error');
    const connectedParam = params.get('connected');

    if (integration === 'meta') {
      setExpanded(true);
      if (errParam) setRedirectError(errParam);
    }

    if (integration || errParam || connectedParam || params.get('section')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('integration');
      url.searchParams.delete('error');
      url.searchParams.delete('connected');
      url.searchParams.delete('section');
      window.history.replaceState({}, '', url.toString());
    }

    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!expanded) return;
    if (status === 'picking_catalog' && catalogs.length === 0 && !catalogsLoading) fetchCatalogs();
    if (status === 'connected' && products.length === 0 && !productsLoading) fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, status]);

  async function startOAuth() {
    setActionLoading(true);
    try {
      const headers = await authHeader();
      if (!headers) { setStatus('error'); return; }

      const res = await fetch('/api/meta-catalog/init', { method: 'POST', headers });
      const data = await res.json();
      if (!data.ok || !data.auth_url) {
        console.error('[MetaCatalog] /api/meta-catalog/init failed:', data);
        setStatus('error');
        return;
      }
      window.location.href = data.auth_url;
    } catch (err) {
      console.error('[MetaCatalog] startOAuth error:', err);
      setActionLoading(false);
      setStatus('error');
    }
  }

  async function disconnect() {
    setActionLoading(true);
    try {
      const headers = await authHeader();
      if (!headers) return;
      await fetch('/api/meta-catalog/disconnect', { method: 'DELETE', headers });
      setInfo(null);
      setProducts([]);
      setCatalogs([]);
      setSettings(null);
      setSettingsDraft(null);
      setStatus('disconnected');
    } catch {
      setStatus('error');
    } finally {
      setActionLoading(false);
    }
  }

  async function fetchCatalogs() {
    setCatalogsLoading(true);
    setCatalogError(null);
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch('/api/meta-catalog/catalogs', { headers });
      const data = await res.json();
      if (!data.ok) {
        if (data.code === 'not_connected') {
          // The connection was removed server-side (e.g. disconnected from another
          // tab/session) after this page already believed it was connected — resync.
          fetchStatus();
          return;
        }
        setCatalogError(data.error ?? t('metaCatalog.loadCatalogsFailed'));
        return;
      }
      const list: MetaCatalog[] = data.catalogs ?? [];
      setCatalogs(list);
      if (list.length === 1) setPickedCatalogId(list[0].catalog_id);
    } catch (err: any) {
      setCatalogError(err.message ?? t('metaCatalog.unexpectedError'));
    } finally {
      setCatalogsLoading(false);
    }
  }

  async function selectCatalog(catalog: MetaCatalog) {
    setActionLoading(true);
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch('/api/meta-catalog/select-catalog', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      const data = await res.json();
      if (!data.ok) {
        setCatalogError(data.error ?? t('metaCatalog.selectCatalogFailed'));
        return;
      }
      setPickedCatalogId(null);
      fetchStatus();
    } catch (err: any) {
      setCatalogError(err.message ?? t('metaCatalog.unexpectedError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function fetchPreview() {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch('/api/meta-catalog/products/preview', { headers });
      const data = await res.json();
      if (!data.ok) {
        setProductsError(data.error ?? t('metaCatalog.loadProductsFailed'));
        return;
      }
      setProducts(data.products ?? []);
    } catch (err: any) {
      setProductsError(err.message ?? t('metaCatalog.unexpectedError'));
    } finally {
      setProductsLoading(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllAvailable() {
    setSelected(new Set(products.filter((p) => !p.already_imported).map((p) => p.meta_product_id)));
  }

  async function startImport() {
    if (selected.size === 0) return;
    setImportStatus('importing');
    setImportResult(null);
    setImportError(null);
    try {
      const headers = await authHeader();
      if (!headers) { setImportStatus('error'); setImportError(t('metaCatalog.sessionExpired')); return; }

      const res = await fetch('/api/meta-catalog/import', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: Array.from(selected) }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setImportStatus('error');
        setImportError(data.error ?? t('metaCatalog.importFailed'));
        return;
      }

      setImportResult({ count: data.count, message: data.message });
      setImportStatus('done');
      setSelected(new Set());
      fetchPreview();
    } catch (err: any) {
      setImportStatus('error');
      setImportError(err.message ?? t('metaCatalog.unexpectedError'));
    }
  }

  function confirmChangeCatalog() {
    setShowChangeCatalogConfirm(false);
    setCatalogs([]);
    setCatalogError(null);
    setPickedCatalogId(null);
    setStatus('picking_catalog');
  }

  function updateDraft(patch: Partial<SyncSettings>) {
    setSettingsDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettingsSaved(false);
  }

  function updateInboundField(key: SyncFieldKey, checked: boolean) {
    setSettingsDraft((prev) => prev ? { ...prev, inbound_sync_fields: { ...prev.inbound_sync_fields, [key]: checked } } : prev);
    setSettingsSaved(false);
  }

  function updateOutboundField(key: SyncFieldKey, checked: boolean) {
    setSettingsDraft((prev) => prev ? { ...prev, outbound_sync_fields: { ...prev.outbound_sync_fields, [key]: checked } } : prev);
    setSettingsSaved(false);
  }

  function cancelSettingsDraft() {
    if (settings) setSettingsDraft(settings);
    setSettingsError(null);
    setSettingsSaved(false);
  }

  const settingsDirty = !settingsEqual(settings, settingsDraft);

  async function saveSettings() {
    if (!settingsDraft) return;
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const headers = await authHeader();
      if (!headers) { setSettingsError(t('metaCatalog.sessionExpired')); return; }

      const res = await fetch('/api/meta-catalog/settings', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_import_new_products: settingsDraft.auto_import_new_products,
          auto_export_new_products: settingsDraft.auto_export_new_products,
          auto_sync_meta_updates_to_souqlink: settingsDraft.auto_sync_meta_updates_to_souqlink,
          auto_sync_souqlink_updates_to_meta: settingsDraft.auto_sync_souqlink_updates_to_meta,
          inbound_sync_fields: settingsDraft.inbound_sync_fields,
          outbound_sync_fields: settingsDraft.outbound_sync_fields,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === 'not_connected') {
          // Connection was removed server-side after this page already believed it
          // was connected (e.g. disconnected elsewhere, or the row was deleted
          // directly). Resync the whole card to the real, current state instead of
          // leaving a stale "connected" settings panel up.
          setSettingsError(t('metaCatalog.connectionLostResync'));
          fetchStatus();
          return;
        }
        setSettingsError(data.error ?? t('metaCatalog.saveSettingsFailed'));
        return;
      }
      const saved = parseSettingsResponse(data);
      setSettings(saved);
      setSettingsDraft(saved);
      setSettingsSaved(true);
    } catch (err: any) {
      setSettingsError(err.message ?? t('metaCatalog.unexpectedError'));
    } finally {
      setSettingsSaving(false);
    }
  }

  /**
   * Pushes every published product to Meta right now, via the real sync engine
   * (server/metaCatalog/metaCatalogAPISync.ts) using this merchant's own
   * connected catalog. This is the manual fallback for "manual publish" — useful
   * regardless of whether the automatic switches above are on.
   */
  async function runManualSync() {
    setManualSyncing(true);
    setManualSyncResult(null);
    setManualSyncError(null);
    try {
      const headers = await authHeader();
      if (!headers) { setManualSyncError(t('metaCatalog.sessionExpired')); return; }

      const res = await fetch('/api/catalog/sync', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setManualSyncError(data.error ?? t('metaCatalog.manualSyncFailed'));
        return;
      }
      setManualSyncResult({ synced: data.synced ?? 0, batches: data.batches ?? 0 });
      if (data.errors?.length) {
        setManualSyncError(data.errors.join(' | '));
      }
    } catch (err: any) {
      setManualSyncError(err.message ?? t('metaCatalog.unexpectedError'));
    } finally {
      setManualSyncing(false);
    }
  }

  const isConnectedLike = status === 'connected' || status === 'picking_catalog';
  // Inbound (Meta → SouqLink) automation has no engine yet — only these two
  // need the "saved as a preference, not running yet" caveat after save.
  // Outbound (SouqLink → Meta) is wired to the live Supabase product webhook,
  // so enabling it actually pushes products — no caveat needed there.
  const inboundAutomaticEnabled = !!settings && (
    settings.auto_import_new_products ||
    settings.auto_sync_meta_updates_to_souqlink
  );
  const showTwoWayWarning = !!settingsDraft?.auto_sync_meta_updates_to_souqlink && !!settingsDraft?.auto_sync_souqlink_updates_to_meta;

  return (
    <div className={`mcs-card${expanded ? ' mcs-card--expanded' : ''}`} dir={direction}>
      <button
        type="button"
        className="mcs-summary"
        onClick={() => setExpanded((v) => {
          const next = !v;
          if (!next) cancelSettingsDraft(); // collapsing discards unsaved changes
          return next;
        })}
      >
        <div className="mcs-summary-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <div className="mcs-summary-main">
          <div className="mcs-summary-title-row">
            <span className="mcs-summary-title">{t('metaCatalog.summaryTitle')}</span>
            {status === 'loading' ? (
              <span className="mcs-pill mcs-pill--idle">{t('metaCatalog.checking')}</span>
            ) : isConnectedLike ? (
              <span className="mcs-pill mcs-pill--on">{t('metaCatalog.connected')}</span>
            ) : (
              <span className="mcs-pill mcs-pill--off">{t('metaCatalog.notConnected')}</span>
            )}
          </div>
          <div className="mcs-summary-meta">
            {info?.catalog_name && <span>{t('metaCatalog.catalogLabel')}: {info.catalog_name}</span>}
            <span>{t('metaCatalog.metaToSouqlinkLabel')}: {summarizeDirection(!!settings?.auto_import_new_products, !!settings?.auto_sync_meta_updates_to_souqlink)}</span>
            <span>{t('metaCatalog.souqlinkToMetaLabel')}: {summarizeDirection(!!settings?.auto_export_new_products, !!settings?.auto_sync_souqlink_updates_to_meta)}</span>
          </div>
        </div>
        <svg className={`mcs-chevron${expanded ? ' mcs-chevron--up' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="mcs-body">
          {redirectError && (
            <div className="mcc-inline-error">{redirectError}</div>
          )}

          {status === 'loading' && (
            <div className="mcc-state mcc-loading">
              <div className="mcc-spinner" />
              <p>{t('metaCatalog.checkingConnection')}</p>
            </div>
          )}

          {status === 'disconnected' && (
            <div className="mcc-state mcc-disconnected">
              <div className="mcc-disconnected-badge">{t('metaCatalog.notConnected')}</div>
              <div className="mcc-disconnected-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </div>
              <h3>{t('metaCatalog.noCatalogLinked')}</h3>
              <p>{t('metaCatalog.noCatalogLinkedDesc')}</p>
              <ul className="mcc-perms">
                <li>{t('metaCatalog.permReadCatalog')}</li>
                <li>{t('metaCatalog.permListCatalogs')}</li>
                <li>{t('metaCatalog.permImportSelected')}</li>
              </ul>
              <button type="button" className="mcc-btn-connect" onClick={startOAuth} disabled={actionLoading}>
                {actionLoading ? (
                  <><div className="mcc-btn-spinner" /> {t('metaCatalog.redirecting')}</>
                ) : (
                  t('metaCatalog.connectMetaNow')
                )}
              </button>
            </div>
          )}

          {status === 'picking_catalog' && (
            <div className="mcc-state mcc-picking">
              <div className="mcc-connected-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('metaCatalog.connected')}
              </div>
              {info?.business_name && (
                <div className="mcc-account-info">
                  <span className="mcc-account-label">{t('metaCatalog.businessAccount')}</span>
                  <span className="mcc-account-name">{info.business_name}</span>
                </div>
              )}
              <h3>{t('metaCatalog.chooseCatalog')}</h3>
              <p>{t('metaCatalog.chooseCatalogDesc')}</p>

              {catalogsLoading && <div className="mcc-spinner" />}

              {!catalogsLoading && catalogError && (
                <div className="mcc-inline-error">{catalogError}</div>
              )}

              {!catalogsLoading && !catalogError && catalogs.length === 0 && (
                <div className="mcc-inline-error">{t('metaCatalog.noCatalogsFound')}</div>
              )}

              {!catalogsLoading && catalogs.length > 0 && (
                <div className="mcc-catalog-list">
                  {catalogs.map((c) => (
                    <label
                      key={c.catalog_id}
                      className={`mcc-catalog-item${pickedCatalogId === c.catalog_id ? ' mcc-catalog-item--picked' : ''}`}
                    >
                      <input
                        type="radio"
                        name="meta-catalog-pick"
                        checked={pickedCatalogId === c.catalog_id}
                        onChange={() => setPickedCatalogId(c.catalog_id)}
                      />
                      <span className="mcc-catalog-name">{c.catalog_name}</span>
                      <span className="mcc-catalog-business">{c.business_name}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="mcc-actions">
                <button
                  type="button"
                  className="mcc-btn-primary"
                  disabled={!pickedCatalogId || actionLoading || catalogsLoading}
                  onClick={() => {
                    const c = catalogs.find((x) => x.catalog_id === pickedCatalogId);
                    if (c) selectCatalog(c);
                  }}
                >
                  {actionLoading ? t('metaCatalog.confirming') : t('metaCatalog.confirmCatalog')}
                </button>
                <button type="button" className="mcc-btn-danger" onClick={() => setShowDisconnectConfirm(true)} disabled={actionLoading}>
                  {t('metaCatalog.disconnect')}
                </button>
              </div>
            </div>
          )}

          {status === 'connected' && info && (
            <div className="mcc-state mcc-connected">
              <div className="mcc-connected-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('metaCatalog.connected')}
              </div>
              <div className="mcc-account-info">
                <span className="mcc-account-label">{t('metaCatalog.catalogLabel')}</span>
                <span className="mcc-account-name">{info.catalog_name}</span>
              </div>
              {info.catalog_id && (
                <div className="mcc-account-info">
                  <span className="mcc-account-label">{t('metaCatalog.catalogId')}</span>
                  <span className="mcc-account-name" dir="ltr">{info.catalog_id}</span>
                </div>
              )}
              {info.business_name && (
                <div className="mcc-account-info">
                  <span className="mcc-account-label">{t('metaCatalog.businessAccount')}</span>
                  <span className="mcc-account-name">{info.business_name}</span>
                </div>
              )}
              <div className="mcc-actions">
                <button type="button" className="mcc-btn-primary" onClick={() => setShowChangeCatalogConfirm(true)} disabled={actionLoading}>
                  {t('metaCatalog.changeCatalog')}
                </button>
                <button type="button" className="mcc-btn-primary" onClick={startOAuth} disabled={actionLoading}>
                  {t('metaCatalog.reconnect')}
                </button>
                <button type="button" className="mcc-btn-danger" onClick={() => setShowDisconnectConfirm(true)} disabled={actionLoading}>
                  {t('metaCatalog.disconnect')}
                </button>
              </div>

              {/* ── Import section ── */}
              <div className="mcc-import-section">
                <div className="mcc-import-header">
                  <span>{t('metaCatalog.previewImportTitle')}</span>
                </div>

                {productsLoading && (
                  <div className="mcc-state mcc-loading">
                    <div className="mcc-spinner" />
                    <p>{t('metaCatalog.loadingProducts')}</p>
                  </div>
                )}

                {!productsLoading && productsError && (
                  <div className="mcc-inline-error">{productsError}</div>
                )}

                {!productsLoading && !productsError && products.length === 0 && (
                  <div className="mcc-inline-error">{t('metaCatalog.noProductsInCatalog')}</div>
                )}

                {!productsLoading && products.length > 0 && (
                  <>
                    <div className="mcc-import-toolbar">
                      <button type="button" className="mcc-link-btn" onClick={selectAllAvailable}>
                        {t('metaCatalog.selectAllNew')}
                      </button>
                      <span className="mcc-selected-count">{t('metaCatalog.selectedCount', { count: selected.size })}</span>
                    </div>

                    <div className="mcc-product-grid">
                      {products.map((p) => (
                        <label
                          key={p.meta_product_id}
                          className={`mcc-product-card${p.already_imported ? ' mcc-product-card--imported' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(p.meta_product_id)}
                            disabled={p.already_imported}
                            onChange={() => toggleSelected(p.meta_product_id)}
                          />
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="mcc-product-image" />
                          ) : (
                            <div className="mcc-product-image mcc-product-image--placeholder" />
                          )}
                          <div className="mcc-product-name">{p.name}</div>
                          {p.price && (
                            <div className="mcc-product-price">{p.price} {p.currency ?? ''}</div>
                          )}
                          {p.already_imported && (
                            <span className="mcc-product-imported-tag">{t('metaCatalog.alreadyImported')}</span>
                          )}
                        </label>
                      ))}
                    </div>

                    {importStatus !== 'importing' && (
                      <button
                        type="button"
                        className="mcc-btn-import"
                        onClick={startImport}
                        disabled={selected.size === 0}
                      >
                        {t('metaCatalog.importSelected', { count: selected.size })}
                      </button>
                    )}

                    {importStatus === 'importing' && (
                      <div className="mcc-import-loading">
                        <div className="mcc-import-spinner" />
                        <p>{t('metaCatalog.importingProducts')}</p>
                      </div>
                    )}

                    {importStatus === 'done' && importResult && (
                      <div className="mcc-import-result mcc-import-result--success">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <div>
                          <p className="mcc-import-result-title">{importResult.message}</p>
                        </div>
                        <button type="button" className="mcc-import-retry" onClick={() => setImportStatus('idle')}>
                          {t('metaCatalog.close')}
                        </button>
                      </div>
                    )}

                    {importStatus === 'error' && (
                      <div className="mcc-import-result mcc-import-result--error">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <div>
                          <p className="mcc-import-result-title">{t('metaCatalog.importFailed')}</p>
                          <p className="mcc-import-result-msg">{importError}</p>
                        </div>
                        <button type="button" className="mcc-import-retry" onClick={() => setImportStatus('idle')}>
                          {t('metaCatalog.retry')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Sync settings section ── */}
              <div className="mcs-settings-section">
                <h3 className="mcs-settings-title">{t('metaCatalog.syncSettingsTitle')}</h3>

                {settingsLoading && !settingsDraft && (
                  <div className="mcc-state mcc-loading">
                    <div className="mcc-spinner" />
                    <p>{t('metaCatalog.loadingSyncSettings')}</p>
                  </div>
                )}

                {settingsDraft && settings && (
                  <>
                    {/* ── Status summary ── */}
                    <div className="mcs-status-summary">
                      <h4>{t('metaCatalog.syncStatusTitle')}</h4>
                      <ul>
                        <li>
                          <span>{t('metaCatalog.statusNewMetaToSouqlink')}</span>
                          <span className={`mcs-status-pill${settings.auto_import_new_products ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_import_new_products)}</span>
                        </li>
                        <li>
                          <span>{t('metaCatalog.statusUpdatesMetaToSouqlink')}</span>
                          <span className={`mcs-status-pill${settings.auto_sync_meta_updates_to_souqlink ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_sync_meta_updates_to_souqlink)}</span>
                        </li>
                        <li>
                          <span>{t('metaCatalog.statusNewSouqlinkToMeta')}</span>
                          <span className={`mcs-status-pill${settings.auto_export_new_products ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_export_new_products)}</span>
                        </li>
                        <li>
                          <span>{t('metaCatalog.statusUpdatesSouqlinkToMeta')}</span>
                          <span className={`mcs-status-pill${settings.auto_sync_souqlink_updates_to_meta ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_sync_souqlink_updates_to_meta)}</span>
                        </li>
                      </ul>
                      {settingsDirty && <p className="mcs-status-dirty-note">{t('metaCatalog.unsavedChanges')}</p>}
                    </div>

                    {/* ── Meta Catalog → SouqLink ── */}
                    <div className="mcs-settings-group">
                      <h4>{t('metaCatalog.groupMetaToSouqlinkTitle')}</h4>

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          {t('metaCatalog.toggleAutoImportNew')}
                          <span className="mcs-toggle-desc">{t('metaCatalog.toggleAutoImportNewDesc')}</span>
                        </span>
                        <span className="mcs-switch">
                          <input
                            type="checkbox"
                            checked={settingsDraft.auto_import_new_products}
                            onChange={(e) => updateDraft({ auto_import_new_products: e.target.checked })}
                          />
                          <span className="mcs-switch-slider" />
                        </span>
                      </label>

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          {t('metaCatalog.toggleUpdateFromMeta')}
                          <span className="mcs-toggle-desc">{t('metaCatalog.toggleUpdateFromMetaDesc')}</span>
                        </span>
                        <span className="mcs-switch">
                          <input
                            type="checkbox"
                            checked={settingsDraft.auto_sync_meta_updates_to_souqlink}
                            onChange={(e) => updateDraft({ auto_sync_meta_updates_to_souqlink: e.target.checked })}
                          />
                          <span className="mcs-switch-slider" />
                        </span>
                      </label>

                      {settingsDraft.auto_sync_meta_updates_to_souqlink ? (
                        <FieldCheckboxes
                          fields={settingsDraft.inbound_sync_fields}
                          labels={INBOUND_FIELD_LABELS}
                          onToggle={updateInboundField}
                        />
                      ) : (
                        <p className="mcs-manual-note">{t('metaCatalog.manualFetchNote')}</p>
                      )}

                      <div className="mcs-future-note">
                        {t('metaCatalog.inboundFutureNote')}
                      </div>
                    </div>

                    {/* ── SouqLink → Meta Catalog ── */}
                    <div className="mcs-settings-group">
                      <h4>{t('metaCatalog.groupSouqlinkToMetaTitle')}</h4>

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          {t('metaCatalog.toggleAutoExportNew')}
                          <span className="mcs-toggle-desc">{t('metaCatalog.toggleAutoExportNewDesc')}</span>
                        </span>
                        <span className="mcs-switch">
                          <input
                            type="checkbox"
                            checked={settingsDraft.auto_export_new_products}
                            onChange={(e) => updateDraft({ auto_export_new_products: e.target.checked })}
                          />
                          <span className="mcs-switch-slider" />
                        </span>
                      </label>
                      {settingsDraft.auto_export_new_products && (
                        <p className="mcs-rule-note">{t('metaCatalog.exportDraftsRuleNote')}</p>
                      )}

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          {t('metaCatalog.toggleUpdateFromSouqlink')}
                          <span className="mcs-toggle-desc">{t('metaCatalog.toggleUpdateFromSouqlinkDesc')}</span>
                        </span>
                        <span className="mcs-switch">
                          <input
                            type="checkbox"
                            checked={settingsDraft.auto_sync_souqlink_updates_to_meta}
                            onChange={(e) => updateDraft({ auto_sync_souqlink_updates_to_meta: e.target.checked })}
                          />
                          <span className="mcs-switch-slider" />
                        </span>
                      </label>

                      {settingsDraft.auto_sync_souqlink_updates_to_meta ? (
                        <FieldCheckboxes
                          fields={settingsDraft.outbound_sync_fields}
                          labels={OUTBOUND_FIELD_LABELS}
                          onToggle={updateOutboundField}
                        />
                      ) : (
                        <p className="mcs-manual-note">{t('metaCatalog.manualPublishNote')}</p>
                      )}

                      <p className="mcs-manual-note">
                        {t('metaCatalog.outboundWorksNote')}
                      </p>
                      <div className="mcs-settings-actions">
                        <button type="button" className="mcc-btn-primary" onClick={runManualSync} disabled={manualSyncing}>
                          {manualSyncing ? t('metaCatalog.syncing') : t('metaCatalog.syncAllNow')}
                        </button>
                      </div>
                      {manualSyncResult && (
                        <div className="mcs-settings-saved">
                          {t('metaCatalog.manualSyncResult', { synced: manualSyncResult.synced, batches: manualSyncResult.batches })}
                        </div>
                      )}
                      {manualSyncError && <div className="mcc-inline-error">{manualSyncError}</div>}
                    </div>

                    {showTwoWayWarning && (
                      <div className="mcs-warning-note">
                        {t('metaCatalog.twoWayWarning')}
                      </div>
                    )}

                    {settingsError && <div className="mcc-inline-error">{settingsError}</div>}
                    {settingsSaved && (
                      <div className="mcs-settings-saved">
                        {t('metaCatalog.settingsSavedSuccess')}
                        {settings.settings_updated_at && ` — ${t('metaCatalog.lastUpdated')}: ${new Date(settings.settings_updated_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}`}
                      </div>
                    )}
                    {settingsSaved && inboundAutomaticEnabled && (
                      <div className="mcs-future-note">
                        {t('metaCatalog.inboundSavedFutureNote')}
                      </div>
                    )}

                    <div className="mcs-settings-actions">
                      <button type="button" className="mcc-btn-primary mcs-settings-save-btn" onClick={saveSettings} disabled={settingsSaving || !settingsDirty}>
                        {settingsSaving ? t('metaCatalog.saving') : t('metaCatalog.saveSyncSettings')}
                      </button>
                      <button type="button" className="mcc-btn-danger" onClick={cancelSettingsDraft} disabled={settingsSaving || !settingsDirty}>
                        {t('metaCatalog.discardChanges')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="mcc-state mcc-error">
              <p>{t('metaCatalog.errorCheckingConnection')}</p>
              <button type="button" className="mcc-btn-primary" onClick={fetchStatus}>{t('metaCatalog.retry')}</button>
            </div>
          )}
        </div>
      )}

      {showDisconnectConfirm && (
        <div className="mcs-confirm-overlay" onClick={() => setShowDisconnectConfirm(false)}>
          <div className="mcs-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>{t('metaCatalog.confirmDisconnectTitle')}</h3>
            <p>{t('metaCatalog.confirmDisconnectDesc')}</p>
            <div className="mcs-confirm-actions">
              <button type="button" className="mcc-btn-danger" onClick={() => { setShowDisconnectConfirm(false); disconnect(); }}>
                {t('metaCatalog.confirmDisconnectBtn')}
              </button>
              <button type="button" className="mcc-btn-primary" onClick={() => setShowDisconnectConfirm(false)}>
                {t('metaCatalog.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangeCatalogConfirm && (
        <div className="mcs-confirm-overlay" onClick={() => setShowChangeCatalogConfirm(false)}>
          <div className="mcs-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>{t('metaCatalog.changeCatalogTitle')}</h3>
            <p>{t('metaCatalog.changeCatalogDesc')}</p>
            <div className="mcs-confirm-actions">
              <button type="button" className="mcc-btn-danger" onClick={confirmChangeCatalog}>
                {t('metaCatalog.changeCatalogConfirmBtn')}
              </button>
              <button type="button" className="mcc-btn-primary" onClick={() => setShowChangeCatalogConfirm(false)}>
                {t('metaCatalog.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
