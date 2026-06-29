import express from "express";
import cors from "cors";
import "dotenv/config";
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getTools, callTool } from "./mcpClient.js";
import { fileURLToPath } from "url";
import path from "path";
import { supabase } from "./supabase.js";
import { uploadImage } from "./uploadImage.js";
import { randomUUID } from "crypto";
import webhookRouter from "./webhooks.js";
import searchRouter from "./search/searchRouter.js";
import productUploadRouter from "./routes/productUploadRouter.js";
import metaCatalogRouter from "./routes/metaCatalogAPIRouter.js";
import productCRUDRouter from "./routes/productCRUDRouter.js";
import supabaseProductWebhookRouter from "./routes/supabaseProductWebhookRouter.js";
import instagramAuthRouter from "./routes/instagramAuthRouter.js";
import applicationUploadRouter from "./routes/applicationUploadRouter.js";
import adminArchiveRouter from "./routes/adminArchiveRouter.js";
import synonymsAdminRouter from "./routes/synonymsAdminRouter.js";
import paytabsRouter from "./routes/paytabsRouter.js";
import payoutOnboardingRouter from "./routes/payoutOnboardingRouter.js";
import payoutAdminRouter from "./routes/payoutAdminRouter.js";
import ordersRouter from "./routes/ordersRouter.js";
import profileRouter from "./routes/profileRouter.js";
import customerTrackingEventsRouter from "./routes/customerTrackingEventsRouter.js";
import adminDeliveryIssuesRouter from "./routes/adminDeliveryIssuesRouter.js";
import courierWorkSessionsRouter from "./routes/courierWorkSessionsRouter.js";
import adminCourierStatsRouter from "./routes/adminCourierStatsRouter.js";
import adminBatchesRouter from "./routes/adminBatchesRouter.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { logisticsRouter, bootstrapLogistics } from "./logistics/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:4000",
    "https://souq-link.com",
    "https://www.souq-link.com",
  ],
}));

// Webhook must be mounted with raw body BEFORE express.json(),
// because signature verification needs the unparsed buffer.
app.use("/webhook", express.raw({ type: "application/json" }), webhookRouter);

