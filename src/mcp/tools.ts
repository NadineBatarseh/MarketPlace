// tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaService } from "../services/metaService.js";
import { executeSearchProducts, executeSearchStores } from "../../server/search/tools.js";

export function registerTools(server: McpServer, metaService: MetaService) {

  // أداة: جلب جميع المنتجات
  server.tool(
    "get_catalog_products",
    "Fetch a list of all products from Meta catalog using Supabase Auth",
    { 
      sb_auth_token: z.string().describe("Supabase User JWT (Required for decryption)") 
    },
    async ({ sb_auth_token }) => {
      // نمرر التوكن للمنطق البرمجي لفك التشفير في السحاب
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
      // نمرر التوكن لجلب بيانات المنتج المشفرة أصلاً
      const product = await metaService.getProduct(productId, sb_auth_token);
      // هنا تضع منطق الإضافة الخاص بك...
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