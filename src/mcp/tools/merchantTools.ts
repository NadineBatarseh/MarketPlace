/**
 * MERCHANT TOOLS
 *
 * These tools are only available to authenticated merchants.
 * Every tool is scoped to the merchant's own shop — they cannot
 * read or modify products/orders from other shops.
 *
 * Each tool follows this pattern:
 *   1. Validate the merchant has a shop
 *   2. Run the operation against Supabase (scoped by shop_id)
 *   3. Return the result as JSON text
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "../../../server/supabase.js";

export function registerMerchantTools(server: McpServer) {

  // ── LIST PRODUCTS ──────────────────────────────────────────────────────────
  // Returns all products in the merchant's shop.
  // Claude calls this when the merchant asks "عرض منتجاتي" or "كم عندي منتج".
  server.tool(
    "list_products",
    "List all products in the merchant's shop. Scoped to the merchant's shop only.",
    {
      shop_id:    z.string().describe("The merchant's shop ID (injected by backend)"),
      keywords:   z.array(z.string()).optional().describe("Filter by keywords in title or description"),
      max_price:  z.number().optional().describe("Filter products under this price"),
      price_sort: z.enum(["asc", "desc"]).optional().describe("Sort by price"),
      limit:      z.number().optional().describe("Max results, default 20"),
    },
    async ({ shop_id, keywords, max_price, price_sort, limit }) => {
      let query = supabase
        .from("products")
        .select("id, title, description, price, discount_pct, stock_Quantity, image_urls")
        .eq("shop_id", shop_id);

      if (keywords?.length) {
        const orParts = keywords.flatMap(t => [
          `title.ilike.%${t}%`,
          `description.ilike.%${t}%`,
        ]);
        query = query.or(orParts.join(","));
      }
      if (max_price)  query = query.lte("price", max_price);
      if (price_sort) query = query.order("price", { ascending: price_sort === "asc" });
      query = query.limit(limit ?? 20);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: JSON.stringify(data ?? []) }] };
    }
  );

  // ── GET PRODUCT ────────────────────────────────────────────────────────────
  // Returns a single product by ID.
  // Claude calls this when the merchant asks about a specific product.
  server.tool(
    "get_product",
    "Get a single product by its ID. Only works for products in the merchant's shop.",
    {
      shop_id:    z.string().describe("The merchant's shop ID"),
      product_id: z.string().describe("The product UUID to fetch"),
    },
    async ({ shop_id, product_id }) => {
      const { data, error } = await supabase
        .from("products")
        .select("id, title, description, price, discount_pct, stock_Quantity, image_urls")
        .eq("id", product_id)
        .eq("shop_id", shop_id)  // ownership enforced — can't fetch other shops' products
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("المنتج غير موجود أو لا ينتمي إلى متجرك.");
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
    }
  );

  // ── CREATE PRODUCT ─────────────────────────────────────────────────────────
  // Adds a new product to the merchant's shop.
  // Claude calls this when the merchant says "أضف منتج جديد اسمه X بسعر Y".
  server.tool(
    "create_product",
    "Create a new product in the merchant's shop.",
    {
      shop_id:        z.string().describe("The merchant's shop ID"),
      title:          z.string().describe("Product title (required)"),
      price:          z.number().describe("Product price (required)"),
      description:    z.string().optional().describe("Product description"),
      stock_Quantity: z.number().optional().describe("Available stock quantity"),
      image_urls:     z.array(z.string()).optional().describe("List of image URLs"),
    },
    async ({ shop_id, title, price, description, stock_Quantity, image_urls }) => {
      const { data, error } = await supabase
        .from("products")
        .insert({
          shop_id,
          meta_product_id: crypto.randomUUID(),
          title:           title.trim(),
          price,
          description:     description?.trim() ?? null,
          stock_Quantity:  stock_Quantity ?? null,
          image_urls:      image_urls ?? null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, product: data }) }] };
    }
  );

  // ── UPDATE PRODUCT ─────────────────────────────────────────────────────────
  // Updates fields on an existing product.
  // Claude calls this when the merchant says "غيّر سعر المنتج X إلى Y".
  server.tool(
    "update_product",
    "Update one or more fields of an existing product in the merchant's shop.",
    {
      shop_id:        z.string().describe("The merchant's shop ID"),
      product_id:     z.string().describe("The product UUID to update"),
      title:          z.string().optional(),
      price:          z.number().optional(),
      description:    z.string().optional(),
      stock_Quantity: z.number().optional(),
      image_urls:     z.array(z.string()).optional(),
    },
    async ({ shop_id, product_id, title, price, description, stock_Quantity, image_urls }) => {
      const updates: Record<string, unknown> = {};
      if (title          !== undefined) updates.title          = title.trim();
      if (price          !== undefined) updates.price          = price;
      if (description    !== undefined) updates.description    = description.trim();
      if (stock_Quantity !== undefined) updates.stock_Quantity = stock_Quantity;
      if (image_urls     !== undefined) updates.image_urls     = image_urls;

      if (Object.keys(updates).length === 0) throw new Error("لم يتم تقديم أي حقول للتحديث.");

      const { data, error } = await supabase
        .from("products")
        .update(updates)
        .eq("id", product_id)
        .eq("shop_id", shop_id)  // ownership enforced
        .select()
        .single();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("المنتج غير موجود أو لا ينتمي إلى متجرك.");
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, product: data }) }] };
    }
  );

  // ── DELETE PRODUCT ─────────────────────────────────────────────────────────
  // Deletes a product from the merchant's shop.
  // Claude calls this when the merchant says "احذف المنتج X".
  server.tool(
    "delete_product",
    "Delete a product from the merchant's shop.",
    {
      shop_id:    z.string().describe("The merchant's shop ID"),
      product_id: z.string().describe("The product UUID to delete"),
    },
    async ({ shop_id, product_id }) => {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", product_id)
        .eq("shop_id", shop_id);  // ownership enforced

      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, deleted_id: product_id }) }] };
    }
  );

  // ── APPLY DISCOUNT ─────────────────────────────────────────────────────────
  // Applies a percentage or fixed discount to one or all products.
  // Claude calls this when the merchant says "طبّق خصم 20% على كل المنتجات".
  server.tool(
    "apply_discount",
    "Apply a discount to one product or all products in the merchant's shop. Supports percentage (e.g. 20%) or fixed amount.",
    {
      shop_id:        z.string().describe("The merchant's shop ID"),
      discount_type:  z.enum(["percentage", "fixed"]).describe("'percentage' = % off, 'fixed' = fixed amount off"),
      discount_value: z.number().describe("The discount amount"),
      product_id:     z.string().optional().describe("Specific product UUID. Omit to apply to ALL products."),
    },
    async ({ shop_id, discount_type, discount_value, product_id }) => {
      if (discount_type === "percentage" && (discount_value <= 0 || discount_value >= 100)) {
        throw new Error("نسبة الخصم يجب أن تكون بين 1 و 99.");
      }
      if (discount_type === "fixed" && discount_value <= 0) {
        throw new Error("قيمة الخصم يجب أن تكون أكبر من صفر.");
      }

      let fetchQuery = supabase
        .from("products")
        .select("id, title, price")
        .eq("shop_id", shop_id);
      if (product_id) fetchQuery = fetchQuery.eq("id", product_id);

      const { data: products, error: fetchErr } = await fetchQuery;
      if (fetchErr) throw new Error(fetchErr.message);
      if (!products?.length) throw new Error("لم يتم العثور على منتجات.");

      const results = [];
      for (const product of products) {
        const originalPrice = product.price as number;
        let discountPct: number;

        if (discount_type === "percentage") {
          discountPct = discount_value;
        } else {
          // Convert fixed amount to percentage for consistent storage
          discountPct = parseFloat(((discount_value / originalPrice) * 100).toFixed(2));
        }

        const discountedPrice = parseFloat((originalPrice * (1 - discountPct / 100)).toFixed(2));
        if (discountedPrice <= 0) {
          results.push({ id: product.id, title: product.title, skipped: true, reason: "الخصم يتجاوز سعر المنتج" });
          continue;
        }

        const { error: updateErr } = await supabase
          .from("products")
          .update({ discount_pct: discountPct })
          .eq("id", product.id)
          .eq("shop_id", shop_id);

        if (updateErr) throw new Error(updateErr.message);
        results.push({ id: product.id, title: product.title, original_price: originalPrice, discounted_price: discountedPrice, discount_pct: discountPct });
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, updated: results }) }] };
    }
  );

  // ── REMOVE DISCOUNT ────────────────────────────────────────────────────────
  // Removes discount from one or all products.
  // Claude calls this when the merchant says "أزل الخصم عن جميع المنتجات".
  server.tool(
    "remove_discount",
    "Remove the discount from one product or all products in the merchant's shop.",
    {
      shop_id:    z.string().describe("The merchant's shop ID"),
      product_id: z.string().optional().describe("Specific product UUID. Omit to remove from ALL products."),
    },
    async ({ shop_id, product_id }) => {
      let query = supabase
        .from("products")
        .update({ discount_pct: null })
        .eq("shop_id", shop_id);
      if (product_id) query = query.eq("id", product_id);

      const { error } = await query;
      if (error) throw new Error(error.message);

      const scope = product_id ? `المنتج ${product_id}` : "جميع منتجات متجرك";
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, message: `تمت إزالة الخصم من ${scope}.` }) }] };
    }
  );
}
