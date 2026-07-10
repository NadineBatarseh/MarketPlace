import { useEffect, useState } from 'react';
import supabase from '../../lib/supabase';
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

const INBOUND_FIELD_LABELS: Record<SyncFieldKey, string> = {
  price: 'مزامنة السعر',
  quantity: 'مزامنة الكمية',
  availability: 'مزامنة حالة التوفر',
  details: 'مزامنة الاسم والوصف',
  images: 'مزامنة الصور',
};

const OUTBOUND_FIELD_LABELS: Record<SyncFieldKey, string> = {
  price: 'إرسال تغييرات السعر',
  quantity: 'إرسال تغييرات الكمية',
  availability: 'إرسال تغييرات حالة التوفر',
  details: 'إرسال تغييرات الاسم والوصف',
  images: 'إرسال تغييرات الصور',
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

function onLabel(on: boolean) { return on ? 'مفعّل' : 'متوقف'; }

function summarizeDirection(newEnabled: boolean, updatesEnabled: boolean): string {
  if (newEnabled && updatesEnabled) return 'المنتجات الجديدة والتحديثات';
  if (newEnabled) return 'المنتجات الجديدة فقط';
  if (updatesEnabled) return 'التحديثات فقط';
  return 'متوقف';
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
  const [productsPreviewOpen, setProductsPreviewOpen] = useState(false);

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
    if (status === 'connected' && productsPreviewOpen && products.length === 0 && !productsLoading) fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, status, productsPreviewOpen]);

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
      setProductsPreviewOpen(false);
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
        setCatalogError(data.error ?? 'فشل تحميل الكتالوجات.');
        return;
      }
      const list: MetaCatalog[] = data.catalogs ?? [];
      setCatalogs(list);
      if (list.length === 1) setPickedCatalogId(list[0].catalog_id);
    } catch (err: any) {
      setCatalogError(err.message ?? 'خطأ غير متوقع.');
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
        setCatalogError(data.error ?? 'فشل اختيار الكتالوج.');
        return;
      }
      setPickedCatalogId(null);
      fetchStatus();
    } catch (err: any) {
      setCatalogError(err.message ?? 'خطأ غير متوقع.');
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
        setProductsError(data.error ?? 'فشل تحميل منتجات الكتالوج.');
        return;
      }
      setProducts(data.products ?? []);
    } catch (err: any) {
      setProductsError(err.message ?? 'خطأ غير متوقع.');
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
      if (!headers) { setImportStatus('error'); setImportError('انتهت جلستك. أعد تسجيل الدخول.'); return; }

      const res = await fetch('/api/meta-catalog/import', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: Array.from(selected) }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setImportStatus('error');
        setImportError(data.error ?? 'فشل الاستيراد.');
        return;
      }

      setImportResult({ count: data.count, message: data.message });
      setImportStatus('done');
      setSelected(new Set());
      fetchPreview();
    } catch (err: any) {
      setImportStatus('error');
      setImportError(err.message ?? 'خطأ غير متوقع.');
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
      if (!headers) { setSettingsError('انتهت جلستك. أعد تسجيل الدخول.'); return; }

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
          setSettingsError('تم فقد الاتصال بحساب Meta — يتم تحديث الحالة...');
          fetchStatus();
          return;
        }
        setSettingsError(data.error ?? 'تعذّر حفظ إعدادات المزامنة.');
        return;
      }
      const saved = parseSettingsResponse(data);
      setSettings(saved);
      setSettingsDraft(saved);
      setSettingsSaved(true);
    } catch (err: any) {
      setSettingsError(err.message ?? 'خطأ غير متوقع.');
    } finally {
      setSettingsSaving(false);
    }
  }

  /**
   * Pushes every published product to Meta right now, via the real sync engine
   * (server/metaCatalog/metaCatalogAPISync.ts) using this merchant's own
   * connected catalog. This is the manual fallback for "نشر يدوي" — useful
   * regardless of whether the automatic switches above are on.
   */
  async function runManualSync() {
    setManualSyncing(true);
    setManualSyncResult(null);
    setManualSyncError(null);
    try {
      const headers = await authHeader();
      if (!headers) { setManualSyncError('انتهت جلستك. أعد تسجيل الدخول.'); return; }

      const res = await fetch('/api/catalog/sync', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setManualSyncError(data.error ?? 'فشلت المزامنة.');
        return;
      }
      setManualSyncResult({ synced: data.synced ?? 0, batches: data.batches ?? 0 });
      if (data.errors?.length) {
        setManualSyncError(data.errors.join(' | '));
      }
    } catch (err: any) {
      setManualSyncError(err.message ?? 'خطأ غير متوقع.');
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
    <div className={`mcs-card${expanded ? ' mcs-card--expanded' : ''}`}>
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
            <span className="mcs-summary-title">ربط وإعدادات Meta Catalog</span>
            {status === 'loading' ? (
              <span className="mcs-pill mcs-pill--idle">جارٍ التحقق…</span>
            ) : isConnectedLike ? (
              <span className="mcs-pill mcs-pill--on">متصل</span>
            ) : (
              <span className="mcs-pill mcs-pill--off">غير متصل</span>
            )}
          </div>
          <div className="mcs-summary-meta">
            {info?.catalog_name && <span>الكتالوج: {info.catalog_name}</span>}
            <span>Meta → SouqLink: {summarizeDirection(!!settings?.auto_import_new_products, !!settings?.auto_sync_meta_updates_to_souqlink)}</span>
            <span>SouqLink → Meta: {summarizeDirection(!!settings?.auto_export_new_products, !!settings?.auto_sync_souqlink_updates_to_meta)}</span>
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
              <p>جارٍ التحقق من الاتصال…</p>
            </div>
          )}

          {status === 'disconnected' && (
            <div className="mcc-state mcc-disconnected">
              <div className="mcc-disconnected-badge">غير متصل</div>
              <div className="mcc-disconnected-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </div>
              <h3>لم يتم ربط أي كتالوج</h3>
              <p>اربط حساب Meta التجاري الخاص بك حتى تتمكن من استيراد منتجاتك من كتالوج Meta إلى متجرك.</p>
              <ul className="mcc-perms">
                <li>قراءة بيانات كتالوج منتجاتك</li>
                <li>عرض قائمة الكتالوجات المتاحة لحسابك التجاري</li>
                <li>استيراد المنتجات التي تختارها فقط</li>
              </ul>
              <button type="button" className="mcc-btn-connect" onClick={startOAuth} disabled={actionLoading}>
                {actionLoading ? (
                  <><div className="mcc-btn-spinner" /> جارٍ التوجيه…</>
                ) : (
                  'ربط حساب Meta الآن'
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
                متصل
              </div>
              {info?.business_name && (
                <div className="mcc-account-info">
                  <span className="mcc-account-label">الحساب التجاري</span>
                  <span className="mcc-account-name">{info.business_name}</span>
                </div>
              )}
              <h3>اختر الكتالوج</h3>
              <p>اختر الكتالوج الذي تريد ربطه بمتجرك واستيراد منتجاته. تُتاح إعدادات المزامنة بعد اختيار الكتالوج.</p>

              {catalogsLoading && <div className="mcc-spinner" />}

              {!catalogsLoading && catalogError && (
                <div className="mcc-inline-error">{catalogError}</div>
              )}

              {!catalogsLoading && !catalogError && catalogs.length === 0 && (
                <div className="mcc-inline-error">لم يتم العثور على أي كتالوج لحسابك التجاري.</div>
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
                  {actionLoading ? 'جارٍ التأكيد…' : 'تأكيد الكتالوج'}
                </button>
                <button type="button" className="mcc-btn-danger" onClick={() => setShowDisconnectConfirm(true)} disabled={actionLoading}>
                  قطع الاتصال
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
                متصل
              </div>
              <div className="mcc-account-info">
                <span className="mcc-account-label">الكتالوج</span>
                <span className="mcc-account-name">{info.catalog_name}</span>
              </div>
              {info.catalog_id && (
                <div className="mcc-account-info">
                  <span className="mcc-account-label">معرّف الكتالوج</span>
                  <span className="mcc-account-name" dir="ltr">{info.catalog_id}</span>
                </div>
              )}
              {info.business_name && (
                <div className="mcc-account-info">
                  <span className="mcc-account-label">الحساب التجاري</span>
                  <span className="mcc-account-name">{info.business_name}</span>
                </div>
              )}
              <div className="mcc-actions">
                <button type="button" className="mcc-btn-primary" onClick={() => setShowChangeCatalogConfirm(true)} disabled={actionLoading}>
                  تغيير الكتالوج
                </button>
                <button type="button" className="mcc-btn-primary" onClick={startOAuth} disabled={actionLoading}>
                  إعادة الربط
                </button>
                <button type="button" className="mcc-btn-danger" onClick={() => setShowDisconnectConfirm(true)} disabled={actionLoading}>
                  قطع الاتصال
                </button>
              </div>

              {/* ── Import section ── */}
              <div className="mcc-import-section">
                <button
                  type="button"
                  className="mcc-import-header mcc-import-header--toggle"
                  onClick={() => setProductsPreviewOpen((v) => !v)}
                >
                  <span>معاينة المنتجات واستيرادها</span>
                  <svg className={`mcs-chevron${productsPreviewOpen ? ' mcs-chevron--up' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {productsPreviewOpen && productsLoading && (
                  <div className="mcc-state mcc-loading">
                    <div className="mcc-spinner" />
                    <p>جارٍ تحميل المنتجات من Meta…</p>
                  </div>
                )}

                {productsPreviewOpen && !productsLoading && productsError && (
                  <div className="mcc-inline-error">{productsError}</div>
                )}

                {productsPreviewOpen && !productsLoading && !productsError && products.length === 0 && (
                  <div className="mcc-inline-error">لا توجد منتجات في هذا الكتالوج.</div>
                )}

                {productsPreviewOpen && !productsLoading && products.length > 0 && (
                  <>
                    <div className="mcc-import-toolbar">
                      <button type="button" className="mcc-link-btn" onClick={selectAllAvailable}>
                        تحديد كل المنتجات الجديدة
                      </button>
                      <span className="mcc-selected-count">{selected.size} محدد</span>
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
                            <span className="mcc-product-imported-tag">تم استيراده مسبقاً</span>
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
                        استيراد المحدد ({selected.size})
                      </button>
                    )}

                    {importStatus === 'importing' && (
                      <div className="mcc-import-loading">
                        <div className="mcc-import-spinner" />
                        <p>جارٍ استيراد المنتجات…</p>
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
                          إغلاق
                        </button>
                      </div>
                    )}

                    {importStatus === 'error' && (
                      <div className="mcc-import-result mcc-import-result--error">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <div>
                          <p className="mcc-import-result-title">فشل الاستيراد</p>
                          <p className="mcc-import-result-msg">{importError}</p>
                        </div>
                        <button type="button" className="mcc-import-retry" onClick={() => setImportStatus('idle')}>
                          إعادة المحاولة
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Sync settings section ── */}
              <div className="mcs-settings-section">
                <h3 className="mcs-settings-title">إعدادات المزامنة</h3>

                {settingsLoading && !settingsDraft && (
                  <div className="mcc-state mcc-loading">
                    <div className="mcc-spinner" />
                    <p>جارٍ تحميل إعدادات المزامنة…</p>
                  </div>
                )}

                {settingsDraft && settings && (
                  <>
                    {/* ── Status summary ── */}
                    <div className="mcs-status-summary">
                      <h4>حالة المزامنة</h4>
                      <ul>
                        <li>
                          <span>المنتجات الجديدة من Meta إلى SouqLink</span>
                          <span className={`mcs-status-pill${settings.auto_import_new_products ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_import_new_products)}</span>
                        </li>
                        <li>
                          <span>تعديلات Meta إلى SouqLink</span>
                          <span className={`mcs-status-pill${settings.auto_sync_meta_updates_to_souqlink ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_sync_meta_updates_to_souqlink)}</span>
                        </li>
                        <li>
                          <span>المنتجات الجديدة من SouqLink إلى Meta</span>
                          <span className={`mcs-status-pill${settings.auto_export_new_products ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_export_new_products)}</span>
                        </li>
                        <li>
                          <span>تعديلات SouqLink إلى Meta</span>
                          <span className={`mcs-status-pill${settings.auto_sync_souqlink_updates_to_meta ? ' mcs-status-pill--on' : ''}`}>{onLabel(settings.auto_sync_souqlink_updates_to_meta)}</span>
                        </li>
                      </ul>
                      {settingsDirty && <p className="mcs-status-dirty-note">لديك تغييرات لم تُحفظ بعد.</p>}
                    </div>

                    {/* ── Meta Catalog → SouqLink ── */}
                    <div className="mcs-settings-group">
                      <h4>من Meta Catalog إلى SouqLink</h4>

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          جلب المنتجات الجديدة من Meta Catalog تلقائيًا
                          <span className="mcs-toggle-desc">عند إضافة منتج جديد إلى الكتالوج، سيتم استيراده إلى SouqLink تلقائيًا كمسودة.</span>
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
                          تحديث منتجات SouqLink عند تعديلها في Meta
                          <span className="mcs-toggle-desc">عند تعديل منتج مرتبط داخل Meta Catalog، يتم تطبيق التغييرات على المنتج المقابل داخل SouqLink. مثال: إذا تم تغيير سعر المنتج أو كميته في Meta Catalog، سيتم تحديث المنتج المقابل داخل SouqLink.</span>
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
                        <p className="mcs-manual-note">يمكنك جلب التحديثات يدويًا من صفحة المنتج.</p>
                      )}

                      <div className="mcs-future-note">
                        ⏳ لا يوجد بعد محرك يسحب التحديثات من Meta تلقائيًا — استيراد المنتجات الجديدة والتحديثات في هذا الاتجاه تُحفظ كتفضيلات فقط، وستعمل فعلياً في مرحلة لاحقة من التطوير.
                      </div>
                    </div>

                    {/* ── SouqLink → Meta Catalog ── */}
                    <div className="mcs-settings-group">
                      <h4>من SouqLink إلى Meta Catalog</h4>

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          نشر المنتجات الجديدة من SouqLink على Meta Catalog تلقائيًا
                          <span className="mcs-toggle-desc">عند إضافة منتج جديد ونشره داخل SouqLink، سيتم إنشاؤه أيضًا داخل Meta Catalog.</span>
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
                        <p className="mcs-rule-note">⚠️ لن يتم نشر المسودات تلقائيًا أبداً — يُنشر المنتج تلقائياً فقط بعد أن يصبح فعّالاً/منشوراً داخل SouqLink.</p>
                      )}

                      <label className="mcs-toggle-row">
                        <span className="mcs-toggle-text">
                          تحديث منتجات Meta عند تعديلها في SouqLink
                          <span className="mcs-toggle-desc">عند تعديل منتج مرتبط داخل SouqLink، يتم إرسال التغييرات إلى المنتج المقابل داخل Meta Catalog. مثال: إذا تم تغيير سعر المنتج أو كميته في SouqLink، سيتم تحديث المنتج المقابل داخل Meta Catalog.</span>
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
                        <p className="mcs-manual-note">يمكنك نشر المنتج أو إرسال تحديثاته يدويًا من صفحة المنتج.</p>
                      )}

                      <p className="mcs-manual-note">
                        ✓ هذا الاتجاه يعمل فعلياً عبر الموقع — عند حفظ منتج منشور يتم إرساله تلقائياً إلى Meta حسب الخيارات أعلاه. يمكنك أيضاً مزامنة كل منتجاتك المنشورة الآن يدوياً:
                      </p>
                      <div className="mcs-settings-actions">
                        <button type="button" className="mcc-btn-primary" onClick={runManualSync} disabled={manualSyncing}>
                          {manualSyncing ? 'جارٍ المزامنة…' : 'مزامنة جميع المنتجات الآن'}
                        </button>
                      </div>
                      {manualSyncResult && (
                        <div className="mcs-settings-saved">
                          ✓ تمت مزامنة {manualSyncResult.synced} منتج في {manualSyncResult.batches} دفعة.
                        </div>
                      )}
                      {manualSyncError && <div className="mcc-inline-error">{manualSyncError}</div>}
                    </div>

                    {showTwoWayWarning && (
                      <div className="mcs-warning-note">
                        ⚠️ تفعيل التحديث التلقائي في الاتجاهين قد يؤدي إلى تعارض إذا تم تعديل المنتج في Meta وSouqLink في الوقت نفسه.
                      </div>
                    )}

                    {settingsError && <div className="mcc-inline-error">{settingsError}</div>}
                    {settingsSaved && (
                      <div className="mcs-settings-saved">
                        ✓ تم حفظ إعدادات المزامنة بنجاح
                        {settings.settings_updated_at && ` — آخر تحديث: ${new Date(settings.settings_updated_at).toLocaleString('ar-EG-u-nu-latn')}`}
                      </div>
                    )}
                    {settingsSaved && inboundAutomaticEnabled && (
                      <div className="mcs-future-note">
                        تم حفظ إعدادات الاتجاه الوارد (Meta → SouqLink)، لكن محرك المزامنة التلقائية لهذا الاتجاه سيتم تنفيذه في المرحلة التالية. اتجاه SouqLink → Meta يعمل فعلياً بالفعل.
                      </div>
                    )}

                    <div className="mcs-settings-actions">
                      <button type="button" className="mcc-btn-primary mcs-settings-save-btn" onClick={saveSettings} disabled={settingsSaving || !settingsDirty}>
                        {settingsSaving ? 'جارٍ الحفظ…' : 'حفظ إعدادات المزامنة'}
                      </button>
                      <button type="button" className="mcc-btn-danger" onClick={cancelSettingsDraft} disabled={settingsSaving || !settingsDirty}>
                        إلغاء التغييرات
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="mcc-state mcc-error">
              <p>حدث خطأ في التحقق. تأكد من تسجيل الدخول وأعد المحاولة.</p>
              <button type="button" className="mcc-btn-primary" onClick={fetchStatus}>إعادة المحاولة</button>
            </div>
          )}
        </div>
      )}

      {showDisconnectConfirm && (
        <div className="mcs-confirm-overlay" onClick={() => setShowDisconnectConfirm(false)}>
          <div className="mcs-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>تأكيد قطع الاتصال</h3>
            <p>سيتم قطع اتصال حساب Meta عن متجرك. لن يتم حذف المنتجات التي تم استيرادها مسبقاً، ولن تتم إزالة شارة "مستورد من Meta" الخاصة بها، ولن يتم حذف أي شيء من كتالوج Meta نفسه.</p>
            <div className="mcs-confirm-actions">
              <button type="button" className="mcc-btn-danger" onClick={() => { setShowDisconnectConfirm(false); disconnect(); }}>
                تأكيد قطع الاتصال
              </button>
              <button type="button" className="mcc-btn-primary" onClick={() => setShowDisconnectConfirm(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangeCatalogConfirm && (
        <div className="mcs-confirm-overlay" onClick={() => setShowChangeCatalogConfirm(false)}>
          <div className="mcs-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>تغيير الكتالوج</h3>
            <p>تغيير الكتالوج لن يحذف أو ينقل تلقائياً المنتجات التي تم استيرادها مسبقاً من الكتالوج الحالي. هل تريد المتابعة؟</p>
            <div className="mcs-confirm-actions">
              <button type="button" className="mcc-btn-danger" onClick={confirmChangeCatalog}>
                متابعة وتغيير الكتالوج
              </button>
              <button type="button" className="mcc-btn-primary" onClick={() => setShowChangeCatalogConfirm(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
