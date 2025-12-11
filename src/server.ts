import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import "dotenv/config";

// Meta API Configuration
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;
const CATALOG_ID = process.env.META_CATALOG_ID!;
const META_API_VERSION = "v18.0";
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Create MCP Server
const server = new McpServer({
  name: "meta-catalog",
  version: "1.0.0",
});

// 1. Get All Products from Meta Catalog
server.tool(
  "get_catalog_products",
  "Fetch all products from Meta catalog",
  async (_params: any) => {
    try {
      const limit = 25;
      let url = `${BASE_URL}/${CATALOG_ID}/products?fields=id,name,description,price,currency,image_url,url,availability,brand,category&limit=${limit}&access_token=${META_ACCESS_TOKEN}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { content: [{ type: "text", text: `Error: ${data.error.message}` }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error}` }] };
    }
  }
);

// 2. Get Single Product Details
server.tool(
  "get_product",
  "Get details of a specific product by ID",
  async (params: any) => {
    try {
      const { product_id } = params;
      const url = `${BASE_URL}/${product_id}?fields=id,name,description,price,currency,image_url,url,availability,brand,category,additional_image_urls,condition,sale_price&access_token=${META_ACCESS_TOKEN}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { content: [{ type: "text", text: `Error: ${data.error.message}` }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error}` }] };
    }
  }
);

// 3. Search Products in Catalog
server.tool(
  "search_products",
  "Search for products in the catalog",
  async (params: any) => {
    try {
      const { query, limit = 10 } = params;
      const url = `${BASE_URL}/${CATALOG_ID}/products?fields=id,name,description,price,image_url&filter={"name":{"i_contains":"${query}"}}&limit=${limit}&access_token=${META_ACCESS_TOKEN}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { content: [{ type: "text", text: `Error: ${data.error.message}` }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error}` }] };
    }
  }
);

// 4. Add Product to Your Marketplace
server.tool(
  "add_to_marketplace",
  "Add a Meta catalog product to your marketplace database",
  async (params: any) => {
    try {
      const { product_id, custom_price, custom_category } = params;

      const metaUrl = `${BASE_URL}/${product_id}?fields=id,name,description,price,currency,image_url,url,availability,brand,category&access_token=${META_ACCESS_TOKEN}`;

      const metaResponse = await fetch(metaUrl);
      const metaProduct = await metaResponse.json();

      if (metaProduct.error) {
        return { content: [{ type: "text", text: `Error fetching from Meta: ${metaProduct.error.message}` }] };
      }

      const marketplaceProduct = {
        meta_id: metaProduct.id,
        name: metaProduct.name,
        description: metaProduct.description,
        price: custom_price || parseFloat(metaProduct.price?.replace(/[^0-9.]/g, "") || "0"),
        currency: metaProduct.currency || "USD",
        image_url: metaProduct.image_url,
        original_url: metaProduct.url,
        availability: metaProduct.availability,
        brand: metaProduct.brand,
        category: custom_category || metaProduct.category,
        imported_at: new Date().toISOString(),
      };

      return {
        content: [{
          type: "text",
          text: `Product ready to add to marketplace:\n${JSON.stringify(marketplaceProduct, null, 2)}\n\n⚠️ TODO: Implement your marketplace API call`,
        }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error}` }] };
    }
  }
);

// 5. Bulk Import Products
server.tool(
  "bulk_import",
  "Import multiple products from Meta catalog to your marketplace",
  async (params: any) => {
    try {
      const { category_filter, limit = 50 } = params;

      let url = `${BASE_URL}/${CATALOG_ID}/products?fields=id,name,description,price,currency,image_url,availability,brand,category&limit=${limit}&access_token=${META_ACCESS_TOKEN}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { content: [{ type: "text", text: `Error: ${data.error.message}` }] };
      }

      let products = data.data || [];

      if (category_filter) {
        products = products.filter((p: any) =>
          p.category?.toLowerCase().includes(category_filter.toLowerCase())
        );
      }

      const importSummary = {
        total_found: data.data?.length || 0,
        filtered_count: products.length,
        products: products.map((p: any) => ({
          meta_id: p.id,
          name: p.name,
          price: p.price,
          category: p.category,
        })),
      };

      return {
        content: [{
          type: "text",
          text: `Bulk import summary:\n${JSON.stringify(importSummary, null, 2)}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error}` }] };
    }
  }
);

// 6. Sync Product (Update from Meta)
server.tool(
  "sync_product",
  "Sync a product's data from Meta catalog (get latest updates)",
  async (params: any) => {
    try {
      const { meta_product_id } = params;

      const url = `${BASE_URL}/${meta_product_id}?fields=id,name,description,price,currency,image_url,url,availability,brand,category,additional_image_urls&access_token=${META_ACCESS_TOKEN}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { content: [{ type: "text", text: `Error: ${data.error.message}` }] };
      }

      return {
        content: [{
          type: "text",
          text: `Latest product data from Meta:\n${JSON.stringify(data, null, 2)}\n\n✅ Use this data to update your marketplace`,
        }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error}` }] };
    }
  }
);

// Custom WebSocket Transport Class
class WebSocketTransport implements Transport {
  private ws: WebSocket;
  
  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  async start(): Promise<void> {
    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (this.onmessage) {
          this.onmessage(message);
        }
      } catch (error) {
        console.error("Error parsing message:", error);
        if (this.onerror) {
          this.onerror(error as Error);
        }
      }
    });

    this.ws.on("error", (error: Error) => {
      console.error("WebSocket error:", error);
      if (this.onerror) {
        this.onerror(error);
      }
    });

    this.ws.on("close", () => {
      console.log("Client disconnected");
      if (this.onclose) {
        this.onclose();
      }
    });
  }

  async send(message: any): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    this.ws.close();
  }

  onmessage?: (message: any) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}

// التحقق من نوع الاستخدام
const USE_WEBSOCKET = process.argv.includes("--websocket") || process.env.USE_WEBSOCKET === "true";

// Start the server
async function main() {
  if (USE_WEBSOCKET) {
    // WebSocket Mode
    const PORT = parseInt(process.env.PORT || "8080");
    const wss = new WebSocketServer({ port: PORT });

    console.log(`🚀 Meta Catalog MCP Server running on WebSocket port ${PORT}`);

    wss.on("connection", async (ws: WebSocket, req) => {
      const clientIP = req.socket.remoteAddress;
      console.log(`✅ New client connected from ${clientIP}`);

      try {
        const transport = new WebSocketTransport(ws);
        await server.connect(transport);
        console.log(`📡 MCP Server connected to client ${clientIP}`);
      } catch (error) {
        console.error("Error connecting to client:", error);
        ws.close();
      }
    });

    wss.on("error", (error: Error) => {
      console.error("WebSocket Server error:", error);
    });

    process.on("SIGINT", () => {
      console.log("\n🛑 Shutting down server...");
      wss.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    });
  } else {
    // STDIO Mode (للاستخدام مع Claude Desktop)
    try {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      
      // Log to a file instead of console
      const fs = await import('fs');
      fs.appendFileSync('mcp-server.log', `[${new Date().toISOString()}] MCP Server started via STDIO\n`);
    } catch (error) {
      const fs = await import('fs');
      fs.appendFileSync('mcp-server.log', `[${new Date().toISOString()}] ERROR: ${error}\n`);
      throw error;
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});