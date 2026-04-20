import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InstagramClient } from "./platforms/instagram/client.js";
import { FacebookClient } from "./platforms/facebook/client.js";
import { getAllTools } from "./tools.js";
import { handleInstagramTool, handleFacebookTool } from "./handlers.js";

export function createInstagramMcpServer(): Server {
  const instagramClient = process.env.INSTAGRAM_ACCESS_TOKEN
    ? new InstagramClient({
        accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
        accountId: process.env.INSTAGRAM_ACCOUNT_ID,
      })
    : null;

  const facebookClient = process.env.FACEBOOK_ACCESS_TOKEN
    ? new FacebookClient({
        accessToken: process.env.FACEBOOK_ACCESS_TOKEN,
        pageId: process.env.FACEBOOK_PAGE_ID,
      })
    : null;

  const server = new Server(
    { name: "instagram-analytics-mcp", version: "3.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result: unknown;

      if (name.startsWith("instagram_")) {
        result = await handleInstagramTool(instagramClient, name, args as Record<string, unknown>);
      } else if (name.startsWith("facebook_")) {
        result = await handleFacebookTool(facebookClient, name, args as Record<string, unknown>);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: (error as Error).message }) }],
        isError: true,
      };
    }
  });

  return server;
}
