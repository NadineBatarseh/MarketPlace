/**
 * RESPONSIBILITY:
 * Acts as a bridge/translator between the WebSocket protocol and the MCP protocol.
 * It listens for incoming network messages, parses them for the MCP server,
 * and sends MCP responses back to the client over the network.
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { WebSocket } from "ws";

export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  onmessage?: (message: any) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  async start(): Promise<void> {
    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (this.onmessage) this.onmessage(message);
      } catch (error) {
        if (this.onerror) this.onerror(error as Error);
      }
    });

    this.ws.on("close", () => {
      if (this.onclose) this.onclose();
    });

    this.ws.on("error", (error) => {
      if (this.onerror) this.onerror(error);
    });
  }

  async send(message: any): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    this.ws.close();
  }
}