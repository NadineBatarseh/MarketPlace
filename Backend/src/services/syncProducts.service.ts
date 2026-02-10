import { supabase } from "../supabase";

export async function syncProductsForShop(shopId: string) {
  // 1) Get merchant_id from shops
  const { data: shopRow, error: shopErr } = await supabase
    .from("shops")
    .select("merchant_id")
    .eq("shop_id", shopId)
    .single();

  if (shopErr || !shopRow?.merchant_id) {
    throw new Error("No merchant_id linked to this shop_id in shops table");
  }

  const merchantId = shopRow.merchant_id;

  // 2) Get merchant credentials
  const { data: merchant, error: merchantErr } = await supabase
    .from("merchants")
    .select("id, catalog_id, access_token, token_type, expires_at")
    .eq("id", merchantId)
    .single();

  if (merchantErr || !merchant) {
    throw new Error("No merchant credentials found for this shop");
  }

  const catalogId = merchant.catalog_id;
  const accessToken = merchant.access_token;

  if (!catalogId || !accessToken) {
    throw new Error("Merchant row is missing catalog_id or access_token");
  }

  if (merchant.expires_at && new Date(merchant.expires_at) <= new Date()) {
    throw new Error("Access token is expired. Reconnect Meta.");
  }

  const parsePrice = (val: any): number | null => {
    if (val == null) return null;
    let s = String(val).trim();
    s = s.replace(/[^\d.,-]/g, "");
    if (!s) return null;

    const hasDot = s.includes(".");
    const hasComma = s.includes(",");

    if (hasComma && !hasDot) s = s.replace(",", ".");
    else if (hasComma && hasDot) s = s.replace(/,/g, "");

    const num = Number(s);
    return Number.isFinite(num) ? num : null;
  };

  const stockFromAvailability = (availability: any): number => {
    const a = String(availability ?? "").toLowerCase();
    if (a.includes("in stock") || a.includes("available")) return 1;
    if (a.includes("out of stock") || a.includes("unavailable")) return 0;
    return 0;
  };

  const url = new URL(`https://graph.facebook.com/v19.0/${catalogId}/products`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,description,price,availability,image_url");

  const metaRes = await fetch(url.toString());
  const metaData = await metaRes.json();

  if (!metaRes.ok) {
    throw new Error(`Meta API error: ${JSON.stringify(metaData)}`);
  }

  const products = metaData?.data ?? [];

  // 🔧 FIX: Filter out products without names and log them
  const skippedProducts: any[] = [];
  const validProducts = products.filter((p: any) => {
    if (!p.name || String(p.name).trim() === "") {
      skippedProducts.push({ id: p.id, reason: "Missing name/title" });
      return false;
    }
    return true;
  });

  console.log(`✅ Valid products: ${validProducts.length}`);
  if (skippedProducts.length > 0) {
    console.log(`⚠️  Skipped ${skippedProducts.length} products with missing titles:`, skippedProducts);
  }

  const rows = validProducts.map((p: any) => {
    const parsedPrice = parsePrice(p.price);

    const row: any = {
      shop_id: shopId,
      meta_product_id: p.id,
      title: p.name.trim(), // ✅ Now guaranteed to exist
      description: p.description ?? null,
      image_url: p.image_url ?? null,
      stock_Quantity: stockFromAvailability(p.availability),
    };

    if (parsedPrice != null) row.price = parsedPrice;
    return row;
  });

  if (rows.length === 0) {
    return {
      shopIdUsed: shopId,
      merchantIdUsed: merchantId,
      productsFetched: products.length,
      savedToDb: 0,
      skipped: skippedProducts.length,
      message: "No valid products to sync (all missing titles)",
    };
  }

  const { error } = await supabase
    .from("products")
    .upsert(rows, { onConflict: "shop_id,meta_product_id" });

  if (error) throw new Error(error.message);

  return {
    shopIdUsed: shopId,
    merchantIdUsed: merchantId,
    productsFetched: products.length,
    savedToDb: rows.length,
    skipped: skippedProducts.length,
  };
}