import type { WsClient } from "./types";

const PORT = Number(process.env.ANCHOR_PORT ?? 8788);
const AUTOSTART = (process.env.ANCHOR_AUTOSTART ?? "true").toLowerCase() === "true";
const ORBIT_URL = process.env.ANCHOR_ORBIT_URL ?? "";
const ZANE_ANCHOR_JWT_SECRET = process.env.ZANE_ANCHOR_JWT_SECRET ?? "";
const ANCHOR_APP_CWD = process.env.ANCHOR_APP_CWD ?? process.cwd();
const USER_ID = process.env.USER_ID;
const ANCHOR_JWT_TTL_SEC = Number(process.env.ANCHOR_JWT_TTL_SEC ?? 300);
const ORBIT_RECONNECT_DELAY_MS = 2000;
const ORBIT_HEARTBEAT_INTERVAL_MS = 30000;
const ORBIT_HEARTBEAT_TIMEOUT_MS = 10000;

if (ORBIT_URL && !ZANE_ANCHOR_JWT_SECRET) {
  console.error("[anchor] ZANE_ANCHOR_JWT_SECRET is required when ANCHOR_ORBIT_URL is set");
  process.exit(1);
}

if (ORBIT_URL && !USER_ID) {
  console.error("[anchor] USER_ID is required when ANCHOR_ORBIT_URL is set");
  process.exit(1);
}

const MAX_SUBSCRIBED_THREADS = 1000;
const clients = new Set<WsClient>();
const subscribedThreads = new Set<string>();
let appServer: Bun.Subprocess | null = null;
let appServerStarting = false;
let orbitSocket: WebSocket | null = null;
let orbitConnecting = false;
let orbitHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let orbitHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
let warnedNoAppServer = false;
let appServerInitialized = false;

function ensureAppServer(): void {
  if (appServer || appServerStarting) return;
  appServerStarting = true;

  try {
    appServer = Bun.spawn({
      cmd: ["codex", "app-server"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    warnedNoAppServer = false;
    appServerInitialized = false;
    initializeAppServer();

    appServer.exited.then((code) => {
      console.warn(`[anchor] app-server exited with code ${code}`);
      appServer = null;
      appServerInitialized = false;
    });

    streamLines(appServer.stdout, (line) => {
      // Auto-subscribe to threads from app-server messages
      const parsed = parseJsonRpcMessage(line);
      if (parsed) {
        const threadId = extractThreadId(parsed);
        if (threadId) {
          subscribeToThread(threadId);
        }
      }

      for (const client of clients) {
        try {
          client.send(line);
        } catch (err) {
          console.warn("[anchor] failed to send to client", err);
        }
      }

      if (orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
        try {
          orbitSocket.send(line);
        } catch (err) {
          console.warn("[anchor] failed to send to orbit", err);
        }
      }
    });

    streamLines(appServer.stderr, (line) => {
      console.error(`[app-server] ${line}`);
    });
  } catch (err) {
    console.error("[anchor] failed to start codex app-server", err);
    appServer = null;
  } finally {
    appServerStarting = false;
  }
}

function initializeAppServer(): void {
  if (appServerInitialized) return;
  const initPayload = JSON.stringify({
    method: "initialize",
    id: Date.now(),
    params: {
      cwd: ANCHOR_APP_CWD,
      clientInfo: {
        name: "zane-anchor",
        version: "dev",
        platform: process.platform,
      },
    },
  });
  console.log(`[anchor] app-server initialize: cwd=${ANCHOR_APP_CWD}`);
  sendToAppServer(initPayload + "\n");
  appServerInitialized = true;
}

function isWritableStream(input: unknown): input is WritableStream<Uint8Array> {
  return typeof (input as WritableStream<Uint8Array>)?.getWriter === "function";
}

function isFileSink(input: unknown): input is { write: (data: string | Uint8Array) => void } {
  return typeof (input as { write?: unknown })?.write === "function";
}

function sendToAppServer(payload: string): void {
  if (!appServer || appServer.stdin === undefined || typeof appServer.stdin === "number") {
    if (!warnedNoAppServer) {
      console.warn("[anchor] app-server not running; cannot forward payload");
      warnedNoAppServer = true;
    }
    return;
  }

  const stdin = appServer.stdin;
  if (isWritableStream(stdin)) {
    const writer = stdin.getWriter();
    writer.write(new TextEncoder().encode(payload));
    writer.releaseLock();
    return;
  }
  if (isFileSink(stdin)) {
    stdin.write(payload);
  }
}

type JsonObject = Record<string, unknown>;

function parseJsonRpcMessage(payload: string): JsonObject | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as JsonObject;
    if ("method" in parsed || "id" in parsed) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function asRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function extractThreadId(message: JsonObject): string | null {
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const threadFromParams = asRecord(params?.thread);
  const threadFromResult = asRecord(result?.thread);

  const candidates = [
    params?.threadId,
    params?.thread_id,
    result?.threadId,
    result?.thread_id,
    threadFromParams?.id,
    threadFromResult?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }

  return null;
}

function subscribeToThread(threadId: string): void {
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwtHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encoder = new TextEncoder();
  const headerPart = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const data = encoder.encode(`${headerPart}.${payloadPart}`);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const signaturePart = base64UrlEncode(signature);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

async function buildOrbitUrl(): Promise<string | null> {
  if (!ORBIT_URL) return null;
  try {
    const url = new URL(ORBIT_URL);
    if (ZANE_ANCHOR_JWT_SECRET) {
      const now = Math.floor(Date.now() / 1000);
      const token = await signJwtHs256(
        {
          iss: "zane-anchor",
          aud: "zane-orbit-anchor",
          sub: USER_ID,
          iat: now,
          exp: now + ANCHOR_JWT_TTL_SEC,
        },
        ZANE_ANCHOR_JWT_SECRET
      );
      url.searchParams.set("token", token);
    }
    return url.toString();
  } catch (err) {
    console.error("[anchor] invalid ANCHOR_ORBIT_URL", err);
    return null;
  }
}

function stopOrbitHeartbeat(): void {
  if (orbitHeartbeatInterval) {
    clearInterval(orbitHeartbeatInterval);
    orbitHeartbeatInterval = null;
  }
  if (orbitHeartbeatTimeout) {
    clearTimeout(orbitHeartbeatTimeout);
    orbitHeartbeatTimeout = null;
  }
}

function startOrbitHeartbeat(ws: WebSocket): void {
  stopOrbitHeartbeat();
  orbitHeartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
        orbitHeartbeatTimeout = setTimeout(() => {
          console.warn("[anchor] heartbeat timeout");
          ws.close();
        }, ORBIT_HEARTBEAT_TIMEOUT_MS);
      } catch {
        ws.close();
      }
    }
  }, ORBIT_HEARTBEAT_INTERVAL_MS);
}

