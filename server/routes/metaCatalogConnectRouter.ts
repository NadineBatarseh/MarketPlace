import express from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import crypto from 'crypto';

const router = express.Router();

const GRAPH_API_VERSION = 'v19.0';
const SCOPES = ['catalog_management', 'business_management'].join(',');

function getRedirectUri(): string {
  return (
    process.env.META_CATALOG_REDIRECT_URI ||
    'http://localhost:4000/auth/meta-catalog/callback'
  );
}

/** Store Settings → Integrations → Meta Catalog is the single home for this flow now. */
function getSettingsReturnUrl(params: Record<string, string> = {}): string {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const search = new URLSearchParams({
    page: 'shopSettings',
    section: 'integrations',
    integration: 'meta',
    ...params,
  });
  return `${frontendUrl}/merchant-dashboard?${search.toString()}`;
}

const SYNC_FIELD_KEYS = ['price', 'quantity', 'availability', 'details', 'images'] as const;
type SyncFieldKey = typeof SYNC_FIELD_KEYS[number];
type SyncFields = Record<SyncFieldKey, boolean>;

const DEFAULT_SYNC_FIELDS: SyncFields = {
  price: true,
  quantity: true,
  availability: true,
  details: false,
  images: false,
};

const BOOLEAN_SETTING_KEYS = [
  'auto_import_new_products',
  'auto_export_new_products',
  'auto_sync_meta_updates_to_souqlink',
  'auto_sync_souqlink_updates_to_meta',
] as const;
type BooleanSettingKey = typeof BOOLEAN_SETTING_KEYS[number];

const SETTINGS_BODY_KEYS = [...BOOLEAN_SETTING_KEYS, 'inbound_sync_fields', 'outbound_sync_fields'] as const;

const FIELD_LABELS_AR: Record<SyncFieldKey, string> = {
  price: 'السعر',
  quantity: 'الكمية',
  availability: 'حالة التوفر',
  details: 'الاسم والوصف',
  images: 'الصور',
};

/** Merges a partial, untrusted sync-fields object onto known defaults — rejects unknown keys / non-boolean values. */
function parseSyncFields(
  value: unknown,
  base: SyncFields,
  label: string
): { ok: true; fields: SyncFields } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `قيمة "${label}" يجب أن تكون كائناً يحتوي حقول المزامنة.` };
  }
  const input = value as Record<string, unknown>;
  const merged: SyncFields = { ...base };
  for (const key of Object.keys(input)) {
    if (!SYNC_FIELD_KEYS.includes(key as SyncFieldKey)) {
      return { ok: false, error: `الحقل "${key}" غير مدعوم ضمن "${label}".` };
    }
    const v = input[key];
    if (typeof v !== 'boolean') {
      return { ok: false, error: `قيمة "${FIELD_LABELS_AR[key as SyncFieldKey]}" ضمن "${label}" يجب أن تكون true أو false.` };
    }
    merged[key as SyncFieldKey] = v;
  }
  return { ok: true, fields: merged };
}

async function getUserFromBearer(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function resolveShopId(userId: string): Promise<string | null> {
  const { data: shop } = await supabase
    .from('shops')
    .select('shop_id, merchants!inner(user_id)')
    .eq('merchants.user_id', userId)
    .maybeSingle();
  return (shop?.shop_id as string | undefined) ?? null;
}

interface DiscoveredCatalog {
  catalog_id: string;
  catalog_name: string;
  business_id: string;
  business_name: string;
}

/** Discovers every product catalog owned by businesses the access token can see. */
async function discoverCatalogs(accessToken: string): Promise<DiscoveredCatalog[]> {
  const catalogs: DiscoveredCatalog[] = [];

  const bizRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/businesses?access_token=${encodeURIComponent(accessToken)}`
  );
  const bizData: any = await bizRes.json();
  if (bizData.error) {
    console.error('[meta-catalog] /me/businesses error:', bizData.error.message);
    return catalogs;
  }

  for (const business of bizData.data ?? []) {
    try {
      const catRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${business.id}/owned_product_catalogs?access_token=${encodeURIComponent(accessToken)}`
      );
      const catData: any = await catRes.json();
      if (catData.error) {
        console.warn(`[meta-catalog] owned_product_catalogs error for business ${business.id}:`, catData.error.message);
        continue;
      }
      for (const catalog of catData.data ?? []) {
        catalogs.push({
          catalog_id: catalog.id,
          catalog_name: catalog.name ?? catalog.id,
          business_id: business.id,
          business_name: business.name ?? business.id,
        });
      }
    } catch (err: any) {
      console.warn(`[meta-catalog] catalog discovery failed for business ${business.id}:`, err.message);
    }
  }

  return catalogs;
}

