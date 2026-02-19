/**
 * RESPONSIBILITY:
 * Initializes and configures the MCP Server.
 * Creates the server instance, registers tools, and provides connection methods.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import { MetaService } from "../services/metaService.js";
import { registerTools } from "./tools";

import { WebSocketTransport } from "./transports/WebSocketTransport";

export function createMcpServer(metaService: MetaService): McpServer {
  const server = new McpServer({
    name: "souq-link-mcp",
    version: "1.0.0",
  });

  // Register all MCP tools
  registerTools(server, metaService);

  return server;
}

export async function connectStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 MCP Server (STDIO) running");
}

export async function connectWebSocketTransport(server: McpServer, ws: WebSocket): Promise<void> {
  const transport = new WebSocketTransport(ws);
  await server.connect(transport);
  console.log("✅ New client connected over WebSocket");
}
