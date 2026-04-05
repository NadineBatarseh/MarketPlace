import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { uploadImage } from '../uploadImage.js';

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
/*  Creates a product in Supabase. Meta sync is handled automatically  */
/*  by the Supabase DB webhook (supabaseProductWebhookRouter).         */
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

  return res.status(201).json({ ok: true, product });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/products/:id                                            */
/*                                                                      */
/*  Deletes a product from Supabase. Meta removal is handled           */
/*  automatically by the Supabase DB webhook.                          */
/*                                                                      */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/* ------------------------------------------------------------------ */
router.delete('/:id', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const productId = req.params.id;

  const { error: fetchErr, data: product } = await supabase
    .from('products')
    .select('id')
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

  return res.status(200).json({ ok: true });
});

export default router;
