import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSupabaseMcpServer } from "../src/mcp/supabase/server.js";

export let mcpClient: Client;
export let anthropicTools: Anthropic.Tool[] = [];

export async function initMcp() {
  const mcpServer = createSupabaseMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "chat-client", version: "1.0.0" });
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const { tools } = await mcpClient.listTools();
  anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
  console.log("[MCP] Loaded tools:", anthropicTools.map((t) => t.name).join(", "));
}
