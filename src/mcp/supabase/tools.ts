import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "../../../server/supabase.js";

// ── Auth helper ────────────────────────────────────────────────────────────────
// Verifies the Supabase JWT and returns the caller's shop_id.
// Throws if the token is invalid or the user has no shop.
async function resolveShopId(sb_auth_token: string): Promise<string> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser(sb_auth_token);
  if (authErr || !user) throw new Error("Invalid or expired Supabase JWT");

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("shop_id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (shopErr || !shop) throw new Error("No shop is associated with this account");
  return shop.shop_id as string;
}

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerSupabaseTools(server: McpServer) {

  // ── READ: list products ──────────────────────────────────────────────────────
  server.registerTool(
    "list_products",
    {
      description: "List products from the Souq Link marketplace. Supports optional keyword, price, and shop filters.",
      inputSchema: {
        keywords:   z.array(z.string()).optional().describe("Search terms matched against title and description"),
        max_price:  z.number().optional().describe("Maximum price filter"),
        price_sort: z.enum(["asc", "desc"]).optional().describe("Sort by price"),
        shop_id:    z.string().optional().describe("Filter by a specific shop ID"),
        limit:      z.number().optional().describe("Max results to return (default 20)"),
      },
    },
    async (input) => {
      let query = supabase
        .from("products")
        .select("id, title, description, price, image_urls, stock_Quantity, shop_id, shops!inner(name, location)");

      if (input.keywords?.length) {
        const orParts = input.keywords.flatMap(t => [
          `title.ilike.%${t}%`,
          `description.ilike.%${t}%`,
        ]);
        query = query.or(orParts.join(","));
      }
      if (input.shop_id)    query = query.eq("shop_id", input.shop_id);
      if (input.max_price)  query = query.lte("price", input.max_price);
      if (input.price_sort) query = query.order("price", { ascending: input.price_sort === "asc" });

      query = query.limit(input.limit ?? 20);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
    }
  );

  // ── READ: get single product ─────────────────────────────────────────────────
  server.registerTool(
    "get_product",
    {
      description: "Fetch a single product by its ID.",
      inputSchema: { id: z.string().describe("Product UUID") },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("products")
        .select("id, title, description, price, image_urls, stock_Quantity, shop_id, capacity_units")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data)  throw new Error(`Product ${id} not found`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  // ── READ (merchant): list only the caller's own products ────────────────────
  server.registerTool(
    "list_my_products",
    {
      description: "List all products that belong to the currently authenticated merchant. Use this whenever a merchant asks to see their own products. The sb_auth_token is automatically injected by the server — NEVER ask the user for it.",
      inputSchema: {
        sb_auth_token: z.string().optional().describe("Automatically injected by the server. Do NOT ask the user for this value."),
      },
    },
    async ({ sb_auth_token }) => {
      if (!sb_auth_token) throw new Error("Authentication required");
      const shop_id = await resolveShopId(sb_auth_token);

      const { data, error } = await supabase
        .from("products")
        .select("id, title, description, price, image_urls, stock_Quantity, shop_id")
        .eq("shop_id", shop_id)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
    }
  );

  // ── WRITE: create product ────────────────────────────────────────────────────
  server.registerTool(
    "create_product",
    {
      description: "Create a new product in the caller's shop. The sb_auth_token is automatically injected by the server — NEVER ask the user for it.",
      inputSchema: {
        sb_auth_token:  z.string().optional().describe("Automatically injected by the server. Do NOT ask the user for this value."),
        title:          z.string().describe("Product title (required)"),
        price:          z.number().describe("Product price (required, non-negative)"),
        description:    z.string().optional(),
        stock_Quantity: z.number().optional(),
        image_urls:     z.array(z.string()).optional(),
      },
    },
    async ({ sb_auth_token, title, price, description, stock_Quantity, image_urls }) => {
      if (!sb_auth_token) throw new Error("Authentication required");
      const shop_id = await resolveShopId(sb_auth_token);

      const { data, error } = await supabase
        .from("products")
        .insert({
          shop_id,
          meta_product_id: crypto.randomUUID(),
          title: title.trim(),
          description: description?.trim() ?? null,
          price,
          stock_Quantity: stock_Quantity ?? null,
          image_urls: image_urls ?? null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, product: data }) }] };
    }
  );

  // ── WRITE: update product ────────────────────────────────────────────────────
  server.registerTool(
    "update_product",
    {
      description: "Update fields of an existing product. Only the product's owner shop can update it. The sb_auth_token is automatically injected by the server — NEVER ask the user for it.",
      inputSchema: {
        sb_auth_token:  z.string().optional().describe("Automatically injected by the server. Do NOT ask the user for this value."),
        id:             z.string().describe("Product UUID to update"),
        title:          z.string().optional(),
        price:          z.number().optional(),
        description:    z.string().optional(),
        stock_Quantity: z.number().optional(),
        image_urls:     z.array(z.string()).optional(),
      },
    },
    async ({ sb_auth_token, id, ...fields }) => {
      if (!sb_auth_token) throw new Error("Authentication required");
      const shop_id = await resolveShopId(sb_auth_token);

      const updates: Record<string, unknown> = {};
      if (fields.title          !== undefined) updates.title          = fields.title.trim();
      if (fields.price          !== undefined) updates.price          = fields.price;
      if (fields.description    !== undefined) updates.description    = fields.description.trim();
      if (fields.stock_Quantity !== undefined) updates.stock_Quantity = fields.stock_Quantity;
      if (fields.image_urls     !== undefined) updates.image_urls     = fields.image_urls;

      if (Object.keys(updates).length === 0) throw new Error("No fields provided to update");

      const { data, error } = await supabase
        .from("products")
        .update(updates)
        .eq("id", id)
        .eq("shop_id", shop_id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      if (!data)  throw new Error("Product not found or does not belong to this shop");
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, product: data }) }] };
    }
  );

  // ── WRITE: delete product ────────────────────────────────────────────────────
  server.registerTool(
    "delete_product",
    {
      description: "Delete a product from the caller's shop. The sb_auth_token is automatically injected by the server — NEVER ask the user for it.",
      inputSchema: {
        sb_auth_token: z.string().optional().describe("Automatically injected by the server. Do NOT ask the user for this value."),
        id:            z.string().describe("Product UUID to delete"),
      },
    },
    async ({ sb_auth_token, id }) => {
      if (!sb_auth_token) throw new Error("Authentication required");
      const shop_id = await resolveShopId(sb_auth_token);

      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", id)
        .eq("shop_id", shop_id);

      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, deleted_id: id }) }] };
    }
  );

  // ── READ: list shops ─────────────────────────────────────────────────────────
  server.registerTool(
    "list_shops",
    {
      description: "List shops in Souq Link. Supports optional name and location filters.",
      inputSchema: {
        name:     z.string().optional().describe("Partial shop name to search"),
        location: z.string().optional().describe("Partial location to search"),
      },
    },
    async ({ name, location }) => {
      let query = supabase
        .from("shops")
        .select("shop_id, name, location, description, logo_url");
      if (name)     query = query.ilike("name", `%${name}%`);
      if (location) query = query.ilike("location", `%${location}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
    }
  );

  // ── READ: get single shop ────────────────────────────────────────────────────
  server.registerTool(
    "get_shop",
    {
      description: "Fetch a single shop by its ID.",
      inputSchema: { shop_id: z.string().describe("Shop UUID") },
    },
    async ({ shop_id }) => {
      const { data, error } = await supabase
        .from("shops")
        .select("shop_id, name, location, description, logo_url, owner_id")
        .eq("shop_id", shop_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data)  throw new Error(`Shop ${shop_id} not found`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );
}
