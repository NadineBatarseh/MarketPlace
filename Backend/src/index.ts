import express from "express";
import cors from "cors";
import "dotenv/config";
import type { Request, Response } from "express";
import { supabase } from "./supabase";

const app = express();

app.use(express.json());
app.use(cors({ origin: "http://localhost:5173" }));

/* ---------- BASIC ROUTES ---------- */

app.get("/", (req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "Backend is running (TS)",
    hint: "Try /health or /sync-products",
  });
});

app.get("/health", (req: Request, res: Response) => {
  res.json({ ok: true, message: "Backend is running (TS)" });
});

/* ---------- SYNC PRODUCTS ---------- */

app.post("/sync-products", async (req: Request, res: Response) => {
  try {
    const catalogId = process.env.META_CATALOG_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    // 1️⃣ Validate env variables
    if (!catalogId || !accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing META_CATALOG_ID or META_ACCESS_TOKEN in .env",
      });
    }

    // 2️⃣ Build Meta API URL
    const url = new URL(
      `https://graph.facebook.com/v19.0/${catalogId}/products`
    );
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set(
      "fields",
      "id,retailer_id,name,price,availability,image_url"
    );

    // 3️⃣ Fetch products from Meta
    const metaRes = await fetch(url.toString());
    const metaData = await metaRes.json();

    if (!metaRes.ok) {
      return res.status(metaRes.status).json({
        ok: false,
        metaError: metaData,
      });
    }

    // 4️⃣ Extract products
    const products = metaData?.data ?? [];

    // 5️⃣ Convert Meta products → DB rows
    const rows = products.map((p: any) => ({
      meta_product_id: p.id,
      retailer_id: p.retailer_id ?? null,
      name: p.name ?? null,
      price: p.price ?? null,
      availability: p.availability ?? null,
      image_url: p.image_url ?? null,
    }));

    // 6️⃣ Save to Supabase (UPSERT = no duplicates)
    const { error } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "meta_product_id" });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    // 7️⃣ Final response
    return res.json({
      ok: true,
      productsFetched: products.length,
      savedToDb: rows.length,
    });
  } catch (err) {
    console.error("SYNC ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

/* ---------- START SERVER ---------- */
app.get("/products", async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, products: data });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`✅ Backend listening on http://localhost:${PORT}`)
);
