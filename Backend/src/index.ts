import express from "express";
import cors from "cors";
import "dotenv/config";
import type { Request, Response } from "express";
import { supabase } from "./supabase";
import { syncProductsForShop } from "./services/syncProducts.service";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors());

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
    const shopId = (req.body?.shop_id as string) || process.env.DEFAULT_SHOP_ID;

    if (!shopId) {
      return res.status(400).json({
        ok: false,
        error: "Missing shop_id. Send it in body or set DEFAULT_SHOP_ID in .env",
      });
    }

    const result = await syncProductsForShop(shopId);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("SYNC ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message ?? "Server error" });
  }
});

/* ---------- META WEBHOOK EVENTS (POST) ---------- */
app.post("/webhooks/meta", (req: Request, res: Response) => {
  console.log("📩 Meta webhook event received");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));

  // Respond quickly to Meta (they expect 200 within 20 seconds)
  res.sendStatus(200);

  // Process the webhook data asynchronously
  try {
    const entry = req.body?.entry?.[0];
    if (entry?.changes) {
      console.log("📦 Changes detected:", entry.changes);
      
      // Extract the value data
      const change = entry.changes[0];
      if (change?.field === "items_batch" || change?.field === "product_feed") {
        console.log("🔄 Catalog change detected - would trigger sync here");
        // TODO: Trigger your sync logic here
        // Example: syncProductsForShop(shopId);
      }
    }
  } catch (err) {
    console.error("Error processing webhook:", err);
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
/* ---------- META WEBHOOK (VERIFY) ---------- */
app.get("/webhooks/meta", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    // Meta expects plain text challenge back
    return res.status(200).send(String(challenge));
  }

  return res.sendStatus(403);
});
