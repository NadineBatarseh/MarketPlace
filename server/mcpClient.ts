/**
 * MCP CLIENT
 *
 * This file is the bridge between the backend (server/index.ts)
 * and the MCP server (src/server.ts running on port 4001).
 *
 * It exposes two functions:
 *   - getTools()         → asks the MCP server for its tool list
 *   - callTool(name, input) → executes a tool on the MCP server
 *
 * How it works:
 *   1. Connects to ws://localhost:4001 (the MCP server)
 *   2. Sends JSON messages in MCP protocol format
 *   3. Waits for the response and returns it
 */

import { WebSocket } from "ws";
import Anthropic from "@anthropic-ai/sdk";

const MCP_URL = process.env.MCP_WS_URL || "ws://localhost:4001";

// Each request gets a unique ID so we can match responses to requests
let requestId = 1;

/**
 * Send one MCP request and wait for its response.
 * Opens a fresh WebSocket connection for each request (simple & reliable).
 */
function mcpRequest(method: string, params: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(MCP_URL);
    const id = requestId++;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`MCP request timeout: ${method}`));
    }, 10000); // 10 second timeout

    ws.on("open", () => {
      // Send the request in MCP protocol format
      ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });

    ws.on("message", (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        // Only handle the response that matches our request ID
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

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`MCP connection error: ${err.message}`));
    });
  });
}

/**
 * Get the list of all tools from the MCP server.
 * Returns them in Anthropic's tool format so Claude can use them directly.
 */
export async function getTools(role: string): Promise<Anthropic.Tool[]> {
  try {
    const result = await mcpRequest("tools/list");
    const allTools: any[] = result?.tools ?? [];

    // Filter tools based on role
    const roleToolMap: Record<string, string[]> = {
      merchant: ["list_products", "get_product", "create_product", "update_product", "delete_product", "apply_discount", "remove_discount"],
      admin:    ["list_products", "get_product", "list_shops", "get_shop"],
      customer: ["list_products", "get_product", "list_shops", "get_shop"],
    };

    const allowed = roleToolMap[role] ?? roleToolMap["customer"];

    return allTools
      .filter(t => allowed.includes(t.name))
      .map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema ?? { type: "object", properties: {} },
      }));
  } catch (err: any) {
    console.error("[mcpClient] getTools error:", err.message);
    return []; // return empty tools if MCP server is down — chat still works
  }
}

/**
 * Execute a tool on the MCP server.
 * Returns the result as a string to be sent back to Claude.
 */
export async function callTool(name: string, input: Record<string, any>): Promise<string> {
  const result = await mcpRequest("tools/call", { name, arguments: input });

  // MCP returns content as an array of blocks — extract the text
  const content = result?.content ?? [];
  const text = content.find((c: any) => c.type === "text")?.text;
  if (!text) throw new Error(`Tool ${name} returned no content`);
  return text;
}
