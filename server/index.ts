import express from "express";
import cors from "cors";
import "dotenv/config";
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getTools, callTool } from "./mcpClient.js";
import { getMerchantTools, callMerchantTool } from "../src/mcp/merchant/client.js";
import { fileURLToPath } from "url";
import path from "path";
import { supabase } from "./supabase.js";
import { uploadImage } from "./uploadImage.js";
import { randomUUID } from "crypto";
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

/* ---------- CHAT (Claude + MCP tools) ---------- */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, role, sb_auth_token, images } = req.body as {
    message: string;
    role: string;
    sb_auth_token?: string;
    images?: { base64: string; mediaType: string }[];
  };

  if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

  // ── MERCHANT AUTH GATE ─────────────────────────────────────────────────────
  // Layer 2 protection: verify the merchant is logged in, has merchant role,
  // and owns a shop before allowing any tool access or Claude calls.

  let merchant_shop_id: string | undefined;

  // helper to stream an auth error back to the chatbot UI
  const sseError = (msg: string) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ text: msg })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  };

  if (role === "merchant") {

    // 1. Token must exist — no guest access for merchants
    if (!sb_auth_token) {
      return sseError("يرجى تسجيل الدخول أولاً للوصول إلى هذه الميزة.");
    }

    // 2. Verify token is valid and get the user
    const { data: { user }, error: authErr } = await supabase.auth.getUser(sb_auth_token);
    if (authErr || !user) {
      console.error("[chat] invalid token:", authErr?.message);
      return sseError("جلستك منتهية، يرجى تسجيل الدخول مجدداً.");
    }

    // 3. Confirm the user's role is actually "merchant" in our Users table
    const { data: userRecord, error: userErr } = await supabase
      .from("Users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (userErr) {
      console.error("[chat] user lookup error:", userErr.message);
      return sseError("حدث خطأ في التحقق من صلاحياتك.");
    }
    if (!userRecord || userRecord.role !== "merchant") {
      return sseError("هذه الميزة متاحة للتجار فقط.");
    }

    // 4. Confirm the merchant has a shop linked to their account
    const { data: shop, error: shopErr } = await supabase
      .from("shops")
      .select("shop_id")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (shopErr) {
      console.error("[chat] shop lookup error:", shopErr.message);
      return sseError("حدث خطأ في تحميل بيانات متجرك.");
    }
    if (!shop) {
      return sseError("لا يوجد متجر مرتبط بحسابك، تواصل مع الدعم.");
    }

    merchant_shop_id = shop.shop_id;
  }
  // ── END MERCHANT AUTH GATE ─────────────────────────────────────────────────

  const hasImages = (images?.length ?? 0) > 0;

 const systemPrompt = role === "merchant"
  ? `أنت مساعد ذكي للتاجر على منصة سوق لينك.
جميع العمليات تخص متجر هذا التاجر فقط.
لديك أدوات مباشرة للتعامل مع قاعدة البيانات، استخدمها دائماً للحصول على بيانات حقيقية.
لا تطلب من التاجر أي معرّفات أو UUIDs — كل الأدوات تتحقق من هويته تلقائياً عبر رمز الجلسة.

قواعد التحديث والحذف (مهم):
- قبل تحديث أو حذف منتج، استدعِ find_my_product أولاً للحصول على product_id الحقيقي.
- إذا أعادت find_my_product أكثر من منتج واحد بنفس الاسم، اسأل التاجر أي منتج يقصد تحديداً قبل المتابعة.
- ثم استدعِ update_my_product أو delete_my_product مع هذا الـ product_id.
- لا تطلب من التاجر الـ product_id أبداً — ابحث عنه بالاسم.

قواعد الوصف في update_my_product (مهم):
- التاجر يقول "غيّر الوصف / change description / بدّل الوصف" → استخدم description فقط (يستبدل الوصف كاملاً).
- التاجر يقول "أضف للوصف / add to description / أضف كلمة" → استخدم append_description فقط (يُضاف للوصف الموجود تلقائياً — لا تُرسل description أبداً في هذه الحالة).

${hasImages
  ? `الصور المرفقة: أرفق التاجر ${images!.length} صورة في هذه الرسالة. هذه الصور سيتم رفعها تلقائياً — لا تطلب من التاجر روابط أبداً، فقط استدعِ الأداة مباشرة.
