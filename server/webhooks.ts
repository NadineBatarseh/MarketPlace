import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { supabase } from "./supabase.js";

const router = Router();

/* ──────────────────────────────────────────
   GET /webhook  — Meta verification challenge
   Meta hits this once when you register the webhook URL.
   It sends hub.verify_token; we echo hub.challenge back.
────────────────────────────────────────── */
router.get("/", (req: Request, res: Response) => {
  const mode      = req.query["hub.mode"]         as string;
  const token     = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"]    as string;

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Meta webhook verified");
    return res.set("Cache-Control", "no-store").status(200).send(challenge);
  }

  console.warn("⚠️  Webhook verification failed — token mismatch");
  return res.sendStatus(403);
});

/* ──────────────────────────────────────────
   Signature middleware
   Every POST from Meta is signed with your APP_SECRET.
   We verify it here before touching the payload.
   NOTE: req.body must be the raw Buffer (express.raw middleware),
   so this router must be mounted BEFORE app.use(express.json()).
────────────────────────────────────────── */
function verifySignature(req: Request, res: Response, next: NextFunction) {
  const sig = req.headers["x-hub-signature-256"] as string | undefined;

  if (!sig) {
    console.warn("⚠️  Missing x-hub-signature-256 header");
    return res.sendStatus(401);
  }

  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("META_APP_SECRET is not set");
    return res.sendStatus(500);
  }

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", secret)
      .update(req.body as Buffer)
      .digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    console.warn("⚠️  Invalid webhook signature");
    return res.sendStatus(403);
  }

  // Parse the raw buffer into JSON for the handler
  req.body = JSON.parse((req.body as Buffer).toString("utf8"));
  next();
}

/* ──────────────────────────────────────────
   POST /webhook  — incoming Meta events
────────────────────────────────────────── */
router.post("/", verifySignature, async (req: Request, res: Response) => {
  // Always ack immediately — Meta will retry if we don't respond within 20 s
  res.sendStatus(200);

  const body = req.body as MetaWebhookPayload;
  console.log("[Webhook] object:", body.object);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (body.object === "catalog") {
        await handleCatalogChange(change);
      } else if (change.field === "orders") {
        await handleOrderChange(change.value);
      }
    }
  }
});

/* ──────────────────────────────────────────
   Catalog change handler
   Fired when a product is created / updated / deleted in Meta catalog.
────────────────────────────────────────── */
async function handleCatalogChange(change: WebhookChange) {
  const { field, value } = change;
  console.log("[Catalog] field:", field, "| value:", JSON.stringify(value));

  if (!value?.retailer_id && !value?.item_id) return;

  const metaId: string = value.item_id ?? value.retailer_id;

  if (field === "product_item_deleted") {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("meta_product_id", metaId);

    if (error) console.error("[Catalog] delete error:", error.message);
    else console.log(`[Catalog] deleted product ${metaId}`);
    return;
  }

  // For created / updated — upsert what Meta sent
  const row: Record<string, unknown> = {
    meta_product_id: metaId,
    shop_id: process.env.SHOP_ID ?? null,
    updated_at: new Date().toISOString(),
  };

  if (value.name)        row.title       = value.name;
  if (value.description) row.description = value.description;
  if (value.price)       row.price       = parseFloat(value.price);
  if (value.image_url)   row.image_urls  = [value.image_url];

  const { error } = await supabase
    .from("products")
    .upsert(row, { onConflict: "meta_product_id" });

  if (error) console.error("[Catalog] upsert error:", error.message);
  else console.log(`[Catalog] upserted product ${metaId}`);
}

/* ──────────────────────────────────────────
   Order change handler
   Fired when an order is placed / updated through Facebook / Instagram Shop.
────────────────────────────────────────── */
async function handleOrderChange(order: any) {
  if (!order?.id) {
    console.warn("[Order] received payload without id:", order);
    return;
  }

  console.log("[Order] id:", order.id, "| status:", order.order_status?.state);

  const { error } = await supabase
    .from("orders")
    .upsert(
      {
        meta_order_id:  order.id,
        status:         order.order_status?.state ?? "unknown",
        buyer_details:  order.buyer_details  ?? null,
        items:          order.items          ?? null,
        channel:        order.channel        ?? null,
        raw:            order,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: "meta_order_id" }
    );

  if (error) console.error("[Order] upsert error:", error.message);
  else console.log(`[Order] saved order ${order.id}`);
}

/* ──────────────────────────────────────────
   Types (minimal — extend as needed)
────────────────────────────────────────── */
interface MetaWebhookPayload {
  object: string;
  entry?: WebhookEntry[];
}
interface WebhookEntry {
  id: string;
  changes?: WebhookChange[];
}
interface WebhookChange {
  field: string;
  value: any;
}

export default router;
