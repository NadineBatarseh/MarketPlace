/**
 * RESPONSIBILITY:
 * The entry point of the application.
 * Initializes the environment, Express app, MetaService, and the MCP Server.
 * Orchestrates the connection logic between Transports and the Server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import express from "express";
import "dotenv/config";
import { MetaService } from "./services/metaService.js";
import { WebSocketTransport } from "./transports/WebSocketTransport.js";
import { registerTools } from "./tools/index.js";
const PORT = Number(process.env.PORT) || 3000;
const USE_WEBSOCKET = process.env.USE_WEBSOCKET === "true";
// 1. Initialize Services and MCP Server
const metaService = new MetaService(process.env.META_ACCESS_TOKEN, process.env.META_CATALOG_ID);
const server = new McpServer({
    name: "souq-link-mcp",
    version: "1.0.0",
});
// Register all MCP tools
registerTools(server, metaService);
// 2. Start the Server based on chosen mode
if (USE_WEBSOCKET) {
    const app = express();
    // Optional: Add OAuth callback route for Meta
    app.get("/auth/callback", (req, res) => {
        res.send("Authentication successful!");
    });
    const httpServer = app.listen(PORT, () => {
        console.log(`🚀 MCP Server (WebSocket) running on port ${PORT}`);
    });
    const wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", async (ws) => {
        console.log("✅ New client connected over WebSocket");
        const transport = new WebSocketTransport(ws);
        await server.connect(transport);
    });
}
else {
    // Fallback to STDIO mode for local testing (e.g., Claude Desktop)
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error("🚀 MCP Server (STDIO) running");
    });
}
