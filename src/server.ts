/**
 * RESPONSIBILITY:
 * The entry point of the application.
 * Initializes the environment, Express app, MetaService, and the MCP Server.
 * Orchestrates the connection logic between Transports and the Server.
 */
import { supabase } from './lib/supabase.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import "dotenv/config";

import { MetaService } from "./services/metaService.js";
import { WebSocketTransport } from "./transports/WebSocketTransport.js";
import { registerTools } from "./tools/index.js";

const PORT = Number(process.env.PORT) || 3000;
const USE_WEBSOCKET = process.env.USE_WEBSOCKET === "true";

// 1. Initialize Services and MCP Server
const metaService = new MetaService(
  process.env.META_ACCESS_TOKEN!,
  process.env.META_CATALOG_ID!
);

const server = new McpServer({
  name: "souq-link-mcp",
  version: "1.0.0",
});

// Register all MCP tools
registerTools(server, metaService);

// 2. Start the Server based on chosen mode
if (USE_WEBSOCKET) {
  const app = express();
  
  app.use(express.static('public'));

  app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "public" });
  });

  app.get("/auth/callback", async (req, res) => {
    const code = req.query.code;
    
    if (!code) return res.status(400).send("لم يتم استلام كود.");

    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers.host;
        const redirectUri = `${protocol}://${host}/auth/callback`;

        console.log(`🚀 محاولة التبادل باستخدام:`);
        
        const params = new URLSearchParams();
        params.append('client_id', process.env.META_APP_ID!);
        params.append('client_secret', process.env.META_APP_SECRET!);
        params.append('redirect_uri', redirectUri);
        params.append('code', code as string);

        const response = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`);
        const data: any = await response.json();

        if (data.access_token) {
            console.log("✅ تم استلام التوكين القصير، جاري تحويله لتوكين طويل الأمد...");
            const longLivedData = await metaService.exchangeForLongLivedToken(data.access_token);

            if (longLivedData.access_token) {
                console.log("🚀 حصلنا على التوكين الطويل، جاري الحفظ في Supabase...");
                const catalogId = process.env.META_CATALOG_ID;

                const { error } = await supabase
                    .from('merchants')
                    .upsert({ 
                        catalog_id: catalogId,
                        access_token: longLivedData.access_token,
                        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
                    }, { onConflict: 'catalog_id' });

                if (error) {
                    console.error("❌ فشل الحفظ في Supabase:", error.message);
                    return res.status(500).send("فشل حفظ البيانات في قاعدة البيانات.");
                }

                console.log("✅ تمت مزامنة بيانات التاجر بنجاح!");
                return res.send("<h1>تم الربط والحفظ في Supabase بنجاح! 🎉</h1>");
            }
        } else {
            console.error("❌ خطأ من ميتا:", data.error);
            return res.status(500).json({
                error: "فشل التبادل",
                message: data.error?.message || "Unknown error",
                type: data.error?.type || "OAuthException"
            });
        }
    } catch (error) {
        console.error("❌ خطأ داخلي:", error);
        res.status(500).send("خطأ تقني في السيرفر.");
    }
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`🚀 MCP Server (WebSocket) running on port ${PORT}`);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", async (ws: WebSocket) => {
    console.log("✅ New client connected over WebSocket");
    const transport = new WebSocketTransport(ws);
    await server.connect(transport);
  });

} else {
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("🚀 MCP Server (STDIO) running");
  });
}