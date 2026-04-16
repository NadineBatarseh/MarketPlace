// tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaService } from "../../services/metaService.js";
import { supabase } from "../../../server/supabase.js";

async function executeSearchProducts(input: {
  keywords?: string[];
  color?: string;
  location?: string;
  store_name?: string;
  price_sort?: 'asc' | 'desc';
  max_price?: number;
  limit?: number;
}) {
  let query = supabase
    .from('products')
    .select('id, title, description, price, image_urls, shop_id, shops!inner(name, location)');

  const terms = [
    ...(input.keywords ?? []),
    ...(input.color ? [input.color] : []),
  ];

  if (terms.length > 0) {
    const orParts = terms.flatMap(t => [
      `title.ilike.%${t}%`,
      `description.ilike.%${t}%`,
    ]);
    query = query.or(orParts.join(','));
  }

  if (input.store_name) query = (query as any).ilike('shops.name', `%${input.store_name}%`);
  if (input.location)   query = (query as any).ilike('shops.location', `%${input.location}%`);
  if (input.max_price)  query = query.lte('price', input.max_price);
  if (input.price_sort) query = query.order('price', { ascending: input.price_sort === 'asc' });

  query = query.limit(input.limit ?? 20);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function executeSearchStores(input: { name?: string; location?: string }) {
  let query = supabase.from('shops').select('id, name, location, description, logo_url');
  if (input.name)     query = query.ilike('name', `%${input.name}%`);
  if (input.location) query = query.ilike('location', `%${input.location}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function registerTools(server: McpServer, metaService: MetaService) {

  // أداة: جلب جميع المنتجات
  server.tool(
    "get_catalog_products",
    "Fetch a list of all products from Meta catalog using Supabase Auth",
    {
      sb_auth_token: z.string().describe("Supabase User JWT (Required for decryption)")
    },
    async ({ sb_auth_token }) => {
      const data = await metaService.getCatalogProducts(sb_auth_token);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  // أداة: البحث عن منتج
  server.tool(
    "search_products",
    "Search for a specific product by name using Supabase Auth",
    {
      query: z.string(),
      sb_auth_token: z.string().describe("Supabase User JWT")
    },
    async ({ query, sb_auth_token }) => {
      const results = await metaService.searchProducts(query, sb_auth_token);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );

  // أداة: إضافة منتج للمتجر المحلي
  server.tool(
    "add_to_marketplace",
    "Format a product for the unified marketplace using Supabase Auth",
    {
      productId: z.string(),
      sb_auth_token: z.string().describe("Supabase User JWT"),
      customPrice: z.number().optional()
    },
    async ({ productId, sb_auth_token, customPrice }) => {
      const product = await metaService.getProduct(productId, sb_auth_token);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, product }) }] };
    }
  );

  // ── Marketplace search tools ────────────────────────────────────────────

  server.tool(
    "search_marketplace_products",
    "Search products in Souq Link by keyword, color, location, or price",
    {
      keywords:   z.array(z.string()).optional(),
      color:      z.string().optional(),
      location:   z.string().optional(),
      store_name: z.string().optional(),
      price_sort: z.enum(['asc', 'desc']).optional(),
      max_price:  z.number().optional(),
      limit:      z.number().optional(),
    },
    async (input) => {
      const result = await executeSearchProducts(input);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "search_marketplace_stores",
    "Search stores in Souq Link by name or location",
    {
      name:     z.string().optional(),
      location: z.string().optional(),
    },
    async (input) => {
      const stores = await executeSearchStores(input);
      return { content: [{ type: "text", text: JSON.stringify(stores) }] };
    }
  );
}
