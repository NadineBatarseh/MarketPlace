/**
 * RESPONSIBILITY:
 * Acts as a bridge/translator between the WebSocket protocol and the MCP protocol.
 * It listens for incoming network messages, parses them for the MCP server,
 * and sends MCP responses back to the client over the network.
 */
import { WebSocket } from "ws";
export class WebSocketTransport {
    ws;
    onmessage;
    onerror;
    onclose;
    constructor(ws) {
        this.ws = ws;
    }
    async start() {
        this.ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (this.onmessage)
                    this.onmessage(message);
            }
            catch (error) {
                if (this.onerror)
                    this.onerror(error);
            }
        });
        this.ws.on("close", () => {
            if (this.onclose)
                this.onclose();
        });
        this.ws.on("error", (error) => {
            if (this.onerror)
                this.onerror(error);
        });
    }
    async send(message) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    async close() {
        this.ws.close();
    }
}
