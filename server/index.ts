import express from "express";
import cors from "cors";
import "dotenv/config";
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import path from "path";
import { supabase } from "./supabase.js";
import { uploadImage } from "./uploadImage.js";
import logisticsRouter from "../src/pages/delivery agent/LogisticsRoutes.js";
import webhookRouter from "./webhooks.js";
import searchRouter from "./search/searchRouter.js";
import productUploadRouter from "./routes/productUploadRouter.js";
import metaCatalogRouter from "./routes/metaCatalogAPIRouter.js";
import productCRUDRouter from "./routes/productCRUDRouter.js";
import supabaseProductWebhookRouter from "./routes/supabaseProductWebhookRouter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4000"] }));

// Webhook must be mounted with raw body BEFORE express.json(),
// because signature verification needs the unparsed buffer.
app.use("/webhook", express.raw({ type: "application/json" }), webhookRouter);

app.use(express.json({ limit: '10mb' }));

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
  const lastDot = digitsOnly.lastIndexOf(".");
  const lastComma = digitsOnly.lastIndexOf(",");
  let normalised = digitsOnly;
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

app.post("/api/sync-products", async (_req: Request, res: Response) => {
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
          shop_id: shopId,
          meta_product_id: p.id,
          title: p.name ?? `Product ${p.id}`,
          description: p.description ?? null,
          price: parseMetaPrice(p.price),
          image_urls: storedImageUrl ? [storedImageUrl] : p.image_url ? [p.image_url] : null,
          stock_Quantity: p.quantity_to_sell_on_facebook ?? null,
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

app.get("/api/products", async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, products: data });
});

/* ---------- CHAT (Claude + Supabase MCP tools) ---------- */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Supabase tool definitions for Claude ─────────────────────────────────────

const SUPABASE_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_products",
    description: "List products from the Souq Link marketplace. Supports optional keyword, price, and shop filters.",
    input_schema: {
      type: "object",
      properties: {
        keywords:   { type: "array", items: { type: "string" }, description: "Search terms matched against title and description" },
        max_price:  { type: "number", description: "Maximum price filter" },
        price_sort: { type: "string", enum: ["asc", "desc"], description: "Sort by price" },
        shop_id:    { type: "string", description: "Filter by a specific shop ID" },
        limit:      { type: "number", description: "Max results to return (default 20)" },
      },
    },
  },
  {
    name: "get_product",
    description: "Fetch a single product by its ID.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Product UUID" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_product",
    description: "Create a new product in the caller's shop. Requires a valid Supabase JWT.",
    input_schema: {
      type: "object",
      properties: {
        title:          { type: "string", description: "Product title (required)" },
        price:          { type: "number", description: "Product price (required, non-negative)" },
        description:    { type: "string" },
        stock_Quantity: { type: "number" },
        image_urls:     { type: "array", items: { type: "string" } },
      },
      required: ["title", "price"],
    },
  },
  {
    name: "update_product",
    description: "Update fields of an existing product. Only the product's owner shop can update it.",
    input_schema: {
      type: "object",
      properties: {
        id:             { type: "string", description: "Product UUID to update" },
        title:          { type: "string" },
        price:          { type: "number" },
        description:    { type: "string" },
        stock_Quantity: { type: "number" },
        image_urls:     { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_product",
    description: "Delete a product from the caller's shop.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Product UUID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_shops",
    description: "List shops in Souq Link. Supports optional name and location filters.",
    input_schema: {
      type: "object",
      properties: {
        name:     { type: "string", description: "Partial shop name to search" },
        location: { type: "string", description: "Partial location to search" },
      },
    },
  },
  {
    name: "get_shop",
    description: "Fetch a single shop by its ID.",
    input_schema: {
      type: "object",
      properties: {
        shop_id: { type: "string", description: "Shop UUID" },
      },
      required: ["shop_id"],
    },
  },
  {
    name: "apply_discount",
    description: "Apply a discount to one product or all products in the merchant's shop. Supports percentage (e.g. 20%) or fixed amount deduction. Returns the updated products with old and new prices.",
    input_schema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "UUID of a specific product to discount. Omit to apply to ALL products in the shop.",
        },
        discount_type: {
          type: "string",
          enum: ["percentage", "fixed"],
          description: "'percentage' deducts a % from the price (e.g. 20 → 20% off). 'fixed' deducts a fixed amount (e.g. 10 → subtract 10 from price).",
        },
        discount_value: {
          type: "number",
          description: "The discount amount. For percentage: 1–99. For fixed: any positive number less than the product price.",
        },
      },
      required: ["discount_type", "discount_value"],
    },
  },
  {
    name: "remove_discount",
    description: "Remove the discount from one product or all products in the merchant's shop, restoring the original price display.",
    input_schema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "UUID of the product to remove the discount from. Omit to remove discounts from ALL products in the shop.",
        },
      },
    },
  },
];

