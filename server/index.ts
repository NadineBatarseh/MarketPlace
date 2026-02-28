import express from "express";
import "dotenv/config";
import type { Request, Response } from "express";
import { fileURLToPath } from "url";
import path from "path";
import { supabase } from "./supabase.js";
import { uploadImage } from "./uploadImage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

/* ---------- HELPERS ---------- */

/**
 * Convert a Meta Catalog price string to a plain float.
 * Handles formats like: "12.99 USD", "₪ ١٢٫٩٩", "1,299.00 ILS", etc.
 */
function parseMetaPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) → Latin (0-9)
  const latin = raw.replace(/[٠-٩]/g, (d) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(d))
  );
  // Keep only digits, dots, and commas; strip currency symbols & spaces
  const digitsOnly = latin.replace(/[^\d.,]/g, "");
  // Normalise: treat the last . or , as decimal separator
  const lastDot   = digitsOnly.lastIndexOf(".");
  const lastComma = digitsOnly.lastIndexOf(",");
  let normalised  = digitsOnly;
  if (lastComma > lastDot) {
    // European format "1.299,99" → "1299.99"
    normalised = digitsOnly.replace(/\./g, "").replace(",", ".");
  } else {
    // Standard "1,299.99" or Arabic "١٢٫٩٩" → remove thousands separator
    normalised = digitsOnly.replace(/,/g, "");
  }
  const num = parseFloat(normalised);
  return isNaN(num) ? null : num;
}

/* ---------- API ROUTES ---------- */

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "Backend is running" });
});

app.post("/sync-products", async (_req: Request, res: Response) => {
  try {
    const catalogId = process.env.META_CATALOG_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!catalogId || !accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing META_CATALOG_ID or META_ACCESS_TOKEN in .env",
      });
    }

    const url = new URL(
      `https://graph.facebook.com/v19.0/${catalogId}/products`
    );
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set(
      "fields",
      "id,name,description,price,image_url,quantity_to_sell_on_facebook"
    );

    const metaRes = await fetch(url.toString());
    const metaData = await metaRes.json();

    if (!metaRes.ok) {
      return res.status(metaRes.status).json({ ok: false, metaError: metaData });
    }

    const products = metaData?.data ?? [];

    const shopId = process.env.SHOP_ID ?? null;

    const rows = await Promise.all(
      products.map(async (p: any) => {
        const storedImageUrl = p.image_url
          ? await uploadImage(p.image_url, p.id)
          : null;

        return {
          shop_id:         shopId,
          meta_product_id: p.id,
          title:           p.name ?? `Product ${p.id}`,
          description:     p.description ?? null,
          price:           parseMetaPrice(p.price),
          image_url:       storedImageUrl ?? p.image_url ?? null,
          stock_Quantity:  p.quantity_to_sell_on_facebook ?? null,
        };
      })
    );

    const { error } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "meta_product_id" });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, productsFetched: products.length, savedToDb: rows.length });
  } catch (err) {
    console.error("SYNC ERROR:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: errMsg });
  }
});

app.get("/products", async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, products: data });
});

/* ---------- DEBUG (remove after fixing) ---------- */

app.get("/api/debug/shops", async (_req: Request, res: Response) => {
  const { data, error } = await supabase.from("shops").select("*").limit(10);
  return res.json({ data, error });
});

/* ---------- STORE PAGE API ---------- */

// GET /api/stores/:id  — fetch a single shop by its shop_id
app.get("/api/stores/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const { data: store, error } = await supabase
    .from("shops")
    .select("shop_id, name, description, shopLogo, created_at")
    .eq("shop_id", id)
    .single();

  if (error || !store) {
    console.error("[/api/stores/:id] Supabase error:", error);
    const detail = error?.message ?? "row not found";
    return res.status(404).json({ ok: false, error: `المتجر غير موجود — ${detail}` });
  }

  return res.json({ ok: true, store });
});

// GET /api/stores/:id/products  — paginated product list for a shop
// Query params: page (default 1), limit (default 12), sort
app.get("/api/stores/:id/products", async (req: Request, res: Response) => {
  const id        = req.params.id as string;
  const page      = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit     = Math.min(50, parseInt(req.query.limit as string) || 12);
  const sort      = (req.query.sort as string) || "default";
  const offset    = (page - 1) * limit;

  const { data: shop } = await supabase
    .from("shops")
    .select("shop_id")
    .eq("shop_id", id)
    .single();

  if (!shop) {
    return res.status(404).json({ ok: false, error: "المتجر غير موجود" });
  }

  // Map sort option to Supabase order args
  const sortMap: Record<string, { column: string; ascending: boolean }> = {
    default:    { column: "updated_at",     ascending: false },
    newest:     { column: "created_at",     ascending: false },
    price_asc:  { column: "price",          ascending: true  },
    price_desc: { column: "price",          ascending: false },
    rating:     { column: "rating",         ascending: false },
  };
  const { column: orderCol, ascending } = sortMap[sort] ?? sortMap["default"];

  // Fetch products + total count in parallel
  const [{ data: products, error: prodErr }, { count, error: countErr }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, title, description, price, image_url, stock_Quantity")
        .eq("shop_id", shop.shop_id)
        .order(orderCol, { ascending })
        .range(offset, offset + limit - 1),

      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shop.shop_id),
    ]);

  if (prodErr || countErr) {
    const msg = prodErr?.message || countErr?.message || "خطأ في قاعدة البيانات";
    return res.status(500).json({ ok: false, error: msg });
  }

  return res.json({
    ok:       true,
    products: products ?? [],
    total:    count   ?? 0,
    page,
    limit,
  });
});

/* ---------- SERVE FRONTEND (production) ---------- */

const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

// Catch-all: send index.html for any unknown route (SPA support)
app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(distPath, "index.html"));
});

/* ---------- START ---------- */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
