/**
 * RESPONSIBILITY:
 * Creates and configures the Supabase MCP Server instance.
 * Registers all Supabase tools and exposes connection helpers.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import { registerSupabaseTools } from "./tools.js";
import { WebSocketTransport } from "../transports/WebSocketTransport.js";

export function createSupabaseMcpServer(): McpServer {
  const server = new McpServer({
    name: "souq-link-supabase-mcp",
    version: "1.0.0",
  });

  registerSupabaseTools(server);

  return server;
}

export async function connectStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Supabase MCP Server (STDIO) running");
}

export async function connectWebSocketTransport(server: McpServer, ws: WebSocket): Promise<void> {
  const transport = new WebSocketTransport(ws);
  await server.connect(transport);
  console.log("✅ Supabase MCP: new client connected over WebSocket");
}