// Tools available per chatbot role
const ROLE_TOOLS: Record<string, string[]> = {
  merchant: ["list_products", "get_product", "create_product", "update_product", "delete_product", "list_shops", "get_shop", "apply_discount", "remove_discount"],
  admin:    ["list_products", "get_product", "list_shops", "get_shop"],
  customer: ["list_products", "get_product", "list_shops", "get_shop"],
};

// ── Tool executor ─────────────────────────────────────────────────────────────

// Resolve the merchant's shop_id from their JWT (called once per request)
async function resolveMerchantShopId(sb_auth_token: string): Promise<string> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser(sb_auth_token);
  console.log(`[auth] getUser → user=${user?.id ?? "null"} err=${authErr?.message ?? "none"}`);
  if (authErr || !user) throw new Error("جلسة غير صالحة، يرجى تسجيل الدخول مجدداً.");
  const { data: shop, error: shopErr } = await supabase
    .from("shops").select("shop_id").eq("owner_id", user.id).maybeSingle();
  console.log(`[auth] shop lookup → shop_id=${shop?.shop_id ?? "null"} err=${shopErr?.message ?? "none"}`);
  if (shopErr || !shop) throw new Error("لا يوجد متجر مرتبط بهذا الحساب.");
  return shop.shop_id as string;
}

