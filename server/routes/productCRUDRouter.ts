import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { estimateCapacityUnits, clampCapacity } from '../services/capacityClassifier.js';
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
    ? (await Promise.all(
        image_urls.map(async (url, i) => {
          if (url.startsWith('data:')) {
            return await uploadImage(url, id, i); // null if upload fails — filtered out below
          }
          return url;
        })
      )).filter((url: string | null): url is string => url !== null)
    : null;

  // Estimate capacity before insert so it's stored atomically with the product
  const capacity_units = await estimateCapacityUnits({
    title: title.trim(),
    description: description?.trim() ?? null,
  });

  const { data: product, error: dbErr } = await supabase
    .from('products')
    .insert({
      id,
      shop_id,
      meta_product_id: id,
      title: title.trim(),
      description: description?.trim() || null,
      price: Number(price),
      stock_Quantity: stock_Quantity ?? null,
      image_urls: resolvedImageUrls,
      capacity_units,
    })
    .select()
    .single();

  if (dbErr || !product) {
    return res.status(500).json({ ok: false, error: `Database error: ${dbErr?.message ?? 'unknown'}` });
  }

  return res.status(201).json({ ok: true, product });
});

/* ------------------------------------------------------------------ */
/*  POST /api/products/:id/publish                                      */
/*                                                                      */
/*  Publishes a draft product:                                          */
/*    1. Uploads each image_url (Instagram CDN) to Supabase Storage    */
/*       at product-images/{id}/0.jpg, 1.jpg, …                        */
/*    2. Updates title/description/price/stock_Quantity + isPublish    */
/*                                                                      */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/*  Body:  { title, description?, price, stock_Quantity }              */
/* ------------------------------------------------------------------ */
router.post('/:id/publish', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const productId = req.params.id;
  const { title, description, price, stock_Quantity } = req.body as {
    title: string;
    description?: string;
    price: number;
    stock_Quantity: number;
  };

  // Verify the draft exists and belongs to this shop
  const { data: draft, error: fetchErr } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('shop_id', shop_id)
    .eq('isPublish', false)
    .maybeSingle();

  if (fetchErr) {
    return res.status(500).json({ ok: false, error: fetchErr.message });
  }
  if (!draft) {
    return res.status(404).json({ ok: false, error: 'Draft not found or does not belong to this shop.' });
  }

  // Images were already uploaded to Supabase Storage at import time — just publish
  const { error: updateErr } = await supabase
    .from('products')
    .update({
      title: title.trim(),
      description: description?.trim() || null,
      price: Number(price),
      stock_Quantity: Number(stock_Quantity),
      isPublish: true,
    })
    .eq('id', productId)
    .eq('shop_id', shop_id);

  if (updateErr) {
    return res.status(500).json({ ok: false, error: `Database error: ${updateErr.message}` });
  }

  return res.status(200).json({ ok: true });
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

  // Remove product from carts and favorites before deleting (FK constraints)
  await supabase.from('cart_items').delete().eq('product_id', productId);
  await supabase.from('favorite_items').delete().eq('product_id', productId);

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

/* ------------------------------------------------------------------ */
/*  POST /api/products/:id/capacity                                     */
/*                                                                      */
/*  Classify (or manually override) capacity_units for a product.      */
/*                                                                      */
/*  Body (optional):                                                    */
/*    { capacity_units: 1–5 }  → manual override, skips AI            */
/*    {}  or no body           → auto-classify via AI + fallback       */
/*                                                                      */
/*  Auth:  Authorization: Bearer <supabase-access-token>               */
/* ------------------------------------------------------------------ */
router.post('/:id/capacity', async (req: Request, res: Response) => {
  const shop_id = await resolveShopId(req, res);
  if (!shop_id) return;

  const productId = req.params.id;

  const { data: product, error: fetchErr } = await supabase
    .from('products')
    .select('id, title, description')
    .eq('id', productId)
    .eq('shop_id', shop_id)
    .maybeSingle();

  if (fetchErr || !product) {
    return res.status(404).json({ ok: false, error: 'Product not found or does not belong to this shop.' });
  }

  let capacity_units: number;

  const override = req.body?.capacity_units;
  if (override !== undefined) {
    // Manual override — validate and clamp
    const parsed = Number(override);
    if (isNaN(parsed)) {
      return res.status(400).json({ ok: false, error: 'capacity_units must be a number between 1 and 5' });
    }
    capacity_units = clampCapacity(parsed);
  } else {
    // Auto-classify
    capacity_units = await estimateCapacityUnits({
      title: product.title,
      description: product.description,
    });
  }

  const { error: updateErr } = await supabase
    .from('products')
    .update({ capacity_units })
    .eq('id', productId)
    .eq('shop_id', shop_id);

  if (updateErr) {
    return res.status(500).json({ ok: false, error: `Database error: ${updateErr.message}` });
  }

  return res.json({ ok: true, capacity_units });
});

/* ------------------------------------------------------------------ */
/*  Helper exported for order capacity calculation                      */
/*                                                                      */
/*  calcOrderCapacityUnits(items)                                       */
/*    items: Array<{ product_id: string; quantity: number }>           */
/*    Looks up capacity_units by meta_product_id and returns           */
/*    sum(capacity_units * quantity). Missing products count as 3.     */
/* ------------------------------------------------------------------ */
export async function calcOrderCapacityUnits(
  items: Array<{ product_id: string; quantity: number }>
): Promise<number> {
  if (!items || items.length === 0) return 0;

  const ids = items.map(i => i.product_id);
  const { data: products } = await supabase
    .from('products')
    .select('meta_product_id, capacity_units')
    .in('meta_product_id', ids);

  const capacityMap = new Map<string, number>(
    (products ?? []).map(p => [p.meta_product_id as string, (p.capacity_units as number) ?? 3])
  );

  return items.reduce((sum, item) => {
    const units = capacityMap.get(item.product_id) ?? 3;
    return sum + units * item.quantity;
  }, 0);
}

export default router;