app.use(express.json({ limit: '10mb' }));
// PayTabs posts its browser `return` redirect as application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: true }));

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
  const { message, role, sb_auth_token, images, history } = req.body as {
    message: string;
    role: string;
    sb_auth_token?: string;
    images?: { base64: string; mediaType: string }[];
    history?: { role: string; text: string }[];
  };

  if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

  // Resolve merchant shop_id + Instagram token from their auth token
  let merchant_shop_id: string | undefined;
  let merchant_instagram_token: string | undefined;
  let merchant_instagram_account_id: string | undefined;
  let merchant_user_id: string | undefined;

  if (role === "merchant" && sb_auth_token) {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(sb_auth_token);
      console.log(`[chat] getUser → user=${user?.id ?? "null"} error=${authError?.message ?? "none"}`);
      if (user) {
        merchant_user_id = user.id;
        const [shopResult, igResult] = await Promise.allSettled([
          supabase.from("shops").select("shop_id, merchants!inner(user_id)").eq("merchants.user_id", user.id).maybeSingle(),
          supabase.from("instagram_connections")
            .select("access_token, instagram_account_id")
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);

        if (shopResult.status === "fulfilled") merchant_shop_id = shopResult.value.data?.shop_id;
        console.log(`[chat] shop_id=${merchant_shop_id ?? "null"}`);

        if (igResult.status === "fulfilled") {
          const igData = igResult.value.data;
          const igError = igResult.value.error;
          console.log(`[chat] ig token=${igData?.access_token ? "found" : "null"} account_id=${igData?.instagram_account_id ?? "null"} error=${(igError as any)?.message ?? "none"}`);
          if (igData) {
            merchant_instagram_token = igData.access_token;
            merchant_instagram_account_id = igData.instagram_account_id ?? undefined;
          }
        } else {
          console.log(`[chat] ig query rejected:`, igResult.reason);
        }
      }
    } catch (e: any) {
      console.error(`[chat] merchant token fetch threw:`, e.message);
    }
  } else {
    console.log(`[chat] skipping merchant token fetch — role=${role} sb_auth_token=${sb_auth_token ? "present" : "missing"}`);
  }

  const systemPrompt = role === "merchant"
    ? `أنت مساعد ذكي للتاجر على منصة سوق لينك.
جميع العمليات تخص متجر هذا التاجر فقط. معرّف المتجر هو: ${merchant_shop_id ?? "غير متوفر"}.

معلومات مهمة عن المنصة يجب أن تعرفها:
- المنصة تدعم ميزة "المسودات" بشكل كامل. المنتجات المستوردة من انستقرام تُحفظ كمسودات (isPublish = false) ويراجعها التاجر من صفحة المسودات قبل نشرها.
- صفحة المسودات موجودة في لوحة التحكم وتعمل الآن على الرابط: /merchant-dashboard?page=drafts

لديك أدوات جاهزة ومتصلة الآن — استخدمها فوراً دون تردد:
- أدوات قاعدة البيانات: list_products، list_my_products، create_product، update_product، delete_product
- أدوات انستقرام المتصلة والجاهزة: instagram_import_products، instagram_get_profile، instagram_get_account_insights، وغيرها

قواعد صارمة يجب اتباعها:
1. لا تقل أبداً "لا أملك أدوات" أو "لا يمكنني الوصول لانستقرام" أو "النظام لا يدعم المسودات" — كل هذه المزايا موجودة ومفعّلة.
2. لا تطلب من التاجر أي معرّف (ID) أو رابط صورة أو shop_id — استخدم الأدوات للحصول عليها تلقائياً.
3. عند استخدام أي أداة تحتاج shop_id، استخدم القيمة: ${merchant_shop_id ?? "غير متوفر"} تلقائياً.
4. عندما يطلب التاجر عرض منتجاته أو منتجات متجره، استخدم list_my_products مباشرة — لا تطلب shop_id.
5. عندما يذكر التاجر اسم منتج (مثل "حرام شتوي") أو يختار منتجاً برقمه من قائمة عرضتها سابقاً (مثل "1" أو "2")، استخدم list_my_products للحصول على قائمة منتجاته، ثم استخدم الـ UUID الحقيقي من النتيجة في أي أداة تحتاج id — لا تستخدم رقم الترتيب (1, 2, 3) أبداً كـ id.
6. عندما يرفق التاجر صورة مع طلبه: الصورة تُرفع تلقائياً من قِبل السيرفر وتُحقن في أداة update_product أو create_product — لا تطلب رابط الصورة أبداً ولا تسأل عنه.
7. لتحديث صورة منتج موجود: استدعِ list_my_products للحصول على id المنتج، ثم استدعِ update_product بهذا الـ id فقط — الصورة ستُضاف تلقائياً.
8. عندما يطلب التاجر جلب منتجاته من انستقرام، أو استيرادها — استخدم حصراً instagram_import_products مع shop_id. بعد انتهاء الأداة، رد فقط بـ: "تم استيراد [العدد] منتجاً وحفظها كمسودات. راجعها وانشرها من [صفحة المسودات](/merchant-dashboard?page=drafts)." دون عرض أي قائمة منتجات.

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
    const tools = await getTools(role);

    // Build conversation history (last 10 turns to avoid token bloat)
    const historyMessages: Anthropic.MessageParam[] = (history ?? [])
      .slice(-10)
      .filter((m): m is { role: "user" | "assistant"; text: string } =>
        m.role === "user" || m.role === "assistant"
      )
      .map((m) => ({ role: m.role, content: m.text }));

    const chatMessages: Anthropic.MessageParam[] = [
      ...historyMessages,
      { role: "user", content: userContent },
    ];

    // Pre-upload any attached images ONCE before the agentic loop.
    // Caching prevents re-uploading on every Claude tool-call retry.
    // null = not yet uploaded this request.
    let preUploadedUrls: string[] | null = null;
    let preUploadProductId: string | null = null; // UUID generated for add_product
    let preUploadIsReplace = false;
    let preExistingUrls: string[] = []; // existing image_urls before update (for merge)
    let preUploadForProductId: string | null = null; // product ID the update upload was done for

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
                const isAddTool = block.name === "add_my_product" || block.name === "add_product" || block.name === "create_product";
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

                  // Reset cache if Claude retried with a different product ID (e.g. used display
                  // number first, then corrected to the real UUID on a second attempt).
                  if (preUploadedUrls !== null && preUploadForProductId !== productId) {
                    console.log(`[chat] update_product: product ID changed (${preUploadForProductId} → ${productId}), resetting image cache`);
                    preUploadedUrls = null;
                    preExistingUrls = [];
                  }

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
                    preUploadForProductId = productId ?? null;
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

                // Inject merchant's Instagram token for instagram/facebook tools
                const isIgTool = block.name.startsWith("instagram_") || block.name.startsWith("facebook_");
                const toolInput = (isIgTool && merchant_instagram_token)
                  ? {
                    ...input,
                    _instagram_access_token: merchant_instagram_token,
                    _instagram_account_id: merchant_instagram_account_id,
                    _user_id: merchant_user_id,
                  }
                  : input;

                result = await callTool(block.name, toolInput);
              } else {
                // Inject merchant's Instagram token for instagram/facebook tools
                const isIgTool = block.name.startsWith("instagram_") || block.name.startsWith("facebook_");
                const toolInput = (isIgTool && merchant_instagram_token)
                  ? {
                    ...(block.input as Record<string, any>),
                    _instagram_access_token: merchant_instagram_token,
                    _instagram_account_id: merchant_instagram_account_id,
                    _user_id: merchant_user_id,
                  }
                  : block.input as Record<string, any>;

                result = await callTool(block.name, toolInput);
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

/* ---------- APPLICATION DOC UPLOAD (merchant ID / driver docs) ---------- */
app.use("/api/applications", applicationUploadRouter);

/* ---------- PRODUCT BULK UPLOAD ---------- */
app.use("/api/products", productUploadRouter);

/* ---------- META CATALOG SYNC ---------- */
app.use("/api/catalog", metaCatalogRouter);

/* ---------- PRODUCT CRUD (create / delete + auto Meta sync) ---------- */
app.use("/api/products", productCRUDRouter);

/* ---------- SUPABASE DB WEBHOOK (auto-sync on direct DB changes) ---------- */
app.use("/api/webhooks/supabase-products", supabaseProductWebhookRouter);

/* ---------- LOGISTICS ---------- */
app.use('/api/logistics', logisticsRouter);

app.use('/api/admin', adminArchiveRouter);

/* ---------- SEARCH SYNONYMS ADMIN (review / approve / reject) ---------- */
app.use('/api/admin/synonyms', synonymsAdminRouter);

/* ---------- ORDERS (server-authoritative placement) ---------- */
app.use('/api/orders', ordersRouter);

/* ---------- CUSTOMER PROFILE (profile + default shipping address) ---------- */
app.use('/api/profile', profileRouter);

/* ---------- DELIVERY FEEDBACK (customer confirm-received / report-delay) ---------- */
app.use('/api/tracking-events', customerTrackingEventsRouter);

/* ---------- ADMIN: DELIVERY ISSUES (delay-report review queue) ---------- */
app.use('/api/admin/delivery-issues', adminDeliveryIssuesRouter);

/* ---------- COURIER DUTY / MISSION TIME TRACKING ---------- */
app.use('/api/couriers', courierWorkSessionsRouter);

/* ---------- ADMIN: COURIER PERFORMANCE INDICATOR (operational monitoring only) ---------- */
app.use('/api/admin/couriers', adminCourierStatsRouter);

/* ---------- ADMIN: BATCH MANAGEMENT (move/remove shipments, breakdowns, delays, audit log) ---------- */
app.use('/api/admin/batches', adminBatchesRouter);

/* ---------- PAYTABS PAYMENTS (Hosted Payment Page — Test Mode) ---------- */
app.use('/api/payments/paytabs', paytabsRouter);

/* ---------- VENDOR PAYOUT ONBOARDING (merchant self-serve IBAN → PayTabs entity) ---------- */
app.use('/api/payments/payout-onboarding', payoutOnboardingRouter);

/* ---------- VENDOR SETTLEMENT ADMIN (run sweep / batches / reconcile) ---------- */
app.use('/api/payments/payouts', payoutAdminRouter);

/* ---------- DEBUG (remove after fixing) ---------- */

app.get("/api/debug/env-check", (_req: Request, res: Response) => {
  return res.json({
    INSTAGRAM_REDIRECT_URI: process.env.INSTAGRAM_REDIRECT_URI ?? '(not set)',
    FRONTEND_URL: process.env.FRONTEND_URL ?? '(not set)',
    META_APP_ID: process.env.META_APP_ID ?? '(not set)',
    has_META_APP_SECRET: !!process.env.META_APP_SECRET,
    has_SUPABASE_URL: !!process.env.SUPABASE_URL,
    has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
});

app.get("/api/debug/shops", async (_req: Request, res: Response) => {
  const { data, error } = await supabase.from("shops").select("*").limit(10);
  return res.json({ data, error });
});

app.get("/api/debug/instagram-token", async (_req: Request, res: Response) => {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return res.json({ ok: false, error: "INSTAGRAM_ACCESS_TOKEN is not set in .env" });

  try {
    const r = await fetch(`https://graph.facebook.com/v23.0/me/accounts?access_token=${token}`);
    const data: any = await r.json();
    if (data.error) {
      return res.json({ ok: false, apiError: data.error, tokenPrefix: token.slice(0, 20) + "..." });
    }
    const pages = data.data ?? [];
    return res.json({ ok: true, pagesFound: pages.length, pages: pages.map((p: any) => ({ id: p.id, name: p.name })), tokenPrefix: token.slice(0, 20) + "..." });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/debug/test-instagram-import", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: "Missing Authorization header" });

  const sb_auth_token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(sb_auth_token);
  if (authError || !user) return res.status(401).json({ ok: false, error: authError?.message ?? "Invalid token" });

  const [shopResult, igResult] = await Promise.allSettled([
    supabase.from("shops").select("shop_id, merchants!inner(user_id)").eq("merchants.user_id", user.id).maybeSingle(),
    supabase.from("user_social_tokens")
      .select("access_token, instagram_account_id")
      .eq("user_id", user.id)
      .eq("provider", "instagram")
      .maybeSingle(),
  ]);

  const shop_id = shopResult.status === "fulfilled" ? shopResult.value.data?.shop_id : null;
  const igData = igResult.status === "fulfilled" ? igResult.value.data : null;
  const igError = igResult.status === "fulfilled" ? igResult.value.error : null;

  if (!igData?.access_token) {
    return res.json({
      ok: false,
      step: "token_fetch",
      user_id: user.id,
      shop_id,
      ig_token: null,
      ig_account_id: null,
      ig_query_error: (igError as any)?.message ?? null,
      message: "No Instagram token found in user_social_tokens for this user",
    });
  }

  try {
    const rawResult = await callTool("instagram_import_products", {
      shop_id: shop_id ?? "missing",
      _instagram_access_token: igData.access_token,
      _instagram_account_id: igData.instagram_account_id ?? undefined,
    });
    return res.json({
      ok: true,
      step: "tool_called",
      user_id: user.id,
      shop_id,
      ig_account_id: igData.instagram_account_id,
      raw_result: JSON.parse(rawResult),
    });
  } catch (err: any) {
    return res.json({
      ok: false,
      step: "tool_error",
      user_id: user.id,
      shop_id,
      ig_account_id: igData.instagram_account_id,
      error: err.message,
    });
  }
});