// merchant_shop_id is injected for merchant role — all tools are scoped to it automatically
async function executeTool(
  name: string,
  input: Record<string, any>,
  merchant_shop_id?: string,
): Promise<string> {
  console.log(`[tool:${name}] called, merchant_shop_id=${merchant_shop_id ?? "none"}`);

  switch (name) {
    case "list_products": {
      let query = supabase
        .from("products")
        .select("id, title, description, price, discount, image_urls, stock_Quantity, shop_id");

      // Merchant always sees only their own products
      if (merchant_shop_id) {
        query = query.eq("shop_id", merchant_shop_id);
      }

      if (input.keywords?.length) {
        const orParts = (input.keywords as string[]).flatMap((t: string) => [
          `title.ilike.%${t}%`, `description.ilike.%${t}%`,
        ]);
        query = query.or(orParts.join(","));
      }
      if (input.max_price)  query = query.lte("price", input.max_price);
      if (input.price_sort) query = query.order("price", { ascending: input.price_sort === "asc" });
      query = query.limit(input.limit ?? 20);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return JSON.stringify(data ?? []);
    }

    case "get_product": {
      let query = supabase
        .from("products")
        .select("id, title, description, price, discount, image_urls, stock_Quantity, shop_id, capacity_units")
        .eq("id", input.id);

      // Merchant can only fetch their own products
      if (merchant_shop_id) query = query.eq("shop_id", merchant_shop_id);

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`المنتج ${input.id} غير موجود أو لا ينتمي إلى متجرك.`);
      return JSON.stringify(data);
    }

    case "create_product": {
      if (!merchant_shop_id) throw new Error("يجب تسجيل الدخول كتاجر لإضافة منتج.");
      const { data, error } = await supabase.from("products").insert({
        shop_id:        merchant_shop_id,
        meta_product_id: crypto.randomUUID(),
        title:          (input.title as string).trim(),
        description:    (input.description as string | undefined)?.trim() ?? null,
        price:          input.price,
        stock_Quantity: input.stock_Quantity ?? null,
        image_urls:     input.image_urls ?? null,
      }).select().single();
      if (error) throw new Error(error.message);
      return JSON.stringify({ ok: true, product: data });
    }

    case "update_product": {
      if (!merchant_shop_id) throw new Error("يجب تسجيل الدخول كتاجر لتعديل منتج.");
      const updates: Record<string, unknown> = {};
      if (input.title          !== undefined) updates.title          = (input.title as string).trim();
      if (input.price          !== undefined) updates.price          = input.price;
      if (input.description    !== undefined) updates.description    = (input.description as string).trim();
      if (input.stock_Quantity !== undefined) updates.stock_Quantity = input.stock_Quantity;
      if (input.image_urls     !== undefined) updates.image_urls     = input.image_urls;
      if (Object.keys(updates).length === 0) throw new Error("لم يتم تقديم أي حقول للتحديث.");
      const { data, error } = await supabase.from("products")
        .update(updates)
        .eq("id", input.id)
        .eq("shop_id", merchant_shop_id)  // ownership enforced here
        .select().single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("المنتج غير موجود أو لا ينتمي إلى متجرك.");
      return JSON.stringify({ ok: true, product: data });
    }

    case "delete_product": {
      if (!merchant_shop_id) throw new Error("يجب تسجيل الدخول كتاجر لحذف منتج.");
      const { error } = await supabase.from("products")
        .delete()
        .eq("id", input.id)
        .eq("shop_id", merchant_shop_id);  // ownership enforced here
      if (error) throw new Error(error.message);
      return JSON.stringify({ ok: true, deleted_id: input.id });
    }

    case "list_shops": {
      let query = supabase.from("shops").select("shop_id, name, location, description, logo_url");
      if (input.name)     query = query.ilike("name",     `%${input.name}%`);
      if (input.location) query = query.ilike("location", `%${input.location}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return JSON.stringify(data ?? []);
    }

    case "get_shop": {
      // Merchant with no explicit shop_id → return their own shop
      const target_shop_id = input.shop_id ?? merchant_shop_id;
      if (!target_shop_id) throw new Error("يرجى تحديد معرّف المتجر.");
      const { data, error } = await supabase
        .from("shops")
        .select("shop_id, name, location, description, logo_url, owner_id")
        .eq("shop_id", target_shop_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`المتجر غير موجود.`);
      return JSON.stringify(data);
    }

    case "apply_discount": {
      if (!merchant_shop_id) throw new Error("يجب تسجيل الدخول كتاجر لتطبيق خصم.");

      const { discount_type, discount_value, product_id } = input as {
        discount_type: "percentage" | "fixed";
        discount_value: number;
        product_id?: string;
      };

      if (discount_type === "percentage" && (discount_value <= 0 || discount_value >= 100)) {
        throw new Error("نسبة الخصم يجب أن تكون بين 1 و 99.");
      }
      if (discount_type === "fixed" && discount_value <= 0) {
        throw new Error("قيمة الخصم الثابتة يجب أن تكون أكبر من صفر.");
      }

      // Fetch target products (one or all in the shop)
      let fetchQuery = supabase
        .from("products")
        .select("id, title, price")
        .eq("shop_id", merchant_shop_id);
      if (product_id) fetchQuery = fetchQuery.eq("id", product_id);

      const { data: products, error: fetchErr } = await fetchQuery;
      if (fetchErr) throw new Error(fetchErr.message);
      if (!products?.length) throw new Error("لم يتم العثور على منتجات لتطبيق الخصم عليها.");

      const results: { id: string; title: string; original_price: number; discounted_price: number; discount: number | string }[] = [];

      for (const product of products) {
        const originalPrice = product.price as number;
        let discountedPrice: number;
        let discountStored: number; // always stored as percentage in the DB

        if (discount_type === "percentage") {
          discountedPrice  = parseFloat((originalPrice * (1 - discount_value / 100)).toFixed(2));
          discountStored   = discount_value;
        } else {
          // Fixed amount → convert to percentage for consistent storage
          discountedPrice  = parseFloat((originalPrice - discount_value).toFixed(2));
          discountStored   = parseFloat(((discount_value / originalPrice) * 100).toFixed(2));
        }

        if (discountedPrice <= 0) {
          // Skip — discount exceeds the price
          results.push({ id: product.id, title: product.title, original_price: originalPrice, discounted_price: originalPrice, discount: "تجاوز الخصم سعر المنتج، تم تخطيه" });
          continue;
        }

        // Store the discount percentage in the new `discount` column
        // The original `price` column stays unchanged (source of truth)
        const { error: updateErr } = await supabase
          .from("products")
          .update({ discount: discountStored })
          .eq("id", product.id)
          .eq("shop_id", merchant_shop_id);

        if (updateErr) throw new Error(`فشل تحديث المنتج "${product.title}": ${updateErr.message}`);
        results.push({ id: product.id, title: product.title, original_price: originalPrice, discounted_price: discountedPrice, discount: discountStored });
      }

      return JSON.stringify({ ok: true, updated: results });
    }

    case "remove_discount": {
      if (!merchant_shop_id) throw new Error("يجب تسجيل الدخول كتاجر لإزالة الخصم.");

      const { product_id } = input as { product_id?: string };

      let query = supabase
        .from("products")
        .update({ discount: null })
        .eq("shop_id", merchant_shop_id);
      if (product_id) query = query.eq("id", product_id);

      const { error } = await query;
      if (error) throw new Error(error.message);

      const scope = product_id ? `المنتج ${product_id}` : "جميع المنتجات في متجرك";
      return JSON.stringify({ ok: true, message: `تمت إزالة الخصم من ${scope}.` });
    }

    default:
      throw new Error(`أداة غير معروفة: ${name}`);
  }
}

// ── /api/chat handler ─────────────────────────────────────────────────────────

app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, role, sb_auth_token } = req.body as {
    message: string;
    role: string;
    sb_auth_token?: string;
  };

  if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

  // For merchants: resolve shop_id once upfront and inject into all tool calls
  let merchant_shop_id: string | undefined;
  if (role === "merchant" && sb_auth_token) {
    try {
      merchant_shop_id = await resolveMerchantShopId(sb_auth_token);
    } catch (err: any) {
      return res.status(401).json({ ok: false, error: err.message });
    }
  }

  const allowedToolNames = ROLE_TOOLS[role] ?? ROLE_TOOLS["customer"];
  const tools = SUPABASE_TOOLS.filter(t => allowedToolNames.includes(t.name));

  const systemPrompt = role === "merchant"
    ? `أنت مساعد ذكي للتاجر على منصة سوق لينك.
جميع العمليات (عرض المنتجات، إضافة، تعديل، حذف) تخص متجر هذا التاجر فقط — لا تعرض أو تعدّل منتجات متاجر أخرى.
لديك أدوات مباشرة للتعامل مع قاعدة البيانات، استخدمها دائماً للحصول على بيانات حقيقية.
أجب دائماً باللغة العربية بشكل واضح ومختصر.`
    : role === "admin"
    ? `أنت مساعد ذكي لمدير منصة سوق لينك. لديك صلاحية عرض جميع المنتجات والمتاجر.
أجب دائماً باللغة العربية بشكل واضح ومختصر.`
    : `أنت مساعد ذكي لمنصة سوق لينك. ساعد العميل في البحث عن المنتجات والمتاجر.
أجب دائماً باللغة العربية بشكل واضح ومختصر.`;

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const { images } = req.body as { message: string; role: string; images?: { base64: string; mediaType: string }[] };

    const userContent: any[] = [];
    if (images?.length) {
      for (const img of images) {
        userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
      }
    }
    if (message) {
      userContent.push({ type: "text", text: message });
    }

    const stream = anthropic.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    stream.on("text", (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on("finalMessage", () => {
      res.write(`data: [DONE]\n\n`);
      res.end();
    });

    stream.on("error", (err) => {
      console.error("[/api/chat] stream error:", err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

  } catch (err: any) {
    console.error("[/api/chat] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------- SEARCH ---------- */
app.use("/api/search", searchRouter);

/* ---------- PRODUCT BULK UPLOAD ---------- */
app.use("/api/products", productUploadRouter);

/* ---------- META CATALOG SYNC ---------- */
app.use("/api/catalog", metaCatalogRouter);

/* ---------- PRODUCT CRUD (create / delete + auto Meta sync) ---------- */
app.use("/api/products", productCRUDRouter);

/* ---------- SUPABASE DB WEBHOOK (auto-sync on direct DB changes) ---------- */
app.use("/api/webhooks/supabase-products", supabaseProductWebhookRouter);

/* ---------- LOGISTICS ---------- */
app.use("/api/logistics", logisticsRouter);

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
    .select("shop_id, name, description, shopLogo, created_at, whatsapp, instagram, facebook, location, shop_ratings(avg_rating, review_count)")
    .eq("shop_id", id)
    .single();

  if (error || !store) {
    console.error("[/api/stores/:id] Supabase error:", error);
    const detail = error?.message ?? "row not found";
    return res.status(404).json({ ok: false, error: `المتجر غير موجود — ${detail}` });
  }

  // Resolve logo from the shopLogo storage bucket (file named by shop_id, any extension)
  let shopLogo: string | null = store.shopLogo ?? null;
  const { data: files } = await supabase.storage.from("shopLogo").list("", { search: id });
  const logoFile = files?.find((f) => f.name.split(".")[0] === id);
  if (logoFile) {
    const { data: urlData } = supabase.storage.from("shopLogo").getPublicUrl(logoFile.name);
    shopLogo = urlData.publicUrl;
  }

  const ratings = (store as any).shop_ratings;
  const avg_rating = ratings?.[0]?.avg_rating ?? null;
  const review_count = ratings?.[0]?.review_count ?? 0;

  return res.json({ ok: true, store: { ...store, shopLogo, avg_rating, review_count } });
});

// POST /api/stores/:id/reviews  — submit a star rating
app.post("/api/stores/:id/reviews", async (req: Request, res: Response) => {
  const shop_id = req.params.id;
  const { rating, user_id } = req.body as { rating: number; user_id?: string };

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: "التقييم يجب أن يكون بين 1 و 5" });
  }

  // Prevent duplicate rating from the same user
  if (user_id) {
    const { data: existing } = await supabase
      .from("shop_reviews")
      .select("id")
      .eq("shop_id", shop_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ ok: false, error: "لقد قيّمت هذا المتجر مسبقاً" });
    }
  }

  const { error } = await supabase
    .from("shop_reviews")
    .insert({ shop_id, rating, user_id: user_id ?? null });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Incremental running average — O(1), reads 1 row regardless of total reviews
  // Formula: new_avg = (old_avg * old_count + new_rating) / (old_count + 1)
  const { data: current } = await supabase
    .from("shop_ratings")
    .select("avg_rating, review_count")
    .eq("shop_id", shop_id)
    .maybeSingle();

  const old_count = current?.review_count ?? 0;
  const old_avg   = parseFloat(current?.avg_rating ?? '0') || 0;
  const review_count = old_count + 1;
  const avg_rating   = (old_avg * old_count + rating) / review_count;

  await supabase
    .from("shop_ratings")
    .upsert({ shop_id, avg_rating, review_count }, { onConflict: "shop_id" });

  return res.json({ ok: true, avg_rating, review_count });
});

// GET /api/stores/:id/products  — paginated product list for a shop
// Query params: page (default 1), limit (default 12), sort
app.get("/api/stores/:id/products", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 12);
  const sort = (req.query.sort as string) || "default";
  const offset = (page - 1) * limit;

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
    default: { column: "updated_at", ascending: false },
    newest: { column: "created_at", ascending: false },
    price_asc: { column: "price", ascending: true },
    price_desc: { column: "price", ascending: false },
    rating: { column: "rating", ascending: false },
  };
  const { column: orderCol, ascending } = sortMap[sort] ?? sortMap["default"];

  // Fetch products + total count in parallel
  const [{ data: products, error: prodErr }, { count, error: countErr }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, title, description, price, image_urls, stock_Quantity")
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
    ok: true,
    products: products ?? [],
    total: count ?? 0,
    page,
    limit,
  });
});

// GET /api/stores — fetch all shops with avg rating + review count
app.get("/api/stores", async (_req: Request, res: Response) => {
  const { data: stores, error } = await supabase
    .from("shops")
    .select("shop_id, name, shopLogo, location, shop_ratings(avg_rating, review_count)")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const mapped = (stores ?? []).map((s: any) => ({
    shop_id: s.shop_id,
    name: s.name,
    shopLogo: s.shopLogo,
    location: s.location,
    avg_rating: s.shop_ratings?.[0]?.avg_rating ?? null,
    review_count: s.shop_ratings?.[0]?.review_count ?? 0,
  }));

  return res.json({ ok: true, stores: mapped });
});

/* ---------- ACTIVATE ACCOUNT ---------- */

app.post("/api/activate", async (req: Request, res: Response) => {
  const { platformEmail, password } = req.body as { platformEmail: string; password: string };

  if (!platformEmail || !password) {
    return res.status(400).json({ ok: false, error: "Missing email or password" });
  }

  // 1. Find approved application (merchant → delivery → hubworker)
  let applicantName: string | null = null;
  let role: "merchant" | "delivery" | "hubworker" = "merchant";

  const { data: merchantApp } = await supabase
    .from("merchant_applications")
    .select("name_of_owner")
    .eq("platform_email", platformEmail.trim())
    .eq("status", "approved")
    .maybeSingle();

  if (merchantApp) {
    applicantName = merchantApp.name_of_owner;
    role = "merchant";
  } else {
    const { data: deliveryApp } = await supabase
      .from("delivery_applications")
      .select("name")
      .eq("platform_email", platformEmail.trim())
      .eq("status", "approved")
      .maybeSingle();

    if (deliveryApp) {
      applicantName = deliveryApp.name;
      role = "delivery";
    } else {
      const { data: hubApp } = await supabase
        .from("hubworker_applications")
        .select("name")
        .eq("platform_email", platformEmail.trim())
        .eq("status", "approved")
        .maybeSingle();

      if (hubApp) {
        applicantName = hubApp.name;
        role = "hubworker";
      }
    }
  }

  if (!applicantName) {
    return res.status(404).json({
      ok: false,
      error: "هذا البريد الإلكتروني غير مرتبط بطلب معتمد. تحقق من البريد الذي أرسلناه لك.",
    });
  }

  // 2. Create fully-confirmed auth user via admin API (no email confirmation needed)
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: platformEmail.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: applicantName },
  });

  if (createError) {
    if (
      createError.message?.toLowerCase().includes("already been registered") ||
      createError.message?.toLowerCase().includes("already registered")
    ) {
      return res.status(409).json({
        ok: false,
        error: "هذا البريد الإلكتروني مسجل مسبقاً — يمكنك تسجيل الدخول مباشرة.",
      });
    }
    return res.status(500).json({ ok: false, error: createError.message });
  }

  const userId = created.user?.id;
  if (!userId) {
    return res.status(500).json({ ok: false, error: "فشل في إنشاء حساب المستخدم." });
  }

  // 3. Insert into public.Users using service-role key (bypasses RLS)
  const { error: insertError } = await supabase.from("Users").upsert(
    { user_id: userId, email: platformEmail.trim(), role, status: "approved", name: applicantName },
    { onConflict: "user_id" }
  );

  if (insertError) {
    return res.status(500).json({ ok: false, error: insertError.message });
  }

  return res.json({ ok: true });
});

/* ---------- META AUTH CALLBACK ---------- */

app.get("/auth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const sb_auth_token = req.query.state as string;

  if (!code) return res.status(400).send("Missing authorization code.");
  if (!sb_auth_token) return res.status(401).send("Missing auth token in state.");

  try {
    const redirectUri =
      process.env.META_REDIRECT_URI ||
      `${req.protocol}://${req.headers.host}/auth/callback`;

    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      client_secret: process.env.META_APP_SECRET!,
      redirect_uri: redirectUri,
      code,
    });

    const metaRes = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`
    );
    const metaData: any = await metaRes.json();

    if (!metaData.access_token) {
      return res.status(400).json({ error: "Failed to get access token", details: metaData.error });
    }

    const { error } = await supabase.functions.invoke("store-catalog-token", {
      headers: { Authorization: `Bearer ${sb_auth_token}` },
      body: { token: metaData.access_token, provider: "facebook" },
    });

    if (error) {
      return res.status(500).send(`Failed to save token: ${error.message}`);
    }

    res.send(`<h1>تم الربط والحفظ في Supabase بنجاح! 🎉</h1><p>يمكنك إغلاق هذه الصفحة والعودة للتطبيق.</p>`);
  } catch (err: any) {
    res.status(500).send(`<h2>خطأ في السيرفر</h2><p>${err.message}</p>`);
  }
});

/* ---------- META AUTH INITIATION ---------- */

app.get("/auth/meta", (_req: Request, res: Response) => {
  const clientId = process.env.META_APP_ID;
  if (!clientId) {
    return res.status(500).send("META_APP_ID is not configured in .env");
  }
  const redirectUri =
    process.env.META_REDIRECT_URI ||
    `http://localhost:${PORT}/auth/callback`;

  const oauthUrl = new URL("https://www.facebook.com/dialog/oauth");
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("scope", "catalog_management");

  res.redirect(oauthUrl.toString());
});

/* ---------- SERVE FRONTEND (production only) ---------- */

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

/* ---------- START ---------- */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);