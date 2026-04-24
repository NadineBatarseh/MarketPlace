import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSupabaseTools } from "./tools.js";

export function createSupabaseMcpServer(): McpServer {
  const server = new McpServer({
    name: "souq-link-supabase-mcp",
    version: "1.0.0",
  });

  registerSupabaseTools(server);

  return server;
}
