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

/* ---------- CHAT (Claude) ---------- */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, role } = req.body as { message: string; role: string };

  if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

  try {
    const systemPrompt = `أنت مساعد ذكي لمنصة سوق لينك.
دورك: ${role === "merchant" ? "مساعدة التاجر في إدارة متجره ومنتجاته وطلباته" : "مساعدة المستخدم"}.
أجب دائماً باللغة العربية بشكل واضح ومختصر.
إذا طُلب منك عمل يتعلق بالمنتجات أو الطلبات، اشرح ما يمكنك فعله.`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "لم أفهم الطلب.";
    return res.json({ ok: true, reply });
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