/**
 * POST /api/meta-catalog/init
 * Frontend calls this to get a short state token, then redirects to the returned auth_url.
 */
router.post('/init', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: 'Missing Authorization header' });

  const sbAuthToken = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(sbAuthToken);
  if (error || !user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const stateToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: insertError } = await supabase
    .from('meta_oauth_states')
    .insert({ state_token: stateToken, sb_auth_token: sbAuthToken, expires_at: expiresAt });
  if (insertError) return res.status(500).json({ ok: false, error: 'Failed to create state token' });

  const authUrl =
    `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth` +
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(getRedirectUri())}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code` +
    `&state=${stateToken}`;

  return res.json({ ok: true, auth_url: authUrl });
});

/**
 * GET /auth/meta-catalog/callback
 * Facebook redirects here after the merchant approves catalog permissions.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state: stateToken } = req.query as { code?: string; state?: string };

  if (!code) return res.redirect(getSettingsReturnUrl({ error: 'رمز التفويض مفقود. حاول الربط مرة أخرى.' }));
  if (!stateToken) return res.redirect(getSettingsReturnUrl({ error: 'رمز الحالة (state) مفقود. حاول الربط مرة أخرى.' }));

  const { data: pending, error: stateError } = await supabase
    .from('meta_oauth_states')
    .select('sb_auth_token, expires_at')
    .eq('state_token', stateToken)
    .maybeSingle();

  if (stateError || !pending) {
    return res.redirect(getSettingsReturnUrl({ error: 'انتهت صلاحية محاولة الربط أو أنها غير صالحة. حاول مرة أخرى.' }));
  }
  if (new Date(pending.expires_at) < new Date()) {
    await supabase.from('meta_oauth_states').delete().eq('state_token', stateToken);
    return res.redirect(getSettingsReturnUrl({ error: 'انتهت صلاحية محاولة الربط. حاول مرة أخرى.' }));
  }

  await supabase.from('meta_oauth_states').delete().eq('state_token', stateToken);

  const sbAuthToken = pending.sb_auth_token;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser(sbAuthToken);
    if (userError || !user) return res.redirect(getSettingsReturnUrl({ error: 'انتهت جلستك. سجّل الدخول وحاول الربط مرة أخرى.' }));

    const redirectUri = getRedirectUri();

    // 1. Exchange code for short-lived user access token
    const shortRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri: redirectUri,
        code,
      })
    );
    const shortData: any = await shortRes.json();

    if (!shortData.access_token) {
      const msg = shortData.error?.message ?? 'unknown error';
      console.error('[meta-catalog/callback] short-lived token error:', msg);
      return res.redirect(getSettingsReturnUrl({ error: `فشل الحصول على رمز الوصول من Meta: ${msg}` }));
    }

    // 2. Exchange for long-lived token (~60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: shortData.access_token,
      })
    );
    const longData: any = await longRes.json();
    const accessToken: string = longData.access_token ?? shortData.access_token;

    // 3. Discover catalogs reachable from this token
    const catalogs = await discoverCatalogs(accessToken);
    const single = catalogs.length === 1 ? catalogs[0] : null;

    // 4. Save connection (auto-select catalog only when exactly one was found)
    const { error: saveError } = await supabase
      .from('meta_catalog_connections')
      .upsert(
        {
          user_id: user.id,
          access_token: accessToken,
          business_id: single?.business_id ?? null,
          business_name: single?.business_name ?? null,
          catalog_id: single?.catalog_id ?? null,
          catalog_name: single?.catalog_name ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (saveError) {
      console.error('[meta-catalog/callback] DB save error:', saveError.message);
      return res.redirect(getSettingsReturnUrl({ error: `فشل حفظ بيانات الاتصال: ${saveError.message}` }));
    }

    console.log(`[meta-catalog/callback] connected ${catalogs.length} catalog(s) for user ${user.id}`);

    res.redirect(getSettingsReturnUrl({ connected: 'true' }));
  } catch (err: any) {
    console.error('[meta-catalog/callback] unexpected error:', err.message);
    res.redirect(getSettingsReturnUrl({ error: `خطأ في السيرفر: ${err.message}` }));
  }
});

/**
 * GET /api/meta-catalog/status
 */
router.get('/status', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { data } = await supabase
    .from('meta_catalog_connections')
    .select('business_id, business_name, catalog_id, catalog_name, created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return res.json({
    ok: true,
    connected: !!data,
    business_name: data?.business_name ?? null,
    catalog_id: data?.catalog_id ?? null,
    catalog_name: data?.catalog_name ?? null,
    connected_at: data?.created_at ?? null,
  });
});

/**
 * GET /api/meta-catalog/catalogs
 * Lists catalogs available to the connected business so the merchant can pick one.
 */
router.get('/catalogs', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { data: conn } = await supabase
    .from('meta_catalog_connections')
    .select('access_token')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!conn) {
    return res.status(400).json({ ok: false, error: 'لم يتم ربط حساب Meta بعد.', code: 'not_connected' });
  }

  const catalogs = await discoverCatalogs(conn.access_token);
  return res.json({ ok: true, catalogs });
});

/**
 * POST /api/meta-catalog/select-catalog
 * Body: { catalog_id, catalog_name, business_id?, business_name? }
 */
router.post('/select-catalog', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { catalog_id, catalog_name, business_id, business_name } = req.body as {
    catalog_id?: string;
    catalog_name?: string;
    business_id?: string;
    business_name?: string;
  };
  if (!catalog_id) return res.status(400).json({ ok: false, error: 'catalog_id is required' });

  const { error } = await supabase
    .from('meta_catalog_connections')
    .update({
      catalog_id,
      catalog_name: catalog_name ?? catalog_id,
      business_id: business_id ?? null,
      business_name: business_name ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

const SETTINGS_COLUMNS =
  'auto_import_new_products, auto_export_new_products, auto_sync_meta_updates_to_souqlink, auto_sync_souqlink_updates_to_meta, inbound_sync_fields, outbound_sync_fields, settings_updated_at';

/**
 * GET /api/meta-catalog/settings
 * Returns this merchant's detailed, per-direction synchronization preferences.
 * These are preferences only — no automatic sync/publish engine reads them
 * yet (Phase 2+); see the "is this live yet" note in the PUT handler below.
 */
router.get('/settings', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { data, error } = await supabase
    .from('meta_catalog_connections')
    .select(SETTINGS_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[meta-catalog/settings GET] query failed (check that add_meta_catalog_detailed_sync_controls.sql has been run):', error.message);
    return res.status(500).json({ ok: false, error: `تعذّر تحميل إعدادات المزامنة: ${error.message}` });
  }

  return res.json({
    ok: true,
    auto_import_new_products: data?.auto_import_new_products ?? false,
    auto_export_new_products: data?.auto_export_new_products ?? false,
    auto_sync_meta_updates_to_souqlink: data?.auto_sync_meta_updates_to_souqlink ?? false,
    auto_sync_souqlink_updates_to_meta: data?.auto_sync_souqlink_updates_to_meta ?? false,
    inbound_sync_fields: { ...DEFAULT_SYNC_FIELDS, ...(data?.inbound_sync_fields ?? {}) },
    outbound_sync_fields: { ...DEFAULT_SYNC_FIELDS, ...(data?.outbound_sync_fields ?? {}) },
    settings_updated_at: data?.settings_updated_at ?? null,
  });
});

/**
 * PUT /api/meta-catalog/settings
 * Body (all keys optional, unknown keys rejected):
 * {
 *   auto_import_new_products, auto_export_new_products,
 *   auto_sync_meta_updates_to_souqlink, auto_sync_souqlink_updates_to_meta,
 *   inbound_sync_fields: { price, quantity, availability, details, images },
 *   outbound_sync_fields: { price, quantity, availability, details, images },
 * }
 *
 * Only ever reads/writes the row for the authenticated merchant — user_id and
 * shop_id are never accepted from the request body. Saving these settings
 * does NOT start any automatic synchronization — no engine reads these
 * columns yet; they are persisted preferences for a later phase.
 */
router.put('/settings', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { data: existing, error: fetchError } = await supabase
    .from('meta_catalog_connections')
    .select(SETTINGS_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[meta-catalog/settings PUT] query failed (check that add_meta_catalog_detailed_sync_controls.sql has been run):', fetchError.message);
    return res.status(500).json({ ok: false, error: `تعذّر تحميل بيانات الاتصال: ${fetchError.message}` });
  }

  if (!existing) {
    return res.status(400).json({ ok: false, error: 'لم يتم ربط حساب Meta بعد.', code: 'not_connected' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  const unknownKeys = Object.keys(body).filter((k) => !(SETTINGS_BODY_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length > 0) {
    return res.status(400).json({ ok: false, error: `حقول غير مدعومة: ${unknownKeys.join(', ')}` });
  }

  const booleanSettings: Record<BooleanSettingKey, boolean> = {
    auto_import_new_products: existing.auto_import_new_products ?? false,
    auto_export_new_products: existing.auto_export_new_products ?? false,
    auto_sync_meta_updates_to_souqlink: existing.auto_sync_meta_updates_to_souqlink ?? false,
    auto_sync_souqlink_updates_to_meta: existing.auto_sync_souqlink_updates_to_meta ?? false,
  };
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (key in body) {
      const v = body[key];
      if (typeof v !== 'boolean') {
        return res.status(400).json({ ok: false, error: `قيمة "${key}" يجب أن تكون true أو false.` });
      }
      booleanSettings[key] = v;
    }
  }

  let inbound_sync_fields: SyncFields = { ...DEFAULT_SYNC_FIELDS, ...(existing.inbound_sync_fields ?? {}) };
  if ('inbound_sync_fields' in body) {
    const parsed = parseSyncFields(body.inbound_sync_fields, inbound_sync_fields, 'inbound_sync_fields');
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
    inbound_sync_fields = parsed.fields;
  }

  let outbound_sync_fields: SyncFields = { ...DEFAULT_SYNC_FIELDS, ...(existing.outbound_sync_fields ?? {}) };
  if ('outbound_sync_fields' in body) {
    const parsed = parseSyncFields(body.outbound_sync_fields, outbound_sync_fields, 'outbound_sync_fields');
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
    outbound_sync_fields = parsed.fields;
  }

  const settings_updated_at = new Date().toISOString();
  const { error } = await supabase
    .from('meta_catalog_connections')
    .update({
      ...booleanSettings,
      inbound_sync_fields,
      outbound_sync_fields,
      settings_updated_at,
    })
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ ok: false, error: `تعذّر حفظ إعدادات المزامنة: ${error.message}` });

  return res.json({
    ok: true,
    ...booleanSettings,
    inbound_sync_fields,
    outbound_sync_fields,
    settings_updated_at,
  });
});

/**
 * DELETE /api/meta-catalog/disconnect
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { error } = await supabase
    .from('meta_catalog_connections')
    .delete()
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

/**
 * GET /api/meta-catalog/products/preview
 * Fetches products from the connected catalog and flags ones already imported.
 */
router.get('/products/preview', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const shopId = await resolveShopId(user.id);
  if (!shopId) return res.status(403).json({ ok: false, error: 'No shop is associated with this account' });

  const { data: conn } = await supabase
    .from('meta_catalog_connections')
    .select('access_token, catalog_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!conn?.catalog_id) {
    return res.status(400).json({ ok: false, error: 'لم يتم اختيار كتالوج بعد.' });
  }

  const after = (req.query.after as string | undefined) ?? undefined;
  const params = new URLSearchParams({
    access_token: conn.access_token,
    fields: 'id,retailer_id,name,description,price,currency,image_url,availability,brand',
    limit: '25',
  });
  if (after) params.set('after', after);

  const metaRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${conn.catalog_id}/products?${params.toString()}`
  );
  const metaData: any = await metaRes.json();

  if (metaData.error) {
    return res.status(400).json({ ok: false, error: metaData.error.message });
  }

  const items: any[] = metaData.data ?? [];
  const metaIds = items.map((p) => p.id);
  // Products pushed SouqLink → Meta use their own SouqLink id as the Meta
  // retailer_id (see buildBatchRequest in metaCatalogAPISync.ts), so an item
  // can also already be "ours" if its retailer_id matches an existing
  // product id for this shop — even though meta_product_id was never
  // written back for outbound-created items.
  const retailerIds = items.map((p) => p.retailer_id).filter((id): id is string => !!id);

  const [{ data: byMetaId }, { data: byRetailerId }] = await Promise.all([
    supabase
      .from('products')
      .select('meta_product_id')
      .eq('shop_id', shopId)
      .in('meta_product_id', metaIds.length > 0 ? metaIds : ['__none__']),
    supabase
      .from('products')
      .select('id')
      .eq('shop_id', shopId)
      .in('id', retailerIds.length > 0 ? retailerIds : ['__none__']),
  ]);
  const importedMetaIds = new Set((byMetaId ?? []).map((r: { meta_product_id: string }) => r.meta_product_id));
  const linkedRetailerIds = new Set((byRetailerId ?? []).map((r: { id: string }) => r.id));

  const products = items.map((p) => ({
    meta_product_id: p.id,
    name: p.name,
    description: p.description ?? null,
    price: p.price ?? null,
    currency: p.currency ?? null,
    image_url: p.image_url ?? null,
    availability: p.availability ?? null,
    brand: p.brand ?? null,
    already_imported: importedMetaIds.has(p.id) || (!!p.retailer_id && linkedRetailerIds.has(p.retailer_id)),
  }));

  return res.json({
    ok: true,
    products,
    next_cursor: metaData.paging?.cursors?.after ?? null,
    has_next: !!metaData.paging?.next,
  });
});

