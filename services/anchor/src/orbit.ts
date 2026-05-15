import { hostname } from "node:os";

import type { OrbitPreflightResult } from "./types";
import {
  ORBIT_URL,
  MAX_SUBSCRIBED_THREADS,
  orbitSocket,
  orbitConnecting,
  orbitHeartbeatInterval,
  orbitHeartbeatTimeout,
  subscribedThreads,
  pendingApprovals,
  approvalRpcIds,
  setOrbitSocket,
  setOrbitConnecting,
  setOrbitHeartbeatInterval,
  setOrbitHeartbeatTimeout,
} from "./config";
import { parseJsonRpcMessage, extractThreadId } from "./utils";
import { maybeHandleAnchorLocalRpc } from "./rpc/router";
import { ensureAppServer, sendToAppServer } from "./app-server";
import { buildOrbitUrl } from "./auth/jwt";

const ORBIT_RECONNECT_BASE_DELAY_MS = 2_000;
const ORBIT_RECONNECT_MAX_DELAY_MS = 30_000;
const ORBIT_RECONNECT_JITTER_RATIO = 0.2;

let orbitReconnectAttempts = 0;
let orbitReconnectTimeout: ReturnType<typeof setTimeout> | null = null;

export function subscribeToThread(threadId: string): void {
  if (subscribedThreads.has(threadId)) return;
  if (!orbitSocket || orbitSocket.readyState !== WebSocket.OPEN) return;

  subscribedThreads.add(threadId);
  if (subscribedThreads.size > MAX_SUBSCRIBED_THREADS) {
    const oldest = subscribedThreads.values().next().value;
    if (oldest) subscribedThreads.delete(oldest);
  }
  try {
    orbitSocket.send(JSON.stringify({ type: "orbit.subscribe", threadId }));
    console.log(`[anchor] subscribed to thread ${threadId}`);
  } catch (err) {
    console.warn("[anchor] failed to subscribe to thread", err);
    subscribedThreads.delete(threadId);
  }
}

function resubscribeAllThreads(): void {
  if (!orbitSocket || orbitSocket.readyState !== WebSocket.OPEN) return;

  for (const threadId of subscribedThreads) {
    try {
      orbitSocket.send(JSON.stringify({ type: "orbit.subscribe", threadId }));
    } catch (err) {
      console.warn("[anchor] failed to resubscribe to thread", err);
    }
  }

  if (subscribedThreads.size > 0) {
    console.log(`[anchor] resubscribed to ${subscribedThreads.size} thread(s)`);
  }
}

function stopOrbitHeartbeat(): void {
  if (orbitHeartbeatInterval) {
    clearInterval(orbitHeartbeatInterval);
    setOrbitHeartbeatInterval(null);
  }
  if (orbitHeartbeatTimeout) {
    clearTimeout(orbitHeartbeatTimeout);
    setOrbitHeartbeatTimeout(null);
  }
}

function startOrbitHeartbeat(ws: WebSocket): void {
  stopOrbitHeartbeat();
  setOrbitHeartbeatInterval(
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
          setOrbitHeartbeatTimeout(
            setTimeout(() => {
              console.warn("[anchor] heartbeat timeout");
              ws.close();
            }, 10_000),
          );
        } catch {
          ws.close();
        }
      }
    }, 30_000),
  );
}

function clearOrbitReconnectTimeout(): void {
  if (orbitReconnectTimeout) {
    clearTimeout(orbitReconnectTimeout);
    orbitReconnectTimeout = null;
  }
}

function scheduleOrbitReconnect(reason: string): void {
  if (orbitReconnectTimeout) return;

  const cappedDelay = Math.min(
    ORBIT_RECONNECT_BASE_DELAY_MS * 2 ** orbitReconnectAttempts,
    ORBIT_RECONNECT_MAX_DELAY_MS,
  );
  const jitter = Math.floor(cappedDelay * ORBIT_RECONNECT_JITTER_RATIO * Math.random());
  const delay = cappedDelay + jitter;
  const attempt = orbitReconnectAttempts + 1;
  orbitReconnectAttempts = attempt;

  console.warn(`[anchor] reconnecting to orbit in ${delay}ms (${reason}; attempt ${attempt})`);
  orbitReconnectTimeout = setTimeout(() => {
    orbitReconnectTimeout = null;
    void connectOrbit();
  }, delay);
}

function describeCloseEvent(event: CloseEvent): string {
  const reason = event.reason ? ` reason="${event.reason}"` : "";
  return `code=${event.code}${reason} clean=${event.wasClean}`;
}

