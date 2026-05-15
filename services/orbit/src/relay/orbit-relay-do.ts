import { sendPush, type PushPayload, type VapidKeys } from "../push";
import type { Env, Role } from "../types";
import { asRecord, extractMethod, extractThreadId, parseJsonMessage } from "../utils/protocol";

interface AnchorMeta {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
}

interface SocketAttachment {
  role: Role;
  userId: string;
  clientId?: string;
  threads: string[];
  anchorMeta?: AnchorMeta;
}

export class OrbitRelay implements DurableObject {
  private env: Env;
  private state: DurableObjectState;
  private userId: string | null = null;

  // Socket -> subscribed thread IDs
  private clientSockets = new Map<WebSocket, Set<string>>();
  private anchorSockets = new Map<WebSocket, Set<string>>();
  private anchorMeta = new Map<WebSocket, AnchorMeta>();
  private clientIdToSocket = new Map<string, WebSocket>();
  private socketToClientId = new Map<WebSocket, string>();

  // Thread ID -> subscribed sockets (reverse index for fast routing)
  private threadToClients = new Map<string, Set<WebSocket>>();
  private threadToAnchors = new Map<string, Set<WebSocket>>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.rebuildIndexesFromAttachedSockets();
  }

  fetch(req: Request): Response {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }

    const role = req.headers.get("x-orbit-role") as Role | null;
    if (role !== "client" && role !== "anchor") {
      return new Response("Missing role", { status: 400 });
    }

    const userId = req.headers.get("x-orbit-user-id");
    if (!userId) {
      return new Response("Missing user identity", { status: 400 });
    }
    this.userId = userId;

    const url = new URL(req.url);
    const clientId = role === "client" ? url.searchParams.get("clientId") : null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.serializeAttachment({ role, userId, clientId: clientId ?? undefined, threads: [] } satisfies SocketAttachment);
    this.state.acceptWebSocket(server, [role]);

    this.registerSocket(server, role, clientId, userId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = this.getSocketAttachment(socket);
    if (!attachment) {
      try {
        socket.close(1008, "Missing socket attachment");
      } catch {
        // ignore
      }
      return;
    }

    this.userId = attachment.userId;
    if (this.handlePing(socket, message)) {
      return;
    }

    const payloadStr = this.dataToString(message);
    const parsed = payloadStr ? parseJsonMessage(payloadStr) : null;

    if (this.handleSubscription(socket, attachment.role, parsed)) {
      return;
    }

    if (this.handleAnchorHello(socket, attachment.role, parsed)) {
      return;
    }

    this.routeMessage(socket, attachment.role, message, parsed);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    const attachment = this.getSocketAttachment(socket);
    if (attachment) {
      this.removeSocket(socket, attachment.role);
    }
    console.log(`[orbit] websocket closed role=${attachment?.role ?? "unknown"} code=${code} reason="${reason}" clean=${wasClean}`);

    try {
      socket.close(code, reason);
    } catch {
      // ignore
    }
  }

  webSocketError(socket: WebSocket, error: unknown): void {
    const attachment = this.getSocketAttachment(socket);
    if (attachment) {
      this.removeSocket(socket, attachment.role);
    }
    console.warn(`[orbit] websocket error role=${attachment?.role ?? "unknown"}`, error);

    try {
      socket.close(1011, "WebSocket error");
    } catch {
      // ignore
    }
  }

  private registerSocket(socket: WebSocket, role: Role, clientId: string | null, userId: string): void {
    const source = role === "client" ? this.clientSockets : this.anchorSockets;

    if (role === "client" && clientId) {
      const existing = this.clientIdToSocket.get(clientId);
      if (existing && existing !== socket) {
        this.removeSocket(existing, "client");
        try {
          existing.close(1000, "Replaced by newer connection");
        } catch {
          // ignore
        }
      }
      this.clientIdToSocket.set(clientId, socket);
      this.socketToClientId.set(socket, clientId);
    }

    source.set(socket, new Set());
    this.writeSocketAttachment(socket, { role, userId, clientId: clientId ?? undefined, threads: [] });

    socket.send(
      JSON.stringify({
        type: "orbit.hello",
        role,
        ts: new Date().toISOString(),
      })
    );
  }

  private rebuildIndexesFromAttachedSockets(): void {
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.getSocketAttachment(socket);
      if (!attachment) continue;

      this.userId ??= attachment.userId;
      const source = attachment.role === "client" ? this.clientSockets : this.anchorSockets;
      const threads = new Set(attachment.threads);
      source.set(socket, threads);

      for (const threadId of threads) {
        const threadSockets = attachment.role === "client" ? this.threadToClients : this.threadToAnchors;
        if (!threadSockets.has(threadId)) {
          threadSockets.set(threadId, new Set());
        }
        threadSockets.get(threadId)!.add(socket);
      }

      if (attachment.role === "client" && attachment.clientId) {
        this.clientIdToSocket.set(attachment.clientId, socket);
        this.socketToClientId.set(socket, attachment.clientId);
      }

      if (attachment.role === "anchor" && attachment.anchorMeta) {
        this.anchorMeta.set(socket, attachment.anchorMeta);
      }
    }
  }

  private getSocketAttachment(socket: WebSocket): SocketAttachment | null {
    const attachment = socket.deserializeAttachment() as Partial<SocketAttachment> | null;
    if (!attachment || (attachment.role !== "client" && attachment.role !== "anchor")) return null;
    if (typeof attachment.userId !== "string" || !attachment.userId) return null;

    return {
      role: attachment.role,
      userId: attachment.userId,
      clientId: typeof attachment.clientId === "string" ? attachment.clientId : undefined,
      threads: Array.isArray(attachment.threads)
        ? attachment.threads.filter((threadId): threadId is string => typeof threadId === "string" && !!threadId)
        : [],
      anchorMeta: this.isAnchorMeta(attachment.anchorMeta) ? attachment.anchorMeta : undefined,
    };
  }

  private writeSocketAttachment(socket: WebSocket, update: Partial<SocketAttachment>): void {
    const current = this.getSocketAttachment(socket);
    if (!current && (!update.role || !update.userId)) return;
    const next: SocketAttachment = {
      role: update.role ?? current!.role,
      userId: update.userId ?? current!.userId,
      clientId: update.clientId ?? current?.clientId,
      threads: update.threads ?? current?.threads ?? [],
      anchorMeta: update.anchorMeta ?? current?.anchorMeta,
    };
    socket.serializeAttachment(next);
  }

  private isAnchorMeta(value: unknown): value is AnchorMeta {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const meta = value as Record<string, unknown>;
    return (
      typeof meta.id === "string" &&
      typeof meta.hostname === "string" &&
      typeof meta.platform === "string" &&
      typeof meta.connectedAt === "string"
    );
  }

  private handleSubscription(socket: WebSocket, role: Role, msg: Record<string, unknown> | null): boolean {
    if (!msg) return false;

    if (msg.type === "orbit.subscribe" && typeof msg.threadId === "string") {
      this.subscribeSocket(socket, role, msg.threadId);
      try {
        socket.send(JSON.stringify({ type: "orbit.subscribed", threadId: msg.threadId }));
      } catch {
        // ignore
      }
      console.log(`[orbit] ${role} subscribed to thread ${msg.threadId}`);

      // Notify anchors so they can re-send any pending approval from memory
      if (role === "client") {
        const notification = JSON.stringify({ type: "orbit.client-subscribed", threadId: msg.threadId });
        const anchors = this.threadToAnchors.get(msg.threadId);
        if (anchors) {
          for (const anchor of anchors) {
            try { anchor.send(notification); } catch { /* ignore */ }
          }
        }
      }

      return true;
    }

    if (msg.type === "orbit.unsubscribe" && typeof msg.threadId === "string") {
      this.unsubscribeSocket(socket, role, msg.threadId);
      console.log(`[orbit] ${role} unsubscribed from thread ${msg.threadId}`);
      return true;
    }

    if (msg.type === "orbit.list-anchors" && role === "client") {
      const anchors = Array.from(this.anchorMeta.values());
      try {
        socket.send(JSON.stringify({ type: "orbit.anchors", anchors }));
      } catch {
        // ignore
      }
      return true;
    }

    if (msg.type === "orbit.push-subscribe" && role === "client") {
      this.savePushSubscription(msg);
      return true;
    }

    if (msg.type === "orbit.push-unsubscribe" && role === "client") {
      this.removePushSubscription(msg);
      return true;
    }

    if (msg.type === "orbit.push-test" && role === "client") {
      this.sendTestPush(socket);
      return true;
    }

    return false;
  }

  private handleAnchorHello(socket: WebSocket, role: Role, msg: Record<string, unknown> | null): boolean {
    if (!msg || role !== "anchor" || msg.type !== "anchor.hello") return false;

    const meta: AnchorMeta = {
      id: crypto.randomUUID(),
      hostname: typeof msg.hostname === "string" ? msg.hostname : "unknown",
      platform: typeof msg.platform === "string" ? msg.platform : "unknown",
      connectedAt: typeof msg.ts === "string" ? msg.ts : new Date().toISOString(),
    };

    this.anchorMeta.set(socket, meta);
    this.writeSocketAttachment(socket, { anchorMeta: meta });

    const notification = JSON.stringify({ type: "orbit.anchor-connected", anchor: meta });
    for (const clientSocket of this.clientSockets.keys()) {
      try {
        clientSocket.send(notification);
      } catch {
        // ignore
      }
    }

    return true;
  }

  private subscribeSocket(socket: WebSocket, role: Role, threadId: string): void {
    const socketThreads = role === "client"
      ? this.clientSockets.get(socket)
      : this.anchorSockets.get(socket);

    if (socketThreads) {
      socketThreads.add(threadId);
      this.writeSocketAttachment(socket, { threads: Array.from(socketThreads) });
    }

    const threadSockets = role === "client" ? this.threadToClients : this.threadToAnchors;
    if (!threadSockets.has(threadId)) {
      threadSockets.set(threadId, new Set());
    }
    threadSockets.get(threadId)!.add(socket);
  }

  private unsubscribeSocket(socket: WebSocket, role: Role, threadId: string): void {
    const socketThreads = role === "client"
      ? this.clientSockets.get(socket)
      : this.anchorSockets.get(socket);

    if (socketThreads) {
      socketThreads.delete(threadId);
      this.writeSocketAttachment(socket, { threads: Array.from(socketThreads) });
    }

    const threadSockets = role === "client" ? this.threadToClients : this.threadToAnchors;
    const sockets = threadSockets.get(threadId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        threadSockets.delete(threadId);
      }
    }
  }

  private removeSocket(socket: WebSocket, role: Role): void {
    const source = role === "client" ? this.clientSockets : this.anchorSockets;
    const threadSockets = role === "client" ? this.threadToClients : this.threadToAnchors;

    const threads = source.get(socket);
    if (threads) {
      for (const threadId of threads) {
        const sockets = threadSockets.get(threadId);
        if (sockets) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            threadSockets.delete(threadId);
          }
        }
      }
    }

    source.delete(socket);

    if (role === "client") {
      const clientId = this.socketToClientId.get(socket);
      if (clientId) {
        this.socketToClientId.delete(socket);
        if (this.clientIdToSocket.get(clientId) === socket) {
          this.clientIdToSocket.delete(clientId);
        }
      }
    }

    if (role === "anchor") {
      const meta = this.anchorMeta.get(socket);
      if (meta) {
        this.anchorMeta.delete(socket);
        const notification = JSON.stringify({ type: "orbit.anchor-disconnected", anchorId: meta.id });
        for (const clientSocket of this.clientSockets.keys()) {
          try {
            clientSocket.send(notification);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  private routeMessage(socket: WebSocket, role: Role, data: string | ArrayBuffer | ArrayBufferView, msg: Record<string, unknown> | null): void {
    const threadId = msg ? extractThreadId(msg) : null;

    if (role === "client") {
      // TODO: broadcasts to all anchors — won't scale if multiple anchors serve distinct threads
      for (const target of this.anchorSockets.keys()) {
        try {
          target.send(data);
        } catch (err) {
          console.warn("[orbit] failed to relay message", err);
        }
      }
    } else {
      // Anchor → client: thread-scoped messages go to subscribers only
      if (threadId) {
        const targets = this.threadToClients.get(threadId);
        if (targets && targets.size > 0) {
          for (const target of targets) {
            try {
              target.send(data);
            } catch (err) {
              console.warn("[orbit] failed to relay message", err);
            }
          }
        } else {
          // No subscribers yet (e.g. thread/start response) — broadcast to all clients
          for (const target of this.clientSockets.keys()) {
            try {
              target.send(data);
            } catch (err) {
              console.warn("[orbit] failed to relay message", err);
            }
          }
        }
      } else {
        // No threadId — broadcast to all clients
        for (const target of this.clientSockets.keys()) {
          try {
            target.send(data);
          } catch (err) {
            console.warn("[orbit] failed to relay message", err);
          }
        }
      }

      // Send push notification for blocking events (async, non-blocking)
      if (msg) {
        const method = extractMethod(msg);
        if (method && this.isPushWorthy(method)) {
          this.sendPushNotifications(msg, method, threadId);
        }
      }
    }
  }

  private dataToString(data: unknown): string | null {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (data instanceof Uint8Array) return new TextDecoder().decode(data);
    return null;
  }

  private handlePing(socket: WebSocket, data: unknown): boolean {
    const payload = this.dataToString(data);
    if (!payload) return false;

    const trimmed = payload.trim();
    if (trimmed === '{"type":"ping"}') {
      try {
        socket.send(JSON.stringify({ type: "pong" }));
      } catch {}
      return true;
    }

    return false;
  }

  private isPushWorthy(method: string): boolean {
    return method.endsWith("/requestApproval") || method === "item/tool/requestUserInput";
  }

  private buildPushPayload(msg: Record<string, unknown>, method: string, threadId: string | null): PushPayload {
    const params = asRecord(msg.params);
    const reason = (params?.reason as string) || "";

    let type = "approval";
    let title = "Approval Required";
    let body = reason || "An action requires your approval";

    if (method === "item/fileChange/requestApproval") {
      title = "File Change Approval";
      body = reason || "A file change needs your approval";
    } else if (method === "item/commandExecution/requestApproval") {
      title = "Command Approval";
      body = reason || "A command needs your approval";
    } else if (method === "item/mcpToolCall/requestApproval") {
      title = "Tool Call Approval";
      body = reason || "A tool call needs your approval";
    } else if (method === "item/tool/requestUserInput") {
      type = "user-input";
      title = "Input Required";
      const questions = (params?.questions as Array<{ question: string }>) || [];
      body = questions[0]?.question || "Input required";
    }

    return {
      type,
      title,
      body,
      threadId: threadId || "",
      actionUrl: threadId ? `/thread/${threadId}` : "/app",
    };
  }

  private async sendPushNotifications(msg: Record<string, unknown>, method: string, threadId: string | null): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    const vapidPublic = this.env.VAPID_PUBLIC_KEY?.trim();
    const vapidPrivate = this.env.VAPID_PRIVATE_KEY?.trim();
    const vapidSubject = this.env.VAPID_SUBJECT?.trim();
    if (!vapidPublic || !vapidPrivate || !vapidSubject) return;

    const vapid: VapidKeys = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject };

    try {
      const { results } = await this.env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
      )
        .bind(this.userId)
        .all<{ endpoint: string; p256dh: string; auth: string }>();

      if (!results.length) return;

      const payload = this.buildPushPayload(msg, method, threadId);

      for (const row of results) {
        try {
          const result = await sendPush(row, payload, vapid);
          if (result.expired) {
            await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
              .bind(row.endpoint)
              .run();
            console.log(`[orbit] push: removed expired subscription`);
          }
        } catch (err) {
          console.warn("[orbit] push: failed to send", err);
        }
      }
    } catch (err) {
      console.warn("[orbit] push: failed to query subscriptions", err);
    }
  }

  private async savePushSubscription(msg: Record<string, unknown>): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    if (typeof msg.endpoint !== "string" || typeof msg.p256dh !== "string" || typeof msg.auth !== "string") return;
    const endpoint = msg.endpoint;
    const p256dh = msg.p256dh;
    const auth = msg.auth;
    if (!endpoint || !p256dh || !auth) return;

    try {
      await this.env.DB.prepare(
        "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth"
      )
        .bind(this.userId, endpoint, p256dh, auth, Math.floor(Date.now() / 1000))
        .run();
      console.log(`[orbit] push: subscription saved for user ${this.userId}`);
    } catch (err) {
      console.warn("[orbit] push: failed to save subscription", err);
    }
  }

  private async removePushSubscription(msg: Record<string, unknown>): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    const endpoint = msg.endpoint as string;
    if (!endpoint) return;

    try {
      await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
        .bind(endpoint, this.userId)
        .run();
      console.log(`[orbit] push: subscription removed for user ${this.userId}`);
    } catch (err) {
      console.warn("[orbit] push: failed to remove subscription", err);
    }
  }

  private async sendTestPush(_socket: WebSocket): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    const vapidPublic = this.env.VAPID_PUBLIC_KEY?.trim();
    const vapidPrivate = this.env.VAPID_PRIVATE_KEY?.trim();
    const vapidSubject = this.env.VAPID_SUBJECT?.trim();
    if (!vapidPublic || !vapidPrivate || !vapidSubject) return;

    const vapid: VapidKeys = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject };

    try {
      const { results } = await this.env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
      )
        .bind(this.userId)
        .all<{ endpoint: string; p256dh: string; auth: string }>();

      if (!results.length) return;

      const payload: PushPayload = {
        type: "test",
        title: "Test Notification",
        body: "Push notifications are working!",
        threadId: "",
        actionUrl: "/app",
      };

      for (const row of results) {
        try {
          const result = await sendPush(row, payload, vapid);
          console.log(`[orbit] push-test: status=${result.status} ok=${result.ok}`);
          if (result.expired) {
            await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
              .bind(row.endpoint)
              .run();
          }
        } catch (err) {
          console.warn("[orbit] push-test: failed to send", err);
        }
      }
    } catch (err) {
      console.warn("[orbit] push-test: failed", err);
    }
  }

}
