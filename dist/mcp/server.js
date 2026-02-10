/**
 * RESPONSIBILITY:
 * Initializes and configures the MCP Server.
 * Creates the server instance, registers tools, and provides connection methods.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { WebSocketTransport } from "./transports/WebSocketTransport.js";
export function createMcpServer(metaService) {
    const server = new McpServer({
        name: "souq-link-mcp",
        version: "1.0.0",
    });
    // Register all MCP tools
    registerTools(server, metaService);
    return server;
}
export async function connectStdioTransport(server) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 MCP Server (STDIO) running");
}
export async function connectWebSocketTransport(server, ws) {
    const transport = new WebSocketTransport(ws);
    await server.connect(transport);
    console.log("✅ New client connected over WebSocket");
}
