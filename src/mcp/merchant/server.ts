/**
 * MERCHANT MCP SERVER
 *
 * Creates and configures the MCP server dedicated to merchant operations.
 * Registers all merchant tools and exposes two connection methods:
 *   - Stdio:     for running as a standalone process
 *   - WebSocket: for runtime connection from the backend (default port 4003)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import { registerMerchantTools } from "./tools";
import { WebSocketTransport } from "../transports/WebSocketTransport.js";

export function createMerchantMcpServer(): McpServer {
  const server = new McpServer({
    name: "souq-link-merchant-mcp",
    version: "2.0.0",
  });

  registerMerchantTools(server);

  return server;
}

export async function connectStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Merchant MCP Server (STDIO) running");
}

export async function connectWebSocketTransport(server: McpServer, ws: WebSocket): Promise<void> {
  const transport = new WebSocketTransport(ws);
  await server.connect(transport);
  console.log("✅ Merchant MCP: new client connected over WebSocket");
}
