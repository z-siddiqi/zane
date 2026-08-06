import { DurableObject } from "cloudflare:workers";

import { sendPush, type PushPayload, type VapidKeys } from "../push";
import type { Env, Role } from "../types";
import { asRecord, extractMethod, extractThreadId, parseJsonMessage } from "../utils/protocol";
import {
  parseRoutedRpcId,
  routeAnchorRpcId,
  routeClientRpcId,
  type RpcId,
} from "./rpc-route";

const PENDING_REQUEST_PREFIX = "pending-request:";

interface AnchorMeta {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
}

interface SocketAttachment {
  role: Role;
  userId: string;
  connectionId: string;
  clientId?: string;
  threads: string[];
  anchor?: AnchorMeta;
}

interface StoredSocketAttachment extends Partial<SocketAttachment> {
  anchorMeta?: unknown;
}

interface PendingRequest {
  anchorId: string;
  anchorHostname: string;
  frame: string;
  publicId: string;
  threadId: string | null;
}

export class OrbitRelay extends DurableObject<Env> {
  #clients = new Map<WebSocket, Set<string>>();
  #anchors = new Map<WebSocket, Set<string>>();
  #clientConnections = new Map<string, WebSocket>();
  #anchorConnections = new Map<string, WebSocket>();
  #clientIds = new Map<string, WebSocket>();
  #anchorMeta = new Map<WebSocket, AnchorMeta>();
  #threadClients = new Map<string, Set<WebSocket>>();
  #threadAnchors = new Map<string, Set<WebSocket>>();
  #userId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#rebuildFromAttachments();
  }

  fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }
    const role = request.headers.get("x-orbit-role");
    const userId = request.headers.get("x-orbit-user-id");
    if (role !== "client" && role !== "anchor") {
      return new Response("Missing role", { status: 400 });
    }
    if (!userId) return new Response("Missing user identity", { status: 400 });

    const clientId = role === "client" ? new URL(request.url).searchParams.get("clientId") : null;
    const connectionId = crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const attachment: SocketAttachment = {
      role,
      userId,
      connectionId,
      clientId: clientId ?? undefined,
      threads: [],
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [role]);
    this.#register(server, attachment);
    this.#send(server, JSON.stringify({ type: "orbit.hello", role, ts: new Date().toISOString() }));
    if (role === "client") this.ctx.waitUntil(this.#replayPending(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const attachment = this.#attachment(socket);
    if (!attachment) {
      socket.close(1008, "Missing socket attachment");
      return;
    }
    this.#userId = attachment.userId;
    if (this.#handlePing(socket, data)) return;

    const text = this.#text(data);
    const message = text ? parseJsonMessage(text) : null;
    if (!message) return;
    if (await this.#handleControl(socket, attachment, message)) return;

    if (attachment.role === "client") {
      await this.#routeClient(attachment, message);
    } else {
      await this.#routeAnchor(socket, data, message);
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    const attachment = this.#attachment(socket);
    if (attachment) this.#remove(socket, attachment.role);
    console.log(JSON.stringify({ message: "orbit socket closed", role: attachment?.role, code, reason, wasClean }));
  }

  webSocketError(socket: WebSocket, error: unknown): void {
    const attachment = this.#attachment(socket);
    if (attachment) this.#remove(socket, attachment.role);
    console.error(JSON.stringify({ message: "orbit socket error", role: attachment?.role, error: String(error) }));
  }

  async #handleControl(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: Record<string, unknown>,
  ): Promise<boolean> {
    if (message.type === "orbit.subscribe" && typeof message.threadId === "string") {
      this.#subscribe(socket, attachment.role, message.threadId);
      this.#send(socket, JSON.stringify({ type: "orbit.subscribed", threadId: message.threadId }));
      if (attachment.role === "client") {
        await this.#replayPending(socket, message.threadId);
        const control = JSON.stringify({ type: "orbit.client-subscribed", threadId: message.threadId });
        const anchors = this.#threadAnchors.get(message.threadId);
        if (anchors?.size) this.#sendMany(anchors, control);
        else this.#sendMany(this.#anchors.keys(), control);
      }
      return true;
    }
    if (message.type === "orbit.unsubscribe" && typeof message.threadId === "string") {
      this.#unsubscribe(socket, attachment.role, message.threadId);
      return true;
    }
    if (message.type === "orbit.list-anchors" && attachment.role === "client") {
      this.#send(socket, JSON.stringify({ type: "orbit.anchors", anchors: [...this.#anchorMeta.values()] }));
      return true;
    }
    if (message.type === "orbit.push-subscribe" && attachment.role === "client") {
      await this.#savePushSubscription(message);
      return true;
    }
    if (message.type === "orbit.push-unsubscribe" && attachment.role === "client") {
      await this.#removePushSubscription(message);
      return true;
    }
    if (message.type === "orbit.push-test" && attachment.role === "client") {
      await this.#sendTestPush();
      return true;
    }
    if (attachment.role !== "anchor") return false;
    if (message.type === "anchor.app-server-reset") {
      const anchorId = this.#anchorMeta.get(socket)?.id;
      if (anchorId) await this.#clearPending((request) => request.anchorId === anchorId);
      return true;
    }
    if (message.type !== "anchor.hello") return false;

    const meta: AnchorMeta = {
      id: typeof message.id === "string" && message.id ? message.id : crypto.randomUUID(),
      hostname: typeof message.hostname === "string" ? message.hostname : "unknown",
      platform: typeof message.platform === "string" ? message.platform : "unknown",
      connectedAt: typeof message.ts === "string" ? message.ts : new Date().toISOString(),
    };
    await this.#clearPending((request) =>
      request.anchorHostname === meta.hostname && request.anchorId !== meta.id);
    const existing = this.#anchorConnections.get(meta.id);
    if (existing && existing !== socket) {
      this.#remove(existing, "anchor");
      existing.close(1000, "Replaced by reconnected Anchor");
    }
    this.#anchorMeta.set(socket, meta);
    this.#anchorConnections.set(meta.id, socket);
    this.#writeAttachment(socket, { anchor: meta });
    this.#broadcastClients(JSON.stringify({ type: "orbit.anchor-connected", anchor: meta }));
    return true;
  }

  async #routeClient(
    attachment: SocketAttachment,
    message: Record<string, unknown>,
  ): Promise<void> {
    const routed = parseRoutedRpcId(message.id);
    if (!message.method && routed?.source === "anchor") {
      const pending = await this.#takePending(message.id as string);
      if (!pending) return;
      const anchor = this.#anchorConnections.get(routed.ownerId);
      const delivered = anchor
        ? this.#send(anchor, JSON.stringify({ ...message, id: routed.originalId }))
        : false;
      if (!delivered) {
        await this.#savePending(pending);
        const client = this.#clientConnections.get(attachment.connectionId);
        if (client) this.#send(client, pending.frame);
        return;
      }
      this.#broadcastResolved(pending);
      return;
    }

    const anchor = this.#selectAnchor(extractThreadId(message));
    if (!anchor) {
      if (isRpcId(message.id)) {
        const client = this.#clientConnections.get(attachment.connectionId);
        if (client) this.#send(client, JSON.stringify({
          id: message.id,
          error: { code: -32001, message: "No Anchor is connected" },
        }));
      }
      return;
    }
    const outgoing = isRpcId(message.id)
      ? { ...message, id: routeClientRpcId(attachment.connectionId, message.id) }
      : message;
    this.#send(anchor, JSON.stringify(outgoing));
  }

  async #routeAnchor(
    socket: WebSocket,
    data: string | ArrayBuffer,
    message: Record<string, unknown>,
  ): Promise<void> {
    const meta = this.#anchorMeta.get(socket);
    if (!meta) return;
    const routed = parseRoutedRpcId(message.id);
    if (!message.method && routed?.source === "client") {
      const client = this.#clientConnections.get(routed.ownerId);
      if (client) this.#send(client, JSON.stringify({ ...message, id: routed.originalId }));
      return;
    }

    const method = extractMethod(message);
    const threadId = extractThreadId(message);
    if (method && isRpcId(message.id)) {
      const publicId = routeAnchorRpcId(meta.id, message.id);
      const frame = JSON.stringify({ ...message, id: publicId });
      await this.#savePending({
        anchorId: meta.id,
        anchorHostname: meta.hostname,
        frame,
        publicId,
        threadId,
      });
      this.#broadcastClients(frame);
      if (this.#pushWorthy(method)) {
        this.ctx.waitUntil(this.#sendPushNotifications({ ...message, id: publicId }, method, threadId));
      }
      return;
    }

    if (method === "serverRequest/resolved") {
      const params = asRecord(message.params);
      if (params && isRpcId(params.requestId)) {
        const publicId = routeAnchorRpcId(meta.id, params.requestId);
        await this.ctx.storage.delete(this.#pendingKey(publicId));
        this.#broadcastClients(JSON.stringify({ ...message, params: { ...params, requestId: publicId } }));
        return;
      }
    }
    if (method === "turn/completed" && threadId) {
      await this.#clearPending((request) => request.threadId === threadId);
    }
    if (method && this.#pushWorthy(method)) {
      this.#broadcastClients(data);
      this.ctx.waitUntil(this.#sendPushNotifications(message, method, threadId));
      return;
    }
    if (threadId) {
      this.#sendMany(this.#threadClients.get(threadId), data);
      return;
    }
    this.#broadcastClients(data);
  }

  #register(socket: WebSocket, attachment: SocketAttachment): void {
    this.#userId ??= attachment.userId;
    const sockets = attachment.role === "client" ? this.#clients : this.#anchors;
    sockets.set(socket, new Set(attachment.threads));
    if (attachment.role === "client") {
      this.#clientConnections.set(attachment.connectionId, socket);
      if (attachment.clientId) {
        const existing = this.#clientIds.get(attachment.clientId);
        if (existing && existing !== socket) {
          this.#remove(existing, "client");
          existing.close(1000, "Replaced by newer connection");
        }
        this.#clientIds.set(attachment.clientId, socket);
      }
    } else if (attachment.anchor) {
      this.#anchorMeta.set(socket, attachment.anchor);
      this.#anchorConnections.set(attachment.anchor.id, socket);
    }
    for (const threadId of attachment.threads) {
      this.#threadIndex(attachment.role, threadId).add(socket);
    }
  }

  #rebuildFromAttachments(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.#attachment(socket);
      if (attachment) this.#register(socket, attachment);
    }
  }

  #attachment(socket: WebSocket): SocketAttachment | null {
    const value = socket.deserializeAttachment() as StoredSocketAttachment | null;
    if (!value || (value.role !== "client" && value.role !== "anchor")) return null;
    if (typeof value.userId !== "string" || !value.userId) return null;
    const migrated = !value.connectionId || (!value.anchor && isAnchorMeta(value.anchorMeta));
    const attachment: SocketAttachment = {
      role: value.role,
      userId: value.userId,
      connectionId: typeof value.connectionId === "string" && value.connectionId
        ? value.connectionId
        : crypto.randomUUID(),
      clientId: typeof value.clientId === "string" ? value.clientId : undefined,
      threads: Array.isArray(value.threads)
        ? value.threads.filter((threadId): threadId is string => typeof threadId === "string" && !!threadId)
        : [],
      anchor: isAnchorMeta(value.anchor)
        ? value.anchor
        : isAnchorMeta(value.anchorMeta) ? value.anchorMeta : undefined,
    };
    if (migrated) socket.serializeAttachment(attachment);
    return attachment;
  }

  #writeAttachment(socket: WebSocket, update: Partial<SocketAttachment>): void {
    const current = this.#attachment(socket);
    if (!current) return;
    socket.serializeAttachment({ ...current, ...update });
  }

  #subscribe(socket: WebSocket, role: Role, threadId: string): void {
    const threads = (role === "client" ? this.#clients : this.#anchors).get(socket);
    if (!threads) return;
    threads.add(threadId);
    this.#threadIndex(role, threadId).add(socket);
    this.#writeAttachment(socket, { threads: [...threads] });
  }

  #unsubscribe(socket: WebSocket, role: Role, threadId: string): void {
    const threads = (role === "client" ? this.#clients : this.#anchors).get(socket);
    threads?.delete(threadId);
    const indexed = (role === "client" ? this.#threadClients : this.#threadAnchors).get(threadId);
    indexed?.delete(socket);
    if (indexed?.size === 0) (role === "client" ? this.#threadClients : this.#threadAnchors).delete(threadId);
    if (threads) this.#writeAttachment(socket, { threads: [...threads] });
  }

  #threadIndex(role: Role, threadId: string): Set<WebSocket> {
    const index = role === "client" ? this.#threadClients : this.#threadAnchors;
    let sockets = index.get(threadId);
    if (!sockets) {
      sockets = new Set();
      index.set(threadId, sockets);
    }
    return sockets;
  }

  #remove(socket: WebSocket, role: Role): void {
    const sockets = role === "client" ? this.#clients : this.#anchors;
    for (const threadId of sockets.get(socket) ?? []) {
      const index = role === "client" ? this.#threadClients : this.#threadAnchors;
      index.get(threadId)?.delete(socket);
      if (index.get(threadId)?.size === 0) index.delete(threadId);
    }
    sockets.delete(socket);
    const attachment = this.#attachment(socket);
    if (role === "client") {
      if (attachment && this.#clientConnections.get(attachment.connectionId) === socket) {
        this.#clientConnections.delete(attachment.connectionId);
      }
      if (attachment?.clientId && this.#clientIds.get(attachment.clientId) === socket) {
        this.#clientIds.delete(attachment.clientId);
      }
      return;
    }
    const meta = this.#anchorMeta.get(socket);
    this.#anchorMeta.delete(socket);
    if (meta && this.#anchorConnections.get(meta.id) === socket) {
      this.#anchorConnections.delete(meta.id);
      this.#broadcastClients(JSON.stringify({ type: "orbit.anchor-disconnected", anchorId: meta.id }));
    }
  }

  #selectAnchor(threadId: string | null): WebSocket | null {
    if (threadId) {
      const owner = [...(this.#threadAnchors.get(threadId) ?? [])].at(-1);
      if (owner) return owner;
    }
    return [...this.#anchorMeta.keys()].at(-1) ?? null;
  }

  #send(socket: WebSocket, data: string | ArrayBuffer | ArrayBufferView): boolean {
    try {
      socket.send(data);
      return true;
    } catch (error) {
      console.error(JSON.stringify({ message: "orbit relay failed", error: String(error) }));
      return false;
    }
  }

  #sendMany(sockets: Iterable<WebSocket> | undefined, data: string | ArrayBuffer | ArrayBufferView): void {
    for (const socket of sockets ?? []) this.#send(socket, data);
  }

  #broadcastClients(data: string | ArrayBuffer | ArrayBufferView): void {
    this.#sendMany(this.#clients.keys(), data);
  }

  #pendingKey(publicId: string): string {
    return `${PENDING_REQUEST_PREFIX}${publicId}`;
  }

  async #savePending(request: PendingRequest): Promise<void> {
    await this.ctx.storage.put(this.#pendingKey(request.publicId), request);
  }

  async #takePending(publicId: string): Promise<PendingRequest | null> {
    const key = this.#pendingKey(publicId);
    return this.ctx.storage.transaction(async (transaction) => {
      const request = await transaction.get<PendingRequest>(key);
      if (!request) return null;
      await transaction.delete(key);
      return request;
    });
  }

  async #clearPending(predicate: (request: PendingRequest) => boolean): Promise<void> {
    const cleared = await this.ctx.storage.transaction(async (transaction) => {
      const entries = await transaction.list<PendingRequest>({ prefix: PENDING_REQUEST_PREFIX });
      const requests = [...entries].filter(([, request]) => predicate(request));
      if (requests.length > 0) await transaction.delete(requests.map(([key]) => key));
      return requests.map(([, request]) => request);
    });
    for (const request of cleared) this.#broadcastResolved(request);
  }

  async #replayPending(socket: WebSocket, threadId?: string): Promise<void> {
    const entries = await this.ctx.storage.list<PendingRequest>({ prefix: PENDING_REQUEST_PREFIX });
    for (const request of entries.values()) {
      if (threadId && request.threadId !== threadId) continue;
      this.#send(socket, request.frame);
    }
  }

  #broadcastResolved(request: PendingRequest): void {
    this.#broadcastClients(JSON.stringify({
      method: "serverRequest/resolved",
      params: {
        requestId: request.publicId,
        ...(request.threadId ? { threadId: request.threadId } : {}),
      },
    }));
  }

  #text(data: unknown): string | null {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (data instanceof Uint8Array) return new TextDecoder().decode(data);
    return null;
  }

  #handlePing(socket: WebSocket, data: unknown): boolean {
    if (this.#text(data)?.trim() !== '{"type":"ping"}') return false;
    this.#send(socket, '{"type":"pong"}');
    return true;
  }

  #pushWorthy(method: string): boolean {
    return method.endsWith("/requestApproval") ||
      method === "item/tool/requestUserInput" ||
      method === "mcpServer/elicitation/request" ||
      method === "item/tool/call" ||
      method === "applyPatchApproval" ||
      method === "execCommandApproval" ||
      method === "account/chatgptAuthTokens/refresh" ||
      method === "attestation/generate";
  }

  #buildPushPayload(message: Record<string, unknown>, method: string, threadId: string | null): PushPayload {
    const params = asRecord(message.params);
    const reason = typeof params?.reason === "string" ? params.reason : "";
    let type = "approval";
    let title = "Approval Required";
    let body = reason || "An action requires your approval";

    if (method.includes("fileChange") || method === "applyPatchApproval") {
      title = "File Change Approval";
      body = reason || "A file change needs your approval";
    } else if (method.includes("commandExecution") || method === "execCommandApproval") {
      title = "Command Approval";
      body = reason || "A command needs your approval";
    } else if (method === "item/tool/requestUserInput") {
      type = "user-input";
      title = "Input Required";
      const questions = Array.isArray(params?.questions) ? params.questions : [];
      const question = asRecord(questions[0]);
      body = typeof question?.question === "string" ? question.question : "Input required";
    } else if (method === "mcpServer/elicitation/request") {
      type = "user-input";
      title = "MCP Input Required";
      body = reason || "An MCP server needs input";
    } else if (method === "account/chatgptAuthTokens/refresh" || method === "attestation/generate") {
      type = "account";
      title = "Account Attention Required";
      body = "Codex needs account attention";
    }
    return { type, title, body, threadId: threadId ?? "", actionUrl: threadId ? `/thread/${threadId}` : "/app" };
  }

  async #sendPushNotifications(message: Record<string, unknown>, method: string, threadId: string | null): Promise<void> {
    if (!this.env.DB || !this.#userId) return;
    const publicKey = this.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = this.env.VAPID_PRIVATE_KEY?.trim();
    const subject = this.env.VAPID_SUBJECT?.trim();
    if (!publicKey || !privateKey || !subject) return;
    const vapid: VapidKeys = { publicKey, privateKey, subject };
    const { results } = await this.env.DB.prepare(
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    ).bind(this.#userId).all<{ endpoint: string; p256dh: string; auth: string }>();
    const payload = this.#buildPushPayload(message, method, threadId);
    for (const subscription of results) {
      try {
        const result = await sendPush(subscription, payload, vapid);
        if (result.expired) {
          await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
            .bind(subscription.endpoint).run();
        }
      } catch (error) {
        console.error(JSON.stringify({ message: "push failed", error: String(error) }));
      }
    }
  }

  async #savePushSubscription(message: Record<string, unknown>): Promise<void> {
    if (!this.env.DB || !this.#userId) return;
    if (typeof message.endpoint !== "string" || typeof message.p256dh !== "string" || typeof message.auth !== "string") return;
    await this.env.DB.prepare(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
    ).bind(this.#userId, message.endpoint, message.p256dh, message.auth, Math.floor(Date.now() / 1_000)).run();
  }

  async #removePushSubscription(message: Record<string, unknown>): Promise<void> {
    if (!this.env.DB || !this.#userId || typeof message.endpoint !== "string") return;
    await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
      .bind(message.endpoint, this.#userId).run();
  }

  async #sendTestPush(): Promise<void> {
    await this.#sendPushNotifications({}, "test", null);
  }
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || typeof value === "number";
}

function isAnchorMeta(value: unknown): value is AnchorMeta {
  const meta = asRecord(value);
  return !!meta &&
    typeof meta.id === "string" &&
    typeof meta.hostname === "string" &&
    typeof meta.platform === "string" &&
    typeof meta.connectedAt === "string";
}
