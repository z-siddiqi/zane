type Role = "client" | "anchor";
type Direction = "client" | "server";

export interface Env {
  ZANE_WEB_JWT_SECRET?: string;
  ZANE_ANCHOR_JWT_SECRET?: string;
  DB?: D1Database;
  ORBIT_DO: DurableObjectNamespace;
}

const JWT_ISSUER_WEB = "zane-auth";
const JWT_AUDIENCE_WEB = "zane-web";
const JWT_ISSUER_ANCHOR = "zane-anchor";
const JWT_AUDIENCE_ANCHOR = "zane-orbit-anchor";
const JWT_CLOCK_SKEW_SEC = 30;

function getAuthToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwtPart<T>(part: string): T | null {
  try {
    const text = new TextDecoder().decode(base64UrlToBytes(part));
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function verifyJwtHs256(
  token: string,
  secret: string,
  expected: { issuer: string; audience: string },
): Promise<boolean> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return false;

  const header = parseJwtPart<{ alg?: string }>(headerPart);
  if (!header || header.alg !== "HS256") return false;

  const payload = parseJwtPart<{
    iss?: string;
    aud?: string | string[];
    exp?: number;
  }>(payloadPart);
  if (!payload) return false;
  if (payload.iss !== expected.issuer) return false;
  if (payload.aud) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(expected.audience)) return false;
  }
  if (typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp + JWT_CLOCK_SKEW_SEC) return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToBytes(signaturePart);
  return await crypto.subtle.verify("HMAC", key, signature, data);
}

async function isAuthorised(req: Request, env: Env): Promise<boolean> {
  const userSecret = env.ZANE_WEB_JWT_SECRET?.trim();
  const anchorSecret = env.ZANE_ANCHOR_JWT_SECRET?.trim();
  if (!userSecret && !anchorSecret) {
    console.error("[orbit] auth: no secrets configured, denying request");
    return false;
  }

  const provided = (getAuthToken(req) ?? "").trim();
  if (!provided) {
    console.warn("[orbit] auth: missing token");
    return false;
  }

  if (userSecret) {
    const ok = await verifyJwtHs256(provided, userSecret, {
      issuer: JWT_ISSUER_WEB,
      audience: JWT_AUDIENCE_WEB,
    });
    if (ok) {
      console.log("[orbit] auth: web JWT accepted");
      return true;
    }
  }

  if (anchorSecret) {
    const ok = await verifyJwtHs256(provided, anchorSecret, {
      issuer: JWT_ISSUER_ANCHOR,
      audience: JWT_AUDIENCE_ANCHOR,
    });
    if (ok) {
      console.log("[orbit] auth: anchor JWT accepted");
      return true;
    }
  }

  console.warn("[orbit] auth: token rejected");
  return false;
}

function getRoleFromPath(pathname: string): Role | null {
  if (pathname === "/ws/client") return "client";
  if (pathname === "/ws/anchor") return "anchor";
  return null;
}

function corsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = origin ?? "*";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function parseJsonMessage(payload: string): Record<string, unknown> | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractThreadId(message: Record<string, unknown>): string | null {
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

function extractTurnId(message: Record<string, unknown>): string | null {
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const turnFromParams = asRecord(params?.turn);
  const turnFromResult = asRecord(result?.turn);

  const candidates = [params?.turnId, params?.turn_id, turnFromParams?.id, turnFromResult?.id];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }

  return null;
}

function extractMethod(message: Record<string, unknown>): string | null {
  const method = message.method;
  if (typeof method === "string" && method.trim()) return method;
  const type = message.type;
  if (typeof type === "string" && type.trim()) return type;
  return null;
}

