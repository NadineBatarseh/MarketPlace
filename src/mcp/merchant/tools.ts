import  supabase from "../../lib/supabase";

async function resolveShopId(token: string): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error("User not authenticated");
  }

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("shop_id")
    .eq("merchant_id", user.id) // ✅ FIXED
    .maybeSingle();

  if (shopErr) throw new Error(shopErr.message);
  if (!shop) throw new Error("No shop linked to this merchant");

  return shop.shop_id;
}

// ✅ GET PRODUCTS
export async function getMyProducts(token: string) {
  const shop_id = await resolveShopId(token);

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_id", shop_id);

  if (error) throw new Error(error.message);

  return data;
}

// ✅ FIND PRODUCT
export async function findMyProduct(token: string, name: string) {
  const shop_id = await resolveShopId(token);

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_id", shop_id)
    .ilike("name", `%${name}%`);

  if (error) throw new Error(error.message);

  return data;
}

// ✅ ADD PRODUCT
export async function addMyProduct(token: string, product: any) {
  const shop_id = await resolveShopId(token);

  if (!product.image_urls || product.image_urls.length === 0) {
    throw new Error("Product must have images");
  }

  const { data, error } = await supabase
    .from("products")
    .insert([{ ...product, shop_id }])
    .select()
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// ✅ UPDATE PRODUCT
export async function updateMyProduct(token: string, product_id: string, updates: any) {
  const shop_id = await resolveShopId(token);

  const { data: current } = await supabase
    .from("products")
    .select("*")
    .eq("id", product_id)
    .eq("shop_id", shop_id)
    .single();

  if (!current) throw new Error("Product not found");

  // description logic
  if (updates.append_description) {
    updates.description = (current.description || "") + " " + updates.append_description;
    delete updates.append_description;
  }

  // images logic
  if (updates.append_image_urls) {
    updates.image_urls = [
      ...(current.image_urls || []),
      ...updates.append_image_urls,
    ];
    delete updates.append_image_urls;
  }

  const { data, error } = await supabase
    .from("products")
    .update(updates)
    .eq("id", product_id)
    .eq("shop_id", shop_id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// ✅ DELETE PRODUCT
export async function deleteMyProduct(token: string, product_id: string) {
  const shop_id = await resolveShopId(token);

  const { data: product } = await supabase
    .from("products")
    .select("image_urls")
    .eq("id", product_id)
    .eq("shop_id", shop_id)
    .single();

  if (!product) throw new Error("Product not found");

  // delete images from storage
  if (product.image_urls?.length > 0) {
    const first = decodeURIComponent(product.image_urls[0]);
    const match = first.match(/product-images\/([^/]+)\//);

    if (match) {
      const folder = match[1];

      const { data: files } = await supabase.storage
        .from("product-images")
        .list(folder);

      if (files) {
        const paths = files.map((f: { name: string }) => `${folder}/${f.name}`);

        await supabase.storage
          .from("product-images")
          .remove(paths);
      }
    }
  }

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", product_id)
    .eq("shop_id", shop_id);

  if (error) throw new Error(error.message);

  return { success: true };
  
}
export function registerMerchantTools(server: any) {
  // ✅ GET PRODUCTS
  server.tool(
    "get_my_products",
    {},
    async ({ sb_auth_token }: any) => {
      const shop_id = await resolveShopId(sb_auth_token);

      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("shop_id", shop_id);

      if (error) throw new Error(error.message);

      return data;
    }
  );

  // ✅ FIND PRODUCT
  server.tool(
    "find_my_product",
    { name: "string" },
    async ({ name, sb_auth_token }: any) => {
      const shop_id = await resolveShopId(sb_auth_token);

      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("shop_id", shop_id)
        .ilike("name", `%${name}%`);

      if (error) throw new Error(error.message);

      return data;
    }
  );

  // ✅ ADD PRODUCT
  server.tool(
    "add_my_product",
    {},
    async ({ sb_auth_token, ...product }: any) => {
      const shop_id = await resolveShopId(sb_auth_token);

      if (!product.image_urls || product.image_urls.length === 0) {
        throw new Error("Product must have images");
      }

      const { data, error } = await supabase
        .from("products")
        .insert([{ ...product, shop_id }])
        .select()
        .single();

      if (error) throw new Error(error.message);

      return data;
    }
  );

  // ✅ UPDATE PRODUCT
  server.tool(
    "update_my_product",
    {},
    async ({ product_id, sb_auth_token, ...updates }: any) => {
      const shop_id = await resolveShopId(sb_auth_token);

      const { data: current } = await supabase
        .from("products")
        .select("*")
        .eq("id", product_id)
        .eq("shop_id", shop_id)
        .single();

      if (!current) throw new Error("Product not found");

      // description logic
      if (updates.append_description) {
        updates.description =
          (current.description || "") + " " + updates.append_description;
        delete updates.append_description;
      }

      // images logic
      if (updates.append_image_urls) {
        updates.image_urls = [
          ...(current.image_urls || []),
          ...updates.append_image_urls,
        ];
        delete updates.append_image_urls;
      }

      const { data, error } = await supabase
        .from("products")
        .update(updates)
        .eq("id", product_id)
        .eq("shop_id", shop_id)
        .select()
        .single();

      if (error) throw new Error(error.message);

      return data;
    }
  );

  // ✅ DELETE PRODUCT
  server.tool(
    "delete_my_product",
    {},
    async ({ product_id, sb_auth_token }: any) => {
      const shop_id = await resolveShopId(sb_auth_token);

      const { data: product } = await supabase
        .from("products")
        .select("image_urls")
        .eq("id", product_id)
        .eq("shop_id", shop_id)
        .single();

      if (!product) throw new Error("Product not found");

      // delete images
      if (product.image_urls?.length > 0) {
        const first = decodeURIComponent(product.image_urls[0]);
        const match = first.match(/product-images\/([^/]+)\//);

        if (match) {
          const folder = match[1];

          const { data: files } = await supabase.storage
            .from("product-images")
            .list(folder);

          if (files) {
            const paths = files.map(f => `${folder}/${f.name}`);

            await supabase.storage
              .from("product-images")
              .remove(paths);
          }
        }
      }

      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", product_id)
        .eq("shop_id", shop_id);

      if (error) throw new Error(error.message);

      return { success: true };
    }
  );
}