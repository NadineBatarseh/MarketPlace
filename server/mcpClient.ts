/**
 * MCP CLIENT
 *
 * Both MCP servers run in-process via InMemoryTransport — no separate terminals needed.
 *   1. Supabase MCP  — product/shop tools, role-filtered
 *   2. Instagram MCP — instagram_* and facebook_* analytics tools
 *
 * Public API:
 *   getTools(role)        → merged Anthropic tool list from both servers
 *   callTool(name, input) → routed to the correct server based on tool name
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSupabaseMcpServer } from "../src/mcp/supabase/server.js";
import { createInstagramMcpServer } from "../src/mcp/instagram/server.js";

// ── In-process client singletons ─────────────────────────────────────────────

let _supabaseClient: Client | null = null;
let _instagramClient: Client | null = null;

async function getSupabaseClient(): Promise<Client> {
  if (_supabaseClient) return _supabaseClient;

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createSupabaseMcpServer();
  await server.connect(serverTransport);

  const client = new Client({ name: "souqlink-supabase-client", version: "1.0.0" });
  await client.connect(clientTransport);

  _supabaseClient = client;
  console.log("✅ Supabase MCP: in-memory client connected");
  return client;
}

async function getInstagramClient(): Promise<Client> {
  if (_instagramClient) return _instagramClient;

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createInstagramMcpServer();
  await server.connect(serverTransport);

  const client = new Client({ name: "souqlink-instagram-client", version: "1.0.0" });
  await client.connect(clientTransport);

  _instagramClient = client;
  console.log("✅ Instagram MCP: in-memory client connected");
  return client;
}

// ── Tool routing ──────────────────────────────────────────────────────────────

const instagramToolNames = new Set<string>();

// ── Public API ────────────────────────────────────────────────────────────────

export async function getTools(role: string): Promise<Anthropic.Tool[]> {
  const [supabaseResult, instagramResult] = await Promise.allSettled([
    (async () => {
      const client = await getSupabaseClient();
      return client.listTools();
    })(),
    (async () => {
      const client = await getInstagramClient();
      return client.listTools();
    })(),
  ]);

  // ── Supabase tools (role-filtered) ─────────────────────────────────────────
  const supabaseRawTools: any[] =
    supabaseResult.status === "fulfilled" ? (supabaseResult.value?.tools ?? []) : [];

  if (supabaseResult.status === "rejected") {
    console.error("[mcpClient] Supabase tools unavailable:", (supabaseResult as PromiseRejectedResult).reason?.message);
  }

  const roleToolMap: Record<string, string[]> = {
    merchant: [
      "list_products", "get_product", "list_my_products",
      "create_product", "update_product", "delete_product",
      "apply_discount", "remove_discount",
    ],
    admin:    ["list_products", "get_product", "list_shops", "get_shop"],
    customer: ["list_products", "get_product", "list_shops", "get_shop"],
  };
  const allowed = roleToolMap[role] ?? roleToolMap["customer"];

  const supabaseTools: Anthropic.Tool[] = supabaseRawTools
    .filter((t) => allowed.includes(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));

  // ── Instagram + Facebook tools (role-filtered) ────────────────────────────
  const instagramRawTools: any[] =
    instagramResult.status === "fulfilled" ? (instagramResult.value?.tools ?? []) : [];

  if (instagramResult.status === "rejected") {
    console.error("[mcpClient] Instagram tools unavailable:", (instagramResult as PromiseRejectedResult).reason?.message);
  }

  // Merchants get import + analytics tools only.
  // instagram_list_media is intentionally excluded so Claude always uses
  // instagram_import_products when asked to fetch products from Instagram.
  const instagramToolsByRole: Record<string, string[]> = {
    merchant: [
      "instagram_import_products",
      "instagram_get_profile",
      "instagram_get_account_insights",
      "instagram_get_media_insights",
      "instagram_get_stories",
      "instagram_get_content_publishing_limit",
      "facebook_get_page_insights",
      "facebook_get_page_feed",
    ],
  };
  const allowedInstagramTools = instagramToolsByRole[role] ?? instagramRawTools.map((t) => t.name);

  const instagramTools: Anthropic.Tool[] = instagramRawTools
    .filter((t) => allowedInstagramTools.includes(t.name))
    .map((t) => {
      instagramToolNames.add(t.name);
      return {
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema ?? { type: "object", properties: {} },
      };
    });

  return [...supabaseTools, ...instagramTools];
}

export async function callTool(name: string, input: Record<string, any>): Promise<string> {
  // Populate routing set if getTools() was not called first
  if (instagramToolNames.size === 0) {
    try {
      const client = await getInstagramClient();
      const { tools } = await client.listTools();
      for (const t of tools) instagramToolNames.add(t.name);
    } catch { /* fall through to Supabase */ }
  }

  if (instagramToolNames.has(name)) {
    const client = await getInstagramClient();
    const result = await client.callTool({ name, arguments: input });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text;
    if (!text) throw new Error(`Tool ${name} returned no content`);
    return text;
  }

  // Default: Supabase
  const client = await getSupabaseClient();
  const result = await client.callTool({ name, arguments: input });
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`Tool ${name} returned no content`);
  return text;
}
