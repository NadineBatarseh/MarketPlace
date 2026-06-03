import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import { supabase } from "../supabase.js";

const router = Router();

// Accept any file type — we validate manually below
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                     */
/* ------------------------------------------------------------------ */

/** Upload a raw Buffer (local file) directly to Supabase Storage */
async function storeImageFromBuffer(
  buffer: Buffer,
  contentType: string,
  productId: string,
  index: number
): Promise<string | null> {
  try {
    const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
    const path = `${productId}/${index}.${ext}`;

    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, buffer, { contentType, upsert: true });

    if (error) {
      console.warn(`[upload] storage upload failed:`, error.message);
      return null;
    }

    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/** Fetch an external URL and upload to Supabase Storage */
async function storeImageFromUrl(
  externalUrl: string,
  productId: string,
  index: number
): Promise<string | null> {
  try {
    const res = await fetch(externalUrl);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";

    // Reject anything that is not an image (HTML pages, redirects, etc.)
    if (!contentType.startsWith("image/")) {
      console.warn(`[upload] skipping non-image URL (${contentType}): ${externalUrl}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return storeImageFromBuffer(buffer, contentType, productId, index);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Auth helper                                                         */
/* ------------------------------------------------------------------ */
async function resolveShopId(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Authorization header is required (Bearer token)" });
    return null;
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    res.status(401).json({ ok: false, error: "Invalid or expired session token" });
    return null;
  }

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("shop_id, merchants!inner(user_id)")
    .eq("merchants.user_id", user.id)
    .maybeSingle();

  if (shopErr || !shop) {
    res.status(403).json({ ok: false, error: "No shop is associated with this account" });
    return null;
  }

  return shop.shop_id as string;
}

/* ------------------------------------------------------------------ */
/*  Row parser                                                          */
/* ------------------------------------------------------------------ */
interface ProductRecord {
  title: string;
  price: number;
  image_urls: string[] | null; // filenames OR external URLs — resolved later
  stock_Quantity: number | null;
}

function parseRow(raw: Record<string, unknown>, excelRow: number): { product?: ProductRecord; error?: string } {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    row[k.trim().toLowerCase()] = v;
  }

  const title = String(row["title"] ?? "").trim();
  if (!title) return { error: `Row ${excelRow}: "title" is required` };

  const rawPrice = row["price"];
  const price =
    rawPrice !== undefined && rawPrice !== null
      ? parseFloat(String(rawPrice).replace(/,/g, ""))
      : NaN;
  if (isNaN(price) || price < 0) {
    return { error: `Row ${excelRow}: "price" is missing or invalid (got: ${rawPrice ?? "empty"})` };
  }

  const rawImageVal = row["image_urls"] ?? row["image_url"] ?? row["images"];
  const rawImages =
    rawImageVal !== undefined && rawImageVal !== null
      ? String(rawImageVal).trim()
      : "";
  const image_urls =
    rawImages.length > 0
      ? rawImages.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
      : null;

  const rawQty = row["stock_quantity"] ?? row["stock quantity"] ?? row["quantity"];
  let stock_Quantity: number | null = null;
  if (rawQty !== undefined && rawQty !== null && rawQty !== "") {
    const parsed = parseInt(String(rawQty), 10);
    stock_Quantity = isNaN(parsed) ? null : Math.max(0, parsed);
  }

  return { product: { title, price, image_urls, stock_Quantity } };
}

/* ------------------------------------------------------------------ */
/*  POST /api/products/upload                                           */
/*                                                                      */
/*  Accepts: multipart/form-data                                        */
/*    field "file"    — the Excel file (.xlsx / .xls)                  */
/*    field "images"  — optional image files from the user's desktop   */
/*  Auth: Authorization: Bearer <supabase-access-token>                */
/*                                                                      */
/*  Excel image_urls column accepts:                                    */
/*    • A local filename:   shirt.jpg          (matches uploaded image) */
/*    • An external URL:    https://…/img.jpg  (downloaded & stored)   */
/*    • Multiple values separated by comma or newline                  */
/* ------------------------------------------------------------------ */
router.post(
  "/upload",
  upload.fields([
    { name: "file",   maxCount: 1  },   // Excel
    { name: "images", maxCount: 100 },  // optional local image files
  ]),
  async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;

    // 1. Validate Excel file
    const excelFiles = files?.["file"];
    if (!excelFiles?.length) {
      return res.status(400).json({ ok: false, error: 'No Excel file received in the "file" field.' });
    }
    const excelFile = excelFiles[0];
    const allowedExcel = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (!allowedExcel.includes(excelFile.mimetype)) {
      return res.status(400).json({ ok: false, error: "The uploaded file must be an Excel file (.xlsx or .xls)." });
    }

    // 2. Build a map of uploaded images: filename (lowercase) → multer file
    const imageMap = new Map<string, Express.Multer.File>();
    for (const img of files?.["images"] ?? []) {
      imageMap.set(img.originalname.toLowerCase(), img);
    }

    // 3. Auth
    const shop_id = await resolveShopId(req, res);
    if (!shop_id) return;

    // 4. Parse Excel
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(excelFile.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ ok: false, error: "Could not read the Excel file." });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ ok: false, error: "The Excel file contains no sheets." });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      { defval: null }
    );

    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: "The first sheet has no data rows." });
    }

    console.log("[upload] first row keys:", JSON.stringify(rows[0]));

    // 5. Parse rows
    const valid: ProductRecord[] = [];
    const failures: Array<{ row: number; reason: string }> = [];

    rows.forEach((raw, idx) => {
      const excelRow = idx + 2;
      const { product, error } = parseRow(raw, excelRow);
      if (error) {
        failures.push({ row: excelRow, reason: error });
      } else {
        valid.push(product!);
      }
    });

    // 6. Resolve images → Storage URLs, then insert
    let inserted = 0;

    if (valid.length > 0) {
      const records = await Promise.all(
        valid.map(async (p) => {
          const id = randomUUID();
          let image_urls: string[] | null = null;

          if (p.image_urls && p.image_urls.length > 0) {
            const resolved = await Promise.all(
              p.image_urls.map(async (entry, i) => {
                const isUrl = /^https?:\/\//i.test(entry);

                if (isUrl) {
                  // External URL — fetch and re-upload to Storage
                  return storeImageFromUrl(entry, id, i);
                }

                // Filename — look up in the uploaded images map
                const uploaded = imageMap.get(entry.toLowerCase());
                if (!uploaded) {
                  console.warn(`[upload] image file not found in upload: "${entry}"`);
                  return null;
                }
                return storeImageFromBuffer(uploaded.buffer, uploaded.mimetype, id, i);
              })
            );

            const stored = resolved.filter((u): u is string => u !== null);
            image_urls = stored.length > 0 ? stored : null;
          }

          return { ...p, id, image_urls, shop_id };
        })
      );

      const { data, error: dbErr } = await supabase
        .from("products")
        .insert(records)
        .select("id");

      if (dbErr) {
        return res.status(500).json({
          ok: false,
          error: `Database insert failed: ${dbErr.message}`,
          parseFailures: failures,
        });
      }

      inserted = data?.length ?? valid.length;
    }

    const totalFailed = failures.length;
    return res.status(200).json({
      ok: true,
      summary: `${inserted} product${inserted !== 1 ? "s" : ""} added, ${totalFailed} failed`,
      inserted,
      failed: totalFailed,
      failureDetails: failures,
      _debug: valid.map((p) => ({ title: p.title, image_urls: p.image_urls })),
    });
  }
);

export default router;