async function connectOrbit(): Promise<void> {
  let url: string | null = null;
  try {
    url = await buildOrbitUrl();
  } catch (err) {
    console.error("[anchor] failed to build orbit url", err);
  }
  if (!url) return;
  if (orbitSocket && orbitSocket.readyState !== WebSocket.CLOSED) return;
  if (orbitConnecting) return;

  orbitConnecting = true;
  const ws = new WebSocket(url);
  orbitSocket = ws;

  ws.addEventListener("open", () => {
    orbitConnecting = false;
    ws.send(JSON.stringify({ type: "anchor.hello", ts: new Date().toISOString() }));
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

    if (text === "pong" || text === '{"type":"pong"}') {
      if (orbitHeartbeatTimeout) {
        clearTimeout(orbitHeartbeatTimeout);
        orbitHeartbeatTimeout = null;
      }
      return;
    }

    // Filter out orbit protocol messages
    try {
      const parsed = JSON.parse(text) as JsonObject;
      if (typeof parsed.type === "string" && (parsed.type as string).startsWith("orbit.")) {
        return;
      }
    } catch {
      // Not JSON, continue
    }

    ensureAppServer();
    const message = parseJsonRpcMessage(text);
    if (message && ("method" in message || "id" in message)) {
      // Auto-subscribe to threads from orbit messages
      const threadId = extractThreadId(message);
      if (threadId) {
        subscribeToThread(threadId);
      }
      sendToAppServer(text.trim() + "\n");
    }
  });

  ws.addEventListener("close", () => {
    stopOrbitHeartbeat();
    orbitSocket = null;
    orbitConnecting = false;
    setTimeout(() => void connectOrbit(), ORBIT_RECONNECT_DELAY_MS);
  });

  ws.addEventListener("error", () => {
    stopOrbitHeartbeat();
    orbitSocket = null;
    orbitConnecting = false;
  });
}

async function streamLines(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  onLine: (line: string) => void
): Promise<void> {
  if (!stream || typeof stream === "number") return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.length === 0) continue;
      onLine(part);
    }
  }

  const tail = buffer.trim();
  if (tail.length > 0) onLine(tail);
}

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 200 });
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
      ws.send(JSON.stringify({ type: "anchor.hello", ts: new Date().toISOString() }));
    },
    message(_ws, message) {
      ensureAppServer();
      if (!appServer) return;
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const parsed = parseJsonRpcMessage(text);
      if (parsed && ("method" in parsed || "id" in parsed)) {
        sendToAppServer(text.trim() + "\n");
      }
    },
    close(ws) {
      clients.delete(ws as WsClient);
    },
  },
});

if (AUTOSTART) {
  ensureAppServer();
}

void connectOrbit();

console.log(`[anchor] listening on http://localhost:${server.port}`);
console.log(`[anchor] websocket: ws://localhost:${server.port}/ws`);
