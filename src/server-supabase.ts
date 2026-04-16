/**
 * RESPONSIBILITY:
 * Entry point for the standalone Supabase MCP Server.
 *
 * Modes:
 *   STDIO (default)   — used by Claude Code (set in ~/.claude/settings.json)
 *   WebSocket         — set SUPABASE_MCP_WEBSOCKET=true, listens on SUPABASE_MCP_PORT (default 4002)
 */
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import "dotenv/config";

import {
  createSupabaseMcpServer,
  connectStdioTransport,
  connectWebSocketTransport,
} from "./mcp/supabase/server.js";

const USE_WEBSOCKET = process.env.SUPABASE_MCP_WEBSOCKET === "true";
const PORT = Number(process.env.SUPABASE_MCP_PORT) || 4002;

const mcpServer = createSupabaseMcpServer();

if (USE_WEBSOCKET) {
  const app = express();

  const httpServer = app.listen(PORT, () => {
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🚀 Supabase MCP Server (WebSocket) running");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   ws://localhost:${PORT}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", async (ws: WebSocket) => {
    await connectWebSocketTransport(mcpServer, ws);
  });
} else {
  connectStdioTransport(mcpServer);
}
