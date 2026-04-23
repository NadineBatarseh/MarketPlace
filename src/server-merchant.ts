/**
 * MERCHANT MCP SERVER — ENTRY POINT
 *
 * Starts the Merchant MCP server on port 4003 (WebSocket mode).
 * This is a separate process from:
 *   - server/index.ts      (Express backend, port 4000)
 *   - src/server.ts        (Meta-catalog MCP server, port 4001)
 *   - src/server-supabase.ts (Supabase MCP server, port 4002)
 *
 * Run with:
 *   USE_WEBSOCKET=true npx ts-node src/server-merchant.ts
 *   or via package.json script: npm run mcp:merchant
 */

import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import "dotenv/config";

import {
  createMerchantMcpServer,
  connectWebSocketTransport,
} from "./mcp/merchant/server.js";

const PORT = Number(process.env.MERCHANT_MCP_PORT) || 4003;

const mcpServer = createMerchantMcpServer();

const app = express();

const httpServer = app.listen(PORT, () => {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚀 Merchant MCP Server (WebSocket) running");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   ws://localhost:${PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", async (ws: WebSocket) => {
  await connectWebSocketTransport(mcpServer, ws);
});
