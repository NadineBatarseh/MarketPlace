/**
 * MERCHANT MCP CLIENT
 *
 * Bridge between the backend API (server/index.ts) and the Merchant MCP server.
 *
 * Exposes two functions:
 *   - getMerchantTools()            → fetch the full merchant tool list from the MCP server
 *   - callMerchantTool(name, input) → execute a tool on the MCP server and return the result
 *
 * How it works:
 *   1. Opens a WebSocket connection to the Merchant MCP server (default ws://localhost:4003)
 *   2. Sends a JSON-RPC 2.0 message in MCP protocol format
 *   3. Waits for the matching response and returns it
 *   4. Closes the connection after each request
 */

import { WebSocket } from "ws";
import type Anthropic from "@anthropic-ai/sdk";

const MERCHANT_MCP_URL = process.env.MERCHANT_MCP_WS_URL || "ws://localhost:4003";

let requestId = 1;

// ── Core JSON-RPC over WebSocket ───────────────────────────────────────────────

function mcpRequest(method: string, params: Record<string, unknown> = {}, retries = 3): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(MERCHANT_MCP_URL);
    const id = requestId++;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Merchant MCP request timeout: ${method}`));
    }, 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      ws.close();
      if (retries > 0) {
        // MCP server not ready yet — wait 1 s and retry
        setTimeout(() => {
          mcpRequest(method, params, retries - 1).then(resolve).catch(reject);
        }, 1_000);
      } else {
        reject(new Error(`Merchant MCP connection error: ${err.message}`));
      }
    });

    ws.on("message", (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (response.error) {
            reject(new Error(response.error.message ?? "MCP error"));
          } else {
            resolve(response.result);
          }
        }
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      }
    });
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetch all tools registered on the Merchant MCP server,
 * shaped as Anthropic tool definitions ready to pass to Claude.
 */
export async function getMerchantTools(): Promise<Anthropic.Tool[]> {
  try {
    const result = await mcpRequest("tools/list") as { tools?: any[] };
    const tools: any[] = result?.tools ?? [];

    return tools.map(t => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  } catch (err: any) {
    console.error("[merchantClient] getMerchantTools error:", err.message);
    return [];
  }
}

/**
 * Execute a single tool on the Merchant MCP server.
 * Returns the tool's text output as a string.
 */
export async function callMerchantTool(name: string, input: Record<string, unknown>): Promise<string> {
  const result = await mcpRequest("tools/call", { name, arguments: input }) as { content?: any[]; isError?: boolean };

  const content = result?.content ?? [];
  const text = content.find((c: any) => c.type === "text")?.text;
  if (!text) throw new Error(`Tool "${name}" returned no text content`);

  // MCP tools signal failure via isError — surface it as a real throw
  // so the chat handler marks it is_error: true and Claude stops retrying.
  if (result.isError) {
    console.error(`[merchantClient] tool "${name}" returned isError:`, text);
    throw new Error(text);
  }

  return text;
}