/* ---------- STORE PAGE API ---------- */

// GET /api/stores/:id  — fetch a single shop by its shop_id
app.get("/api/stores/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const { data: store, error } = await supabase
    .from("shops")
    .select("shop_id, name, description, shopLogo, created_at, whatsapp, instagram, facebook, location")
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

  // Fetch ratings separately to avoid relying on a FK join
  const { data: ratingRow } = await supabase
    .from("shop_ratings")
    .select("avg_rating, review_count")
    .eq("shop_id", id)
    .maybeSingle();

  const avg_rating = ratingRow?.avg_rating ?? null;
  const review_count = ratingRow?.review_count ?? 0;

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
  const old_avg = parseFloat(current?.avg_rating ?? '0') || 0;
  const review_count = old_count + 1;
  const avg_rating = (old_avg * old_count + rating) / review_count;

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
    rating: { column: "avg_rating", ascending: false },
    best_selling: { column: "total_sold", ascending: false },
  };
  const { column: orderCol, ascending } = sortMap[sort] ?? sortMap["default"];

  const table =
    sort === "rating" ? "products_with_avg_rating" :
      sort === "best_selling" ? "products_with_sales" :
        "products";

  // Fetch products + total count in parallel
  const [{ data: products, error: prodErr }, { count, error: countErr }] =
    await Promise.all([
      supabase
        .from(table)
        .select("id, title, description, price, image_urls, stock_Quantity")
        .eq("shop_id", shop.shop_id)
        .eq("isPublish", true)
        .order(orderCol, { ascending })
        .range(offset, offset + limit - 1),

      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shop.shop_id)
        .eq("isPublish", true),
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
  const { data: shops, error: shopsErr } = await supabase
    .from("shops")
    .select("shop_id, name, shopLogo, location")
    .order("created_at", { ascending: false });

  if (shopsErr) {
    console.error("[/api/stores] shops query failed:", shopsErr.message);
    return res.status(500).json({ ok: false, error: shopsErr.message });
  }

  // Fetch ratings separately to avoid relying on a FK join
  const { data: ratings } = await supabase
    .from("shop_ratings")
    .select("shop_id, avg_rating, review_count");

  const ratingsMap = new Map(
    (ratings ?? []).map((r: any) => [r.shop_id, r])
  );

  const mapped = (shops ?? []).map((s: any) => ({
    shop_id: s.shop_id,
    name: s.name,
    shopLogo: s.shopLogo,
    location: s.location,
    avg_rating: ratingsMap.get(s.shop_id)?.avg_rating ?? null,
    review_count: ratingsMap.get(s.shop_id)?.review_count ?? 0,
  }));

  const top11 = mapped
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
    .slice(0, 11);

  return res.json({ ok: true, stores: top11 });
});

