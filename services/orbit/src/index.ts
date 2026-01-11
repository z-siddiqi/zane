type Role = "client" | "anchor";

export interface Env {
  ORBIT_TOKEN?: string;
  ORBIT_DO: DurableObjectNamespace;
}

function getAuthToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

function isAuthorised(req: Request, env: Env): boolean {
  const required = env.ORBIT_TOKEN ?? "";
  if (!required) return true;
  const provided = getAuthToken(req) ?? "";
  return provided === required;
}

function getRoleFromPath(pathname: string): Role | null {
  if (pathname === "/ws/client") return "client";
  if (pathname === "/ws/anchor") return "anchor";
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 200 });
    }

    const role = getRoleFromPath(url.pathname);
    if (!role) {
      return new Response("Not found", { status: 404 });
    }

    if (!isAuthorised(req, env)) {
      return new Response("Unauthorised", { status: 401 });
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }

    const id = env.ORBIT_DO.idFromName("default");
    const stub = env.ORBIT_DO.get(id);
    const nextReq = new Request(req, { headers: new Headers(req.headers) });
    nextReq.headers.set("x-orbit-role", role);

    return stub.fetch(nextReq);
  },
};

export class OrbitRelay {
  private clientSockets = new Set<WebSocket>();
  private anchorSockets = new Set<WebSocket>();

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

    source.add(socket);

    socket.send(
      JSON.stringify({
        type: "orbit.hello",
        role,
        ts: new Date().toISOString(),
      }),
    );

    socket.addEventListener("message", (event) => {
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
}
