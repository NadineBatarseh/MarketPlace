import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { validateProducts } from '../metaCatalog/metaCatalogAPIValidator.js';
import { syncProductsToMeta } from '../metaCatalog/metaCatalogAPISync.js';
import type { ProductSyncInput, MetaCurrency } from '../metaCatalog/metaCatalogAPITypes.js';

const router = Router();

/* ------------------------------------------------------------------ */
/*  Auth helper                                                         */
/*  Resolves the authenticated user's shop_id from a Bearer JWT.       */
/*  Same pattern as productUploadRouter.ts.                            */
/* ------------------------------------------------------------------ */
async function resolveShopId(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Authorization header is required (Bearer token)' });
    return null;
  }

  const token = authHeader.slice(7);
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session token' });
    return null;
  }

  const { data: shop, error: shopErr } = await supabase
    .from('shops')
    .select('shop_id, merchants!inner(user_id)')
    .eq('merchants.user_id', user.id)
    .maybeSingle();

  if (shopErr || !shop) {
    res.status(403).json({ ok: false, error: 'No shop is associated with this account' });
    return null;
  }

  return shop.shop_id as string;
}

/* ------------------------------------------------------------------ */
/*  POST /api/catalog/sync                                              */
/*                                                                      */
/*  Syncs ALL products for the authenticated merchant to Meta.          */
/*  Validates each product first and reports per-item failures.        */
/*                                                                      */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/*  Body (optional JSON):                                               */
/*    currency?:    'ILS' | 'JOD' | 'USD'   (default: 'ILS')          */
/*    product_ids?: string[]                 (sync a subset)            */
/* ------------------------------------------------------------------ */
router.post('/sync', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const { currency, product_ids } = req.body as {
    currency?: MetaCurrency;
    product_ids?: string[];
  };

  // Fetch products from Supabase
  let query = supabase
    .from('products')
    .select('id, meta_product_id, title, description, price, image_urls, stock_Quantity')
    .eq('shop_id', shop_id);

  if (product_ids?.length) {
    query = query.in('id', product_ids);
  }

  const { data: products, error: dbErr } = await query;

  if (dbErr) {
    return res.status(500).json({ ok: false, error: `Database error: ${dbErr.message}` });
  }

  if (!products?.length) {
    return res.status(200).json({ ok: true, message: 'No products found for this shop.', synced: 0 });
  }

  // Attach the currency override (or default to ILS)
  const syncInputs: ProductSyncInput[] = (products as any[]).map((p) => ({
    ...p,
    currency: currency ?? 'ILS',
  }));

  // Validate before sending
  const { valid, failures } = validateProducts(syncInputs);

  if (valid.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'All products failed validation.',
      validationFailures: failures,
    });
  }

  // Push to Meta
  const results = await syncProductsToMeta({ products: valid });

  const allOk = results.every((r) => r.ok);
  const totalSynced = results.reduce((sum, r) => sum + (r.itemCount ?? 0), 0);
  const errors = results.filter((r) => !r.ok).map((r) => r.error);

  return res.status(allOk ? 200 : 207).json({
    ok: allOk,
    synced: totalSynced,
    batches: results.length,
    validationFailures: failures.length > 0 ? failures : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/* ------------------------------------------------------------------ */
/*  POST /api/catalog/product/:id/sync                                  */
/*                                                                      */
/*  Syncs a single product to Meta (CREATE or UPDATE).                  */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/*  Body (optional JSON):                                               */
/*    currency?: 'ILS' | 'JOD' | 'USD'  (default: 'ILS')              */
/* ------------------------------------------------------------------ */
router.post('/product/:id/sync', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const productId = req.params.id;
  const { currency } = req.body as { currency?: MetaCurrency };

  const { data: product, error: dbErr } = await supabase
    .from('products')
    .select('id, meta_product_id, title, description, price, image_urls, stock_Quantity')
    .eq('id', productId)
    .eq('shop_id', shop_id)
    .maybeSingle();

  if (dbErr) {
    return res.status(500).json({ ok: false, error: dbErr.message });
  }

  if (!product) {
    return res
      .status(404)
      .json({ ok: false, error: 'Product not found or does not belong to this shop.' });
  }

  const syncInput: ProductSyncInput = {
    ...(product as any),
    currency: currency ?? 'ILS',
  };

  const { valid, failures } = validateProducts([syncInput]);

  if (failures.length > 0) {
    return res.status(400).json({ ok: false, validationFailures: failures });
  }

  const [result] = await syncProductsToMeta({ products: valid });

  return res.status(result.ok ? 200 : 500).json(result);
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/catalog/product/:id                                     */
/*                                                                      */
/*  Removes a single product from the Meta catalog.                     */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/* ------------------------------------------------------------------ */
router.delete('/product/:id', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const productId = req.params.id;

  const { data: product, error: dbErr } = await supabase
    .from('products')
    .select('id, meta_product_id')
    .eq('id', productId)
    .eq('shop_id', shop_id)
    .maybeSingle();

  if (dbErr) {
    return res.status(500).json({ ok: false, error: dbErr.message });
  }

  if (!product) {
    return res
      .status(404)
      .json({ ok: false, error: 'Product not found or does not belong to this shop.' });
  }

  const deleteInput: ProductSyncInput = {
    id: (product as any).id,
    meta_product_id: (product as any).meta_product_id ?? undefined,
    title: '', // not used for DELETE
    deleted: true,
  };

  const [result] = await syncProductsToMeta({ products: [deleteInput] });

  return res.status(result.ok ? 200 : 500).json(result);
});

export default router;
