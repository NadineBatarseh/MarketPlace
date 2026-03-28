import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { uploadImage } from '../uploadImage.js';
import { validateProducts } from '../metaCatalog/metaCatalogAPIValidator.js';
import { syncProductsToMeta } from '../metaCatalog/metaCatalogAPISync.js';
import type { ProductSyncInput } from '../metaCatalog/metaCatalogAPITypes.js';

const router = Router();

/* ------------------------------------------------------------------ */
/*  Auth helper — resolves the authenticated user's shop_id            */
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
    .select('shop_id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (shopErr || !shop) {
    res.status(403).json({ ok: false, error: 'No shop is associated with this account' });
    return null;
  }

  return shop.shop_id as string;
}

/* ------------------------------------------------------------------ */
/*  POST /api/products                                                  */
/*                                                                      */
/*  Creates a product in Supabase then immediately syncs it to Meta.   */
/*  A Meta sync failure does NOT roll back the Supabase insert —       */
/*  the product is saved either way; the metaSync field reports status.*/
/*                                                                      */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/*  Body:  { title, description?, price, stock_Quantity?, image_urls? }*/
/* ------------------------------------------------------------------ */
router.post('/', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const { title, description, price, stock_Quantity, image_urls } = req.body as {
    title: string;
    description?: string;
    price: number;
    stock_Quantity?: number;
    image_urls?: string[];
  };

  if (!title?.trim()) {
    return res.status(400).json({ ok: false, error: '"title" is required' });
  }
  if (price == null || isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ ok: false, error: '"price" must be a non-negative number' });
  }

  const id = randomUUID();

  // Upload any base64 data URLs to Supabase Storage so Meta gets a real HTTPS URL
  const resolvedImageUrls: string[] | null = image_urls
    ? await Promise.all(
        image_urls.map(async (url, i) => {
          if (url.startsWith('data:')) {
            const stored = await uploadImage(url, id, i);
            return stored ?? url;
          }
          return url;
        })
      )
    : null;

  const { data: product, error: dbErr } = await supabase
    .from('products')
    .insert({
      id,
      shop_id,
      title: title.trim(),
      description: description?.trim() || null,
      price: Number(price),
      stock_Quantity: stock_Quantity ?? null,
      image_urls: resolvedImageUrls,
    })
    .select()
    .single();

  if (dbErr || !product) {
    return res.status(500).json({ ok: false, error: `Database error: ${dbErr?.message ?? 'unknown'}` });
  }

  // Sync to Meta — non-blocking failure
  const syncInput: ProductSyncInput = {
    id: (product as any).id,
    meta_product_id: (product as any).meta_product_id ?? null,
    title: (product as any).title,
    description: (product as any).description,
    price: (product as any).price,
    stock_Quantity: (product as any).stock_Quantity,
    image_urls: (product as any).image_urls,
    currency: 'ILS',
  };

  const { valid, failures } = validateProducts([syncInput]);
  let metaSync: { ok: boolean; handles?: string[]; error?: string } = { ok: true };

  if (valid.length > 0) {
    const [result] = await syncProductsToMeta({ products: valid });
    metaSync = { ok: result.ok, handles: result.handles, error: result.error };
  } else {
    metaSync = { ok: false, error: failures[0]?.errors.join(', ') };
  }

  if (metaSync.ok) {
    await supabase.from('products').update({ meta_product_id: id }).eq('id', id);
  }

  return res.status(201).json({ ok: true, product, metaSync });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/products/:id                                            */
/*                                                                      */
/*  Deletes a product from Supabase then removes it from Meta catalog. */
/*  A Meta removal failure does NOT restore the Supabase row.         */
/*                                                                      */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/* ------------------------------------------------------------------ */
router.delete('/:id', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const productId = req.params.id;

  // Fetch before deleting so we have meta_product_id for the Meta removal
  const { data: product, error: fetchErr } = await supabase
    .from('products')
    .select('id, meta_product_id')
    .eq('id', productId)
    .eq('shop_id', shop_id)
    .maybeSingle();

  if (fetchErr) {
    return res.status(500).json({ ok: false, error: fetchErr.message });
  }

  if (!product) {
    return res.status(404).json({ ok: false, error: 'Product not found or does not belong to this shop.' });
  }

  const { error: deleteErr } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
    .eq('shop_id', shop_id);

  if (deleteErr) {
    return res.status(500).json({ ok: false, error: `Database error: ${deleteErr.message}` });
  }

  // Remove from Meta catalog — non-blocking failure
  const deleteInput: ProductSyncInput = {
    id: (product as any).id,
    meta_product_id: (product as any).meta_product_id ?? null,
    title: '',
    deleted: true,
  };

  const [metaResult] = await syncProductsToMeta({ products: [deleteInput] });

  return res.status(200).json({
    ok: true,
    metaSync: { ok: metaResult.ok, error: metaResult.error },
  });
});

export default router;