/**
 * POST /api/meta-catalog/import
 * Body: { product_ids: string[] }  — Meta catalog product ids to import.
 */
router.post('/import', async (req: Request, res: Response) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const shopId = await resolveShopId(user.id);
  if (!shopId) return res.status(403).json({ ok: false, error: 'No shop is associated with this account' });

  const { product_ids } = req.body as { product_ids?: string[] };
  if (!product_ids?.length) {
    return res.status(400).json({ ok: false, error: 'product_ids is required' });
  }

  const { data: conn } = await supabase
    .from('meta_catalog_connections')
    .select('access_token, catalog_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!conn?.catalog_id) {
    return res.status(400).json({ ok: false, error: 'لم يتم اختيار كتالوج بعد.' });
  }

  // Defense in depth: skip ids already imported for this shop, even if the
  // preview screen's snapshot was stale.
  const { data: existingRows } = await supabase
    .from('products')
    .select('meta_product_id')
    .eq('shop_id', shopId)
    .in('meta_product_id', product_ids);
  const alreadyImported = new Set((existingRows ?? []).map((r: { meta_product_id: string }) => r.meta_product_id));
  const idsToFetch = product_ids.filter((id) => !alreadyImported.has(id));

  if (idsToFetch.length === 0) {
    return res.json({ ok: true, count: 0, message: 'تم استيراد جميع المنتجات المحددة مسبقاً.' });
  }

  const fetched = await Promise.all(
    idsToFetch.map(async (metaId) => {
      const params = new URLSearchParams({
        access_token: conn.access_token,
        fields: 'id,name,description,price,currency,image_url,availability',
      });
      const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${metaId}?${params.toString()}`);
      const data: any = await r.json();
      if (data.error) {
        console.warn(`[meta-catalog/import] failed to fetch ${metaId}:`, data.error.message);
        return null;
      }
      return data;
    })
  );

  function parsePrice(raw: string | undefined): number | null {
    if (!raw) return null;
    const match = raw.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  }

  const rows = fetched
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      id: crypto.randomUUID(),
      shop_id: shopId,
      title: p.name,
      description: p.description ?? null,
      price: parsePrice(p.price),
      image_urls: p.image_url ? [p.image_url] : null,
      stock_Quantity: p.availability === 'out of stock' ? 0 : null,
      isPublish: false,
      meta_product_id: p.id,
      product_source: 'meta_import',
      meta_imported_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    return res.status(500).json({ ok: false, error: 'فشل جلب بيانات المنتجات من Meta.' });
  }

  const { error } = await supabase.from('products').insert(rows);
  if (error) {
    return res.status(500).json({ ok: false, error: `فشل حفظ المنتجات: ${error.message}` });
  }

  return res.json({
    ok: true,
    count: rows.length,
    message: `تم استيراد ${rows.length} منتج كمسودة بنجاح.`,
  });
});

export default router;
