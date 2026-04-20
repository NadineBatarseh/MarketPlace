/**
 * TOOLS INDEX
 *
 * This is the single entry point for all MCP tools.
 * server.ts calls registerAllTools(server) once —
 * and every tool from every role gets registered.
 *
 * To add a new role's tools in the future:
 *   1. Create the file (e.g. adminTools.ts)
 *   2. Import it here
 *   3. Call it inside registerAllTools()
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaService } from "../../services/metaService.js";
import { registerMerchantTools } from "./merchantTools.js";
// import { registerAdminTools }    from "./adminTools.js";    // coming soon
// import { registerCustomerTools } from "./customerTools.js"; // coming soon
// import { registerMetaTools }     from "./metaCatalogTools.js"; // coming soon

export function registerAllTools(server: McpServer, metaService: MetaService) {
  registerMerchantTools(server);
  // registerAdminTools(server);
  // registerCustomerTools(server);
  // registerMetaTools(server, metaService);
}
