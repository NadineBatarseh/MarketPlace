/**
 * RESPONSIBILITY:
 * The entry point of the application.
 * Initializes the environment, Express app, and HTTP server.
 * Orchestrates the connection between HTTP server and MCP server.
 */
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import "dotenv/config";

import { MetaService } from "./services/metaService.js";
import { createAuthRoutes } from "./routes/authRoutes.js";
import { createMcpServer, connectStdioTransport, connectWebSocketTransport } from "./mcp/server.js";

const PORT = Number(process.env.MCP_PORT) || 4001;
const USE_WEBSOCKET = process.env.USE_WEBSOCKET === "true";

// 1. Initialize Services
const metaService = new MetaService(
  process.env.META_CATALOG_ID! // تغيير مطلوب
);

// 2. Initialize MCP Server
const mcpServer = createMcpServer(metaService);

// 3. Start the Server based on chosen mode
if (USE_WEBSOCKET) {
  const app = express();

  app.use(express.static('public'));

  app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "public" });
  });

  // إعدادات Supabase للواجهة (من .env)
  app.get("/api/config", (req, res) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_KEY in server .env",
      });
      return;
    }
    res.json({ supabaseUrl: url, supabaseAnonKey: key });
  });

  // Register auth routes
  app.use("/auth", createAuthRoutes(metaService));

  const httpServer = app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🚀 MCP Server (WebSocket) running");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("   👉 enter the link:");
    console.log("");
    console.log(`   ${url}`);
    console.log("");
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