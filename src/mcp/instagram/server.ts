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
    const { name, arguments: rawArgs = {} } = request.params;

    // Extract merchant-specific values injected by /api/chat (not passed by Claude)
    const args = { ...rawArgs } as Record<string, unknown>;
    const merchantToken = args._instagram_access_token as string | undefined;
    const merchantAccountId = args._instagram_account_id as string | undefined;
    const merchantUserId = args._user_id as string | undefined;
    delete args._instagram_access_token;
    delete args._instagram_account_id;
    delete args._user_id;

    // Use merchant's own client if their token was injected; fall back to global
    const activeInstagramClient = merchantToken
      ? new InstagramClient({ accessToken: merchantToken, accountId: merchantAccountId })
      : instagramClient;

    try {
      let result: unknown;

      if (name.startsWith("instagram_")) {
        result = await handleInstagramTool(activeInstagramClient, name, args, merchantUserId);
      } else if (name.startsWith("facebook_")) {
        result = await handleFacebookTool(facebookClient, name, args);
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