export async function preflightOrbitConnection(): Promise<OrbitPreflightResult> {
  if (!ORBIT_URL) return { ok: true };

  const orbitUrl = await buildOrbitUrl();
  if (!orbitUrl) {
    return { ok: false, kind: "config", detail: "invalid ANCHOR_ORBIT_URL" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(orbitUrl, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 426) return { ok: true };

    const body = (await res.text().catch(() => "")).trim();
    const detail = body || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "auth", detail };
    }
    if (res.status >= 400 && res.status < 500) {
      return { ok: false, kind: "config", detail };
    }
    return { ok: false, kind: "network", detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "network", detail };
  }
}

export async function connectOrbit(): Promise<void> {
  let url: string | null = null;
  try {
    url = await buildOrbitUrl();
  } catch (err) {
    console.error("[anchor] failed to build orbit url", err);
  }
  if (!url) return;
  if (orbitSocket && orbitSocket.readyState !== WebSocket.CLOSED) return;
  if (orbitConnecting) return;

  setOrbitConnecting(true);
  const ws = new WebSocket(url);
  setOrbitSocket(ws);
  let opened = false;

  ws.addEventListener("open", () => {
    if (orbitSocket !== ws) {
      try {
        ws.close(1000, "Superseded by newer connection");
      } catch {
        // ignore
      }
      return;
    }
    opened = true;
    orbitReconnectAttempts = 0;
    clearOrbitReconnectTimeout();
    setOrbitConnecting(false);
    ws.send(JSON.stringify({
      type: "anchor.hello",
      ts: new Date().toISOString(),
      hostname: hostname(),
      platform: process.platform,
    }));
    console.log("[anchor] connected to orbit");
    startOrbitHeartbeat(ws);
    resubscribeAllThreads();
  });

  ws.addEventListener("message", (event) => {
    const text =
      typeof event.data === "string"
        ? event.data
        : event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data)
          : new TextDecoder().decode(event.data as ArrayBuffer);

    if (text === '{"type":"pong"}') {
      if (orbitHeartbeatTimeout) {
        clearTimeout(orbitHeartbeatTimeout);
        setOrbitHeartbeatTimeout(null);
      }
      return;
    }

    // Handle orbit protocol messages
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.type === "string" && (parsed.type as string).startsWith("orbit.")) {
        if (parsed.type === "orbit.client-subscribed" && typeof parsed.threadId === "string") {
          const buffered = pendingApprovals.get(parsed.threadId);
          if (buffered && orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
            try {
              const bufferedMsg = JSON.parse(buffered);
              bufferedMsg._replay = true;
              orbitSocket.send(JSON.stringify(bufferedMsg));
            } catch {
              orbitSocket.send(buffered);
            }
            console.log(`[anchor] re-sent pending approval for thread ${parsed.threadId}`);
          }
        }
        return;
      }
    } catch {
      // Not JSON, continue
    }

    // Handle anchor-local RPC methods from orbit-relayed messages
    const message = parseJsonRpcMessage(text);
    if (message) {
      void maybeHandleAnchorLocalRpc(message).then((resp) => {
        if (!resp) return;
        if (orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
          try { orbitSocket.send(JSON.stringify(resp)); } catch { /* ignore */ }
        }
      });
      if (typeof message.method === "string" && message.method.startsWith("anchor.")) return;
    }

    ensureAppServer();
    if (message && ("method" in message || "id" in message)) {
      const threadId = extractThreadId(message);
      if (threadId) {
        subscribeToThread(threadId);
      }

      const rpcId = message.id as number | string | undefined;
      if (rpcId != null && "result" in message && approvalRpcIds.has(rpcId)) {
        const approvalThread = approvalRpcIds.get(rpcId)!;
        pendingApprovals.delete(approvalThread);
        approvalRpcIds.delete(rpcId);
      }

      sendToAppServer(text.trim() + "\n");
    }
  });

  ws.addEventListener("close", (event) => {
    const detail = describeCloseEvent(event);
    if (orbitSocket !== ws) {
      console.warn(`[anchor] stale orbit socket closed (${detail})`);
      return;
    }

    stopOrbitHeartbeat();
    if (!opened) {
      console.warn(`[anchor] orbit socket closed before handshake completed (${detail})`);
    } else {
      console.warn(`[anchor] orbit socket closed (${detail})`);
    }

    setOrbitSocket(null);
    setOrbitConnecting(false);
    scheduleOrbitReconnect(`closed ${detail}`);
  });

  ws.addEventListener("error", (event) => {
    if (orbitSocket !== ws) {
      console.warn("[anchor] stale orbit socket error", event);
      return;
    }

    stopOrbitHeartbeat();
    if (!opened) {
      console.warn("[anchor] orbit socket error during handshake", event);
    } else {
      console.warn("[anchor] orbit socket error", event);
    }

    setOrbitSocket(null);
    setOrbitConnecting(false);
    scheduleOrbitReconnect("socket error");
  });
}
