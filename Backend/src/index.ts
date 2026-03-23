/**
 * RESPONSIBILITY:
 * Main backend entry:
 * - Express REST API (products, sync, webhooks, auth)
 * - MCP server (stdio or websocket)
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";

import { supabase } from "./supabase";

import { syncProductsForShop } from "./services/syncProducts.service";
import { MetaService } from "./services/metaService";
import { createMcpServer, connectStdioTransport, connectWebSocketTransport } from "./mcp/server";

const PORT = Number(process.env.PORT) || 4000;
const USE_WEBSOCKET = process.env.USE_WEBSOCKET === "true";

// ------------------- Express App -------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "SouqLink backend is running" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/* ---------- API: products ---------- */
app.get("/api/products", async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, products: data });
});

/* ---------- API: sync products ---------- */
app.post("/api/sync-products", async (req: Request, res: Response) => {
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
    return res.status(500).json({ ok: false, error: err?.message ?? "Server error" });
  }
});

/* ---------- META WEBHOOK VERIFY ---------- */
app.get("/webhooks/meta", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

/* ---------- META WEBHOOK EVENTS ---------- */
app.post("/webhooks/meta", (req: Request, res: Response) => {
  console.log("📩 Meta webhook event received");
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    if (change?.field === "items_batch" || change?.field === "product_feed") {
      console.log("🔄 Catalog change detected - TODO trigger sync");
      // TODO: trigger syncProductsForShop(shopId) when you know which shop
    }
  } catch (err) {
    console.error("Error processing webhook:", err);
  }
});

/* ---------- META AUTH (optional) ---------- */
app.get("/auth/meta", (req, res) => {
  const appId = process.env.META_APP_ID;
  const redirectUri = encodeURIComponent("http://localhost:4000/auth/callback");
  const scopes = encodeURIComponent("catalog_management");
  if (!appId) return res.status(500).send("Missing META_APP_ID in .env");

  const url =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${appId}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${scopes}`;

  res.redirect(url);
});

app.get("/auth/callback", (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).send("No code received from Meta.");
  console.log("✅ Meta returned code:", code);
  return res.redirect("http://localhost:5173");
});

// ------------------- MCP Server -------------------
const metaService = new MetaService(process.env.META_CATALOG_ID!);
const mcpServer = createMcpServer(metaService);

// ------------------- Start -------------------
if (USE_WEBSOCKET) {
  app.use(express.static("public"));
  app.get("/mcp", (_req, res) => res.sendFile("index.html", { root: "public" }));

  app.get("/api/config", (_req, res) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_KEY" });
    }
    return res.json({ supabaseUrl: url, supabaseAnonKey: key });
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`✅ Backend + MCP(WebSocket) on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", async (ws: WebSocket) => {
    await connectWebSocketTransport(mcpServer, ws);
  });
} else {
  app.listen(PORT, () => console.log(`✅ Backend on http://localhost:${PORT}`));
  connectStdioTransport(mcpServer);
}
