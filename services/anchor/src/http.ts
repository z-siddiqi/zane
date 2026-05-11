import { hostname } from "node:os";

import type { WsClient } from "./types";
import { PORT, startedAt, ORBIT_URL, orbitSocket, clients, appServer, appServerInitialized } from "./config";
import { parseJsonRpcMessage } from "./utils";
import { maybeHandleAnchorLocalRpc } from "./rpc/router";
import { ensureAppServer, sendToAppServer } from "./app-server";

export const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      const orbitStatus = !ORBIT_URL
        ? "disabled"
        : orbitSocket && orbitSocket.readyState === WebSocket.OPEN
          ? "connected"
          : "disconnected";
      return Response.json({
        status: "ok",
        appServer: appServer !== null,
        appServerInitialized,
        orbit: orbitStatus,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        port: PORT,
      });
    }

    if (url.pathname === "/ws/anchor" || url.pathname === "/ws") {
      if (server.upgrade(req)) return new Response(null, { status: 101 });
      return new Response("Upgrade required", { status: 426 });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws as WsClient);
      ensureAppServer();
      ws.send(JSON.stringify({
        type: "anchor.hello",
        ts: new Date().toISOString(),
        hostname: hostname(),
        platform: process.platform,
      }));
    },
    message(ws, message) {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);

      // Forward orbit protocol messages to orbit
      try {
        const obj = JSON.parse(text) as Record<string, unknown>;
        if (typeof obj.type === "string" && (obj.type as string).startsWith("orbit.")) {
          if (orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
            orbitSocket.send(text);
          }
          return;
        }
      } catch {
        // Fall through to app-server path
      }

      // Handle anchor-local RPC methods
      const parsed = parseJsonRpcMessage(text);
      if (parsed) {
        void maybeHandleAnchorLocalRpc(parsed).then((resp) => {
          if (!resp) return;
          try { (ws as WsClient).send(JSON.stringify(resp)); } catch { /* ignore */ }
        });
        if (typeof parsed.method === "string" && parsed.method.startsWith("anchor.")) return;
      }

      ensureAppServer();
      if (!appServer) return;
      if (parsed && ("method" in parsed || "id" in parsed)) {
        sendToAppServer(text.trim() + "\n");
      }
    },
    close(ws) {
      clients.delete(ws as WsClient);
    },
  },
});
