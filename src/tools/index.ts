/**
 * RESPONSIBILITY:
 * Defines the available MCP tools (Names, Descriptions, and Input Schemas).
 * It maps MCP tool calls to the appropriate business logic in MetaService.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaService } from "../services/metaService.js";

export function registerTools(server: McpServer, metaService: MetaService) {
  
  // Tool: Fetch All Products
  server.tool(
    "get_catalog_products",
    "Fetch a list of all products from Meta catalog",
    {},
    async () => {
      const data = await metaService.getCatalogProducts();
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  // Tool: Search Products
  server.tool(
    "search_products",
    "Search for a specific product by name",
    { query: z.string() },
    async ({ query }) => {
      const results = await metaService.searchProducts(query);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );

  // Tool: Import to Marketplace
  server.tool(
    "add_to_marketplace",
    "Prepare and format a product for the unified local marketplace",
    {
      productId: z.string(),
      customPrice: z.number().optional()
    },
    async ({ productId, customPrice }) => {
      const product = await metaService.getProduct(productId);
      const finalPrice = customPrice || product.price;
      return {
        content: [{ 
          type: "text", 
          text: `Product ${product.name} prepared with price ${finalPrice} for the Palestine market.` 
        }]
      };
    }
  );
}