/* ---------- ACTIVATE ACCOUNT ---------- */

app.post("/api/activate", async (req: Request, res: Response) => {
  const { platformEmail, password } = req.body as { platformEmail: string; password: string };

  if (!platformEmail || !password) {
    return res.status(400).json({ ok: false, error: "Missing email or password" });
  }

  // 1. Find approved application (merchant → delivery)
  let applicantName: string | null = null;
  let role: "merchant" | "delivery" = "merchant";

  const { data: merchantApp } = await supabase
    .from("merchant_applications")
    .select("name_of_owner, name_of_store, email, phone_number, \"Type_of_store\", description, city, zone_id, pictures, id_front_url, id_back_url")
    .eq("platform_email", platformEmail.trim())
    .eq("status", "approved")
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deliveryApp: any = null;

  if (merchantApp) {
    applicantName = merchantApp.name_of_owner;
    role = "merchant";
  } else {
    const { data: dApp } = await supabase
      .from("delivery_applications")
      .select("name, phone_number, email, type_of_vehicle, id_front_url, id_back_url, license_front_url, license_back_url")
      .eq("platform_email", platformEmail.trim())
      .eq("status", "approved")
      .maybeSingle();
    deliveryApp = dApp;

    if (deliveryApp) {
      applicantName = deliveryApp.name;
      role = "delivery";
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

  // 4a. For delivery: populate the couriers row with the applicant's documents.
  // A DB trigger already creates a bare courier row when the Users row above is
  // inserted, using the auth user id as the courier's primary key (id) — it sets
  // a default location but leaves user_id and the document URLs unset. So we
  // UPDATE that row (matched by id = userId) rather than inserting a new one
  // (a plain insert fails the NOT NULL "location" constraint). As a safety net,
  // if no such row exists we insert one with the trigger's defaults.
  if (role === "delivery" && deliveryApp) {
    const courierDocs = {
      user_id: userId,
      name: deliveryApp.name,
      id_front_url: deliveryApp.id_front_url ?? null,
      id_back_url: deliveryApp.id_back_url ?? null,
      license_front_url: deliveryApp.license_front_url ?? null,
      license_back_url: deliveryApp.license_back_url ?? null,
    };

    const { data: updated, error: updateError } = await supabase
      .from("couriers")
      .update(courierDocs)
      .eq("id", userId)
      .select("id");

    if (updateError) {
      console.error("[/api/activate] courier row update failed:", updateError.message);
    } else if (!updated || updated.length === 0) {
      const { error: insertCourierError } = await supabase
        .from("couriers")
        .insert({
          id: userId,
          status: "offline",
          location: { lat: 31.9038, lng: 35.2034 },
          home_base: { lat: 31.9038, lng: 35.2034 },
          home_base_zone: "Ramallah",
          ...courierDocs,
        });
      if (insertCourierError) {
        console.error("[/api/activate] courier row insert failed:", insertCourierError.message);
      }
    }
  }

  // 4b. For merchants: create the merchant row (owner personal info)
  let merchantRowId: string | null = null;
  if (role === "merchant" && merchantApp) {
    const { data: merchantRow, error: merchantError } = await supabase
      .from("merchants")
      .insert({
        user_id: userId,
        owner_name: merchantApp.name_of_owner,
        phone_number: merchantApp.phone_number != null ? String(merchantApp.phone_number) : null,
        owner_email: merchantApp.email,
        pictures: merchantApp.pictures ?? null,
        id_front_url: merchantApp.id_front_url ?? null,
        id_back_url: merchantApp.id_back_url ?? null,
      })
      .select("id")
      .single();
    if (merchantError) {
      console.error("[/api/activate] merchant row creation failed:", merchantError.message);
      return res.status(500).json({ ok: false, error: "merchant insert failed: " + merchantError.message });
    }
    merchantRowId = merchantRow.id;
  }

  // 5. For merchants: create the shop row (store details)
  if (role === "merchant" && merchantApp) {
    const { error: shopError } = await supabase.from("shops").insert({
      merchant_id: merchantRowId,
      name: merchantApp.name_of_store ?? applicantName,
      Type_of_store: merchantApp.Type_of_store ?? null,
      description: merchantApp.description ?? null,
      location: merchantApp.city ?? null,
      zone_id: merchantApp.zone_id ?? null,
    });
    if (shopError) {
      console.error("[/api/activate] shop creation failed:", shopError.message);
    }
  }

  return res.json({ ok: true });
});

/* ---------- INSTAGRAM AUTH ---------- */
app.use("/auth/instagram", instagramAuthRouter);
app.use("/api/instagram", instagramAuthRouter);

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

/* ---------- ADMIN: shop owner info (service-role, bypasses RLS) ---------- */

app.get("/api/admin/shop-owners", requireAdmin, async (req: Request, res: Response) => {
  const raw = req.query.merchantIds as string | undefined;
  if (!raw) return res.json({ ok: true, owners: {} });

  const merchantIds = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (merchantIds.length === 0) return res.json({ ok: true, owners: {} });

  // Fetch merchants using service-role client (bypasses RLS)
  const { data: merchantRows, error: mErr } = await supabase
    .from("merchants")
    .select("id, user_id, owner_name, phone_number, owner_email, id_front_url, id_back_url")
    .in("id", merchantIds);

  if (mErr) return res.status(500).json({ ok: false, error: mErr.message });

  const owners: Record<string, {
    user_id: string | null;
    owner_name: string | null;
    phone_number: string | null;
    owner_email: string | null;
    id_front_url: string | null;
    id_back_url: string | null;
  }> = {};

  for (const m of merchantRows ?? []) {
    owners[m.id] = {
      user_id: m.user_id ?? null,
      owner_name: m.owner_name ?? null,
      phone_number: m.phone_number ? String(m.phone_number) : null,
      owner_email: m.owner_email ?? null,
      id_front_url: m.id_front_url ?? null,
      id_back_url: m.id_back_url ?? null,
    };
  }

  // Fill missing owner_name from Users table when merchants.owner_name is null
  const userIds = (merchantRows ?? []).filter(m => !m.owner_name && m.user_id).map(m => m.user_id!);
  if (userIds.length > 0) {
    const { data: userRows } = await supabase.from("Users").select("user_id, name, email").in("user_id", userIds);
    const userMap: Record<string, { name: string | null; email: string | null }> = {};
    for (const u of userRows ?? []) userMap[u.user_id] = { name: u.name ?? null, email: u.email ?? null };

    for (const m of merchantRows ?? []) {
      if (!owners[m.id].owner_name && m.user_id && userMap[m.user_id]) {
        owners[m.id].owner_name = userMap[m.user_id].name;
        owners[m.id].owner_email = owners[m.id].owner_email ?? userMap[m.user_id].email;
      }
    }
  }

  return res.json({ ok: true, owners });
});

/* ---------- SERVE FRONTEND (production only) ---------- */

if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
  const distPath = path.join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

/* ---------- START ---------- */

const PORT = Number(process.env.PORT) || 4000;

function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    bootstrapLogistics().catch(e => console.error('[Logistics] bootstrap failed:', e));
  });

  server.on('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${PORT} is in use — killing existing process and retrying…`);
      try {
        const { execSync } = await import('child_process');
        execSync(`npx kill-port ${PORT}`, { stdio: 'ignore' });
      } catch { }
      setTimeout(startServer, 1500);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