قواعد الصور:
- عند إضافة منتج جديد (add_my_product): الصور تُرفع وتُحقن تلقائياً — لا ترسل image_urls بنفسك.
- عند تحديث منتج (update_my_product): الافتراضي دائماً إضافة للصور الموجودة — لا تُرسل append_image_urls أبداً بنفسك.
- إذا قال التاجر "استبدل الصور" أو "replace" → أرسل replace_images: true فقط.`
  : `إذا أرفق التاجر صوراً، سيتم رفعها تلقائياً — لا تطلب منه روابط أبداً. الافتراضي دائماً إضافة للصور الموجودة وليس استبدالها.`}

أجب دائماً باللغة العربية بشكل واضح ومنظم.`
  : `أنت مساعد ذكي لمنصة سوق لينك. ساعد المستخدم في البحث عن المنتجات والمتاجر.
أجب دائماً باللغة العربية بشكل واضح ومختصر.`;

  // Build user message content (text + optional images)
  const userContent: any[] = [];
  if (images?.length) {
    for (const img of images) {
      userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
  }
  userContent.push({ type: "text", text: message });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // Get tools from the correct MCP server based on role
    const tools = role === "merchant"
      ? await getMerchantTools()
      : await getTools(role);

    const chatMessages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];

    // Pre-upload any attached images ONCE before the agentic loop.
    // Caching prevents re-uploading on every Claude tool-call retry.
    // null = not yet uploaded this request.
    let preUploadedUrls: string[] | null = null;
    let preUploadProductId: string | null = null; // UUID generated for add_product
    let preUploadIsReplace = false;
    let preExistingUrls: string[] = []; // existing image_urls before update (for merge)

    // ── Helpers ─────────────────────────────────────────────────────────────
    /** Extract the storage folder UUID from a product-images public URL. */
    function extractStorageFolder(url: string): string | null {
      try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const bucketIdx = parts.indexOf('product-images');
        if (bucketIdx !== -1 && parts[bucketIdx + 1]) {
          return decodeURIComponent(parts[bucketIdx + 1]);
        }
      } catch {
        const match = url.match(/product-images\/([^/?#]+)\//);
        if (match) return match[1];
      }
      return null;
    }

    // Agentic loop: Claude → tool call → MCP executes → back to Claude → final answer
    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages: chatMessages,
      });

      chatMessages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            console.log(`[chat] Claude calling tool: ${block.name}`, block.input);
            try {
              let result: string;

              if (role === "merchant") {
                const input: Record<string, any> = { ...(block.input as Record<string, any>), sb_auth_token };

                // ── Image injection for add_product ──────────────────────────
                // The server pre-uploads images, generates the product UUID (used as
                // the storage folder), and injects both into the tool call so that
                // the DB row id matches the storage folder path.
                const isAddTool    = block.name === "add_my_product" || block.name === "add_product" || block.name === "create_product";
                const isUpdateTool = block.name === "update_my_product" || block.name === "update_product";

                if (images?.length && isAddTool) {
                  if (preUploadedUrls === null) {
                    preUploadProductId = randomUUID();
                    preUploadedUrls = [];
                    for (let i = 0; i < images.length; i++) {
                      const dataUrl = `data:${images[i].mediaType};base64,${images[i].base64}`;
                      const url = await uploadImage(dataUrl, preUploadProductId, i);
                      if (url) preUploadedUrls.push(url);
                    }
                    console.log(`[chat] add_product: uploaded ${preUploadedUrls.length}/${images.length} image(s) to folder "${preUploadProductId}"`);
                  } else {
                    console.log(`[chat] add_product: reusing cached uploads (${preUploadedUrls.length})`);
                  }
                  // Always inject — tool rejects if image_urls is empty.
                  input.product_id = preUploadProductId;
                  input.image_urls = preUploadedUrls;
                }

                // ── Image injection for update_product ───────────────────────
                // The supabase tools use field "id" (not "product_id") and expect
                // image_urls as a full merged array — there is no append_image_urls.
                if (images?.length && isUpdateTool) {
                  // Normalise: Claude may send product_id but the tool schema uses id.
                  if (input.product_id && !input.id) {
                    input.id = input.product_id;
                    delete input.product_id;
                  }
                  // Strip any fake/hallucinated URLs Claude put in these fields.
                  delete input.image_urls;
                  delete input.append_image_urls;
                  delete input.replace_images;

                  const isReplaceMode = input.replace_images_flag === true;
                  delete input.replace_images_flag;

                  const productId = input.id as string | undefined;

                  if (preUploadedUrls === null) {
                    preUploadIsReplace = isReplaceMode;

                    let storageFolder: string = productId ?? randomUUID();
                    let startIndex = 0;

                    if (productId) {
                      const { data: productRow } = await supabase
                        .from("products")
                        .select("image_urls")
                        .eq("id", productId)
                        .maybeSingle();

                      const existingUrls: string[] = productRow?.image_urls ?? [];
                      preExistingUrls = existingUrls;

                      if (existingUrls.length > 0) {
                        const extracted = extractStorageFolder(existingUrls[0]);
                        if (extracted) storageFolder = extracted;
                      }

                      console.log(`[chat] update_product: storage folder = "${storageFolder}", existing images = ${existingUrls.length}`);

                      const { data: existingFiles } = await supabase.storage
                        .from("product-images")
                        .list(storageFolder);
                      const existing = existingFiles ?? [];

                      if (isReplaceMode && existing.length > 0) {
                        const paths = existing.map((f: any) => `${storageFolder}/${f.name}`);
                        await supabase.storage.from("product-images").remove(paths);
                        preExistingUrls = [];
                        startIndex = 0;
                      } else {
                        const maxIdx = existing.reduce((max: number, f: any) => {
                          const n = parseInt(f.name.split('.')[0], 10);
                          return isNaN(n) ? max : Math.max(max, n);
                        }, -1);
                        startIndex = maxIdx + 1;
                        console.log(`[chat] update_product: startIndex=${startIndex}`);
                      }
                    }

                    preUploadedUrls = [];
                    for (let i = 0; i < images.length; i++) {
                      const dataUrl = `data:${images[i].mediaType};base64,${images[i].base64}`;
                      const url = await uploadImage(dataUrl, storageFolder, startIndex + i);
                      if (url) preUploadedUrls.push(url);
                    }
                    console.log(`[chat] update_product: uploaded ${preUploadedUrls.length}/${images.length} image(s) to storage`);
                  } else {
                    console.log(`[chat] update_product: reusing cached uploads (${preUploadedUrls.length})`);
                  }

                  // Inject the full merged list — supabase update_product takes image_urls directly.
                  if (preUploadedUrls.length > 0) {
                    input.image_urls = preUploadIsReplace
                      ? preUploadedUrls
                      : [...preExistingUrls, ...preUploadedUrls];
                  }
                }

                result = await callMerchantTool(block.name, input);
              } else {
                result = await callTool(block.name, block.input as Record<string, any>);
              }

              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
            } catch (err: any) {
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `خطأ: ${err.message}`, is_error: true });
            }
          }
        }

        chatMessages.push({ role: "user", content: toolResults });

      } else {
        // Claude has the final answer — stream it to the chatbot
        const finalText = response.content.find(b => b.type === "text")?.text ?? "لم أفهم الطلب.";

        const stream = anthropic.messages.stream({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [...chatMessages.slice(0, -1), { role: "user", content: `اعرض الإجابة التالية بشكل جميل ومنظم باللغة العربية:\n${finalText}` }],
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
        break;
      }
    }

  } catch (err: any) {
    console.error("[/api/chat] error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
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
