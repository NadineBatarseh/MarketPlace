import 'dotenv/config';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { validateProducts } from '../metaCatalog/metaCatalogAPIValidator.js';
import { syncProductsToMeta } from '../metaCatalog/metaCatalogAPISync.js';
import type { ProductSyncInput } from '../metaCatalog/metaCatalogAPITypes.js';

const router = Router();

/* ──────────────────────────────────────────────────────────────────
   Supabase Database Webhook — products table
   Fires on INSERT, UPDATE, and DELETE events.

   Supabase sends:
     Authorization: Bearer <SUPABASE_WEBHOOK_SECRET>
     Content-Type:  application/json
     Body: {
       type:       "INSERT" | "UPDATE" | "DELETE",
       table:      "products",
       schema:     "public",
       record:     { ...row }  | null   (null on DELETE)
       old_record: { ...row }  | null   (null on INSERT)
     }
────────────────────────────────────────────────────────────────── */

function verifySupabaseSecret(req: Request, res: Response): boolean {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[ProductWebhook] SUPABASE_WEBHOOK_SECRET is not set in .env');
    res.sendStatus(500);
    return false;
  }

  const authHeader = req.headers.authorization ?? '';
  // Accept both "Bearer <secret>" and the raw secret value
  const incoming = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!incoming || incoming !== secret) {
    console.warn('[ProductWebhook] Rejected — invalid secret');
    res.sendStatus(401);
    return false;
  }

  return true;
}

router.post('/', async (req: Request, res: Response) => {
  if (!verifySupabaseSecret(req, res)) return;

  // Always ack immediately so Supabase doesn't retry
  res.sendStatus(200);

  const { type, record, old_record } = req.body as {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;
    schema: string;
    record: Record<string, any> | null;
    old_record: Record<string, any> | null;
  };

  console.log(`[ProductWebhook] event=${type} id=${(record ?? old_record)?.id}`);


  if (type === 'DELETE') {
    const row = old_record;
    if (!row?.id) return;

    const deleteInput: ProductSyncInput = {
      id: row.id,
      meta_product_id: row.meta_product_id ?? null,
      title: '',
      deleted: true,
    };

    const [result] = await syncProductsToMeta({ products: [deleteInput] });
    if (!result.ok) {
      console.error(`[ProductWebhook] Meta DELETE failed — ${result.error}`);
    } else {
      console.log(`[ProductWebhook] Deleted ${row.id} from Meta catalog`);
    }
    return;
  }

  // INSERT or UPDATE
  const row = record;
  if (!row?.id) return;

  const syncInput: ProductSyncInput = {
    id: row.id,
    meta_product_id: row.meta_product_id ?? null,
    title: row.title ?? '',
    description: row.description ?? null,
    price: row.price ?? null,
    stock_Quantity: row.stock_Quantity ?? null,
    image_urls: row.image_urls ?? null,
    currency: 'ILS',
  };

  console.log('[ProductWebhook] syncInput:', JSON.stringify(syncInput));

  const { valid, failures } = validateProducts([syncInput]);

  if (failures.length > 0) {
    console.warn(`[ProductWebhook] Validation failed for ${row.id}:`, JSON.stringify(failures));
    return;
  }

  console.log('[ProductWebhook] Validation passed — calling Meta API...');
  const [result] = await syncProductsToMeta({ products: valid });
  console.log('[ProductWebhook] Meta result:', JSON.stringify(result));

  if (!result.ok) {
    console.error(`[ProductWebhook] Meta sync failed — ${result.error}`);
  } else {
    console.log(`[ProductWebhook] Synced ${row.id} to Meta catalog (${type})`);
  }
});

export default router;