async function fetchThreadEvents(req: Request, env: Env, origin: string | null): Promise<Response> {
  if (!env.DB) {
    return new Response("D1 not configured", { status: 501, headers: corsHeaders(origin) });
  }
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const threadId = parts.length === 3 ? parts[1] : null;
  if (!threadId) {
    return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
  }

  const query = env.DB.prepare("SELECT payload FROM events WHERE thread_id = ? ORDER BY id ASC").bind(threadId);
  const { results } = await query.all<{ payload: string }>();
  const lines = results.map((row) => row.payload).join("\n");
  const body = lines ? `${lines}\n` : "";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 200 });
    }

    if (req.method === "OPTIONS" && url.pathname.startsWith("/threads/") && url.pathname.endsWith("/events")) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/threads/") && url.pathname.endsWith("/events")) {
      if (!(await isAuthorised(req, env))) {
        console.warn(`[orbit] events auth failed: ${url.pathname}`);
        return new Response("Unauthorised", { status: 401, headers: corsHeaders(origin) });
      }
      console.log(`[orbit] events request: ${url.pathname}`);
      return fetchThreadEvents(req, env, origin);
    }

    const role = getRoleFromPath(url.pathname);
    if (!role) {
      return new Response("Not found", { status: 404 });
    }

    if (!(await isAuthorised(req, env))) {
      console.warn(`[orbit] ws auth failed: ${url.pathname}`);
      return new Response("Unauthorised", { status: 401 });
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }

    console.log(`[orbit] ws upgrade accepted: ${url.pathname}`);
    const id = env.ORBIT_DO.idFromName("default");
    const stub = env.ORBIT_DO.get(id);
    const nextReq = new Request(req, { headers: new Headers(req.headers) });
    nextReq.headers.set("x-orbit-role", role);

    return stub.fetch(nextReq);
  },
};

export class OrbitRelay {
  private env: Env;
  private clientSockets = new Set<WebSocket>();
  private anchorSockets = new Set<WebSocket>();

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env;
  }

  fetch(req: Request): Response {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }

    const role = req.headers.get("x-orbit-role") as Role | null;
    if (role !== "client" && role !== "anchor") {
      return new Response("Missing role", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    this.registerSocket(server, role);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private registerSocket(socket: WebSocket, role: Role): void {
    const source = role === "client" ? this.clientSockets : this.anchorSockets;
    const targets = role === "client" ? this.anchorSockets : this.clientSockets;
    const direction: Direction = role === "client" ? "client" : "server";

    source.add(socket);

    socket.send(
      JSON.stringify({
        type: "orbit.hello",
        role,
        ts: new Date().toISOString(),
      }),
    );

    socket.addEventListener("message", (event) => {
      this.logEvent(event.data, direction);
      for (const target of targets) {
        try {
          target.send(event.data);
        } catch (err) {
          console.warn("[orbit] failed to relay message", err);
        }
      }
    });

    const cleanup = () => {
      source.delete(socket);
      try {
        socket.close();
      } catch {
        // ignore
      }
    };

    socket.addEventListener("close", cleanup);
    socket.addEventListener("error", cleanup);
  }

  private async logEvent(data: unknown, direction: Direction): Promise<void> {
    if (!this.env.DB) return;

    let payloadStr = "";
    if (typeof data === "string") {
      payloadStr = data;
    } else if (data instanceof ArrayBuffer) {
      payloadStr = new TextDecoder().decode(data);
    } else if (data instanceof Uint8Array) {
      payloadStr = new TextDecoder().decode(data);
    } else {
      return;
    }

    const message = parseJsonMessage(payloadStr);
    if (!message) return;

    const threadId = extractThreadId(message);
    if (!threadId) return;

    const method = extractMethod(message);
    const turnId = extractTurnId(message);
    const entry = {
      ts: new Date().toISOString(),
      direction,
      message,
    };

    try {
      await this.env.DB.prepare(
        "INSERT INTO events (thread_id, turn_id, direction, role, method, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          threadId,
          turnId,
          direction,
          direction === "client" ? "client" : "anchor",
          method,
          JSON.stringify(entry),
          Math.floor(Date.now() / 1000),
        )
        .run();
    } catch (err) {
      console.warn("[orbit] failed to log event", err);
    }
  }
}
