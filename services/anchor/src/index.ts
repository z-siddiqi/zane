import type { WsClient } from "./types.ts";

const PORT = Number(process.env.ANCHOR_PORT ?? 8788);
const AUTH_TOKEN = process.env.ANCHOR_TOKEN ?? "";
const AUTOSTART = (process.env.ANCHOR_AUTOSTART ?? "true").toLowerCase() === "true";
const ORBIT_URL = process.env.ANCHOR_ORBIT_URL ?? "";
const ORBIT_TOKEN = process.env.ANCHOR_ORBIT_TOKEN ?? "";
const ORBIT_RECONNECT_MS = Number(process.env.ANCHOR_ORBIT_RECONNECT_MS ?? 2000);

const clients = new Set<WsClient>();
let appServer: Bun.Subprocess | null = null;
let appServerStarting = false;
let orbitSocket: WebSocket | null = null;
let orbitConnecting = false;

function isAuthorised(req: Request): boolean {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${AUTH_TOKEN}`;
}

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

    appServer.exited.then((code) => {
      console.warn(`[anchor] app-server exited with code ${code}`);
      appServer = null;
    });

    streamLines(appServer.stdout, (line) => {
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

function isWritableStream(input: unknown): input is WritableStream<Uint8Array> {
  return typeof (input as WritableStream<Uint8Array>)?.getWriter === "function";
}

function isFileSink(input: unknown): input is { write: (data: string | Uint8Array) => void } {
  return typeof (input as { write?: unknown })?.write === "function";
}

function sendToAppServer(payload: string): void {
  if (!appServer || appServer.stdin === undefined || typeof appServer.stdin === "number") return;

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

function buildOrbitUrl(): string | null {
  if (!ORBIT_URL) return null;
  try {
    const url = new URL(ORBIT_URL);
    if (ORBIT_TOKEN && !url.searchParams.has("token")) {
      url.searchParams.set("token", ORBIT_TOKEN);
    }
    return url.toString();
  } catch (err) {
    console.error("[anchor] invalid ANCHOR_ORBIT_URL", err);
    return null;
  }
}

function connectOrbit(): void {
  const url = buildOrbitUrl();
  if (!url) return;
  if (orbitSocket && orbitSocket.readyState !== WebSocket.CLOSED) return;
  if (orbitConnecting) return;

  orbitConnecting = true;
  const ws = new WebSocket(url);
  orbitSocket = ws;

  ws.addEventListener("open", () => {
    orbitConnecting = false;
    ws.send(
      JSON.stringify({
        type: "anchor.hello",
        ts: new Date().toISOString(),
      }),
    );
    console.log("[anchor] connected to orbit");
  });

  ws.addEventListener("message", (event) => {
    ensureAppServer();
    const text =
      typeof event.data === "string"
        ? event.data
        : event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data)
          : new TextDecoder().decode(event.data as ArrayBuffer);
    if (isJsonRpcMessage(text)) {
      sendToAppServer(normalizeLine(text));
    }
  });

  ws.addEventListener("close", () => {
    orbitSocket = null;
    orbitConnecting = false;
    setTimeout(connectOrbit, ORBIT_RECONNECT_MS);
  });

  ws.addEventListener("error", () => {
    orbitSocket = null;
    orbitConnecting = false;
    setTimeout(connectOrbit, ORBIT_RECONNECT_MS);
  });
}

function normalizeLine(input: string): string {
  const trimmed = input.replace(/\r?\n$/, "");
  return `${trimmed}\n`;
}

function isJsonRpcMessage(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return "method" in parsed || "id" in parsed;
  } catch {
    return false;
  }
}

async function streamLines(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  onLine: (line: string) => void,
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
      if (!isAuthorised(req)) {
        return new Response("Unauthorised", { status: 401 });
      }

      if (server.upgrade(req)) return new Response(null, { status: 101 });
      return new Response("Upgrade required", { status: 426 });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws as WsClient);
      ensureAppServer();
      ws.send(
        JSON.stringify({
          type: "anchor.hello",
          ts: new Date().toISOString(),
        }),
      );
    },
    message(_ws, message) {
      ensureAppServer();
      if (!appServer) return;
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (isJsonRpcMessage(text)) {
        sendToAppServer(normalizeLine(text));
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

connectOrbit();

console.log(`[anchor] listening on http://localhost:${server.port}`);
console.log(`[anchor] websocket: ws://localhost:${server.port}/ws`);
