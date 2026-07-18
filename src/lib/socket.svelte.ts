import type {
  AccountInfo,
  ConnectionStatus,
  FuzzyFileResult,
  GitInspectResult,
  GitWorktreeCreateParams,
  GitWorktreeCreateResult,
  GitWorktreeListResult,
  McpServerStatus,
  RateLimitsResponse,
  RpcMessage,
  Skill,
} from "./types";
const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 10_000;
const RECONNECT_DELAY = 2_000;
const CLIENT_ID_KEY = "__zane_client_id__";

function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const fallback = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const id = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : fallback;
    window.sessionStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export interface SendResult {
  success: boolean;
  error?: string;
}

export interface ListDirsResult {
  dirs: string[];
  parent: string;
  current: string;
}

export interface GitWorktreeRemoveResult {
  removed: boolean;
}

export interface GitWorktreePruneResult {
  prunedCount: number;
}

class SocketStore {
  status = $state<ConnectionStatus>("disconnected");
  error = $state<string | null>(null);

  #socket: WebSocket | null = null;
  #url = "";
  #token: string | null = null;
  #messageHandlers = new Set<(msg: RpcMessage) => void>();
  #connectHandlers = new Set<() => void>();
  #protocolHandlers = new Set<(msg: Record<string, unknown>) => void>();
  #heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  #heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #intentionalDisconnect = false;
  #subscribedThreads = new Set<string>();
  #rpcIdCounter = 0;
  #pendingRpc = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  get url() {
    return this.#url;
  }

  get isHealthy() {
    return this.status === "connected" && this.#socket?.readyState === WebSocket.OPEN;
  }

  connect(url: string, token?: string | null) {
    this.#intentionalDisconnect = false;
    this.#connect(url, token ?? null);
  }

  #connect(url: string, token: string | null) {
    if (this.#socket) {
      this.#cleanup();
    }
    this.#clearReconnectTimeout();

    const trimmed = url.trim();
    if (!trimmed) {
      this.status = "error";
      this.error = "No server URL configured. Set one in Settings.";
      return;
    }

    this.#url = trimmed;
    this.#token = token;
    this.status = "connecting";
    this.error = null;

    try {
      const wsUrl = new URL(trimmed);
      if (token) {
        wsUrl.searchParams.set("token", token);
      }
      const clientId = getClientId();
      if (clientId) {
        wsUrl.searchParams.set("clientId", clientId);
      }
      this.#socket = new WebSocket(wsUrl);
    } catch {
      this.status = "error";
      this.error = `Invalid URL: ${trimmed}`;
      return;
    }

    this.#socket.onopen = () => {
      this.status = "connected";
      this.error = null;
      this.#startHeartbeat();
      this.#resubscribeThreads();
      for (const handler of this.#connectHandlers) {
        handler();
      }
    };

    this.#socket.onclose = (event) => {
      this.#stopHeartbeat();
      this.#socket = null;

      if (this.#intentionalDisconnect) {
        this.status = "disconnected";
        return;
      }

      this.status = "reconnecting";
      this.error = event.reason || "Connection lost";
      this.#scheduleReconnect();
    };

    this.#socket.onerror = () => {
      if (this.status === "connecting") {
        this.error = "Failed to connect";
      }
    };

    this.#socket.onmessage = (event) => {
      if (event.data === '{"type":"pong"}') {
        this.#clearHeartbeatTimeout();
        return;
      }

      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;

        // Handle orbit protocol messages
        if (typeof msg.type === "string" && msg.type.startsWith("orbit.")) {
          if (
            msg.type === "orbit.anchors" ||
            msg.type === "orbit.anchor-connected" ||
            msg.type === "orbit.anchor-disconnected"
          ) {
            for (const handler of this.#protocolHandlers) {
              handler(msg);
            }
          }
          return;
        }

        // Resolve pending RPC responses (anchor.listDirs etc.)
        const rpcId = msg.id as number | string | undefined;
        if (rpcId != null && this.#pendingRpc.has(rpcId)) {
          const { resolve, reject } = this.#pendingRpc.get(rpcId)!;
          this.#pendingRpc.delete(rpcId);
          if (msg.error) {
            const errObj = msg.error as Record<string, unknown>;
            reject(new Error(typeof errObj.message === "string" ? errObj.message : "RPC error"));
          } else {
            resolve(msg.result);
          }
          return;
        }

        for (const handler of this.#messageHandlers) {
          handler(msg as RpcMessage);
        }
      } catch {
        console.error("Failed to parse message:", event.data);
      }
    };
  }

  disconnect() {
    this.#intentionalDisconnect = true;
    this.#subscribedThreads.clear();
    this.#cleanup();
    this.status = "disconnected";
    this.error = null;
  }

  send(message: RpcMessage): SendResult {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Not connected" };
    }

    try {
      this.#socket.send(JSON.stringify(message));
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Send failed" };
    }
  }

  onMessage(handler: (msg: RpcMessage) => void) {
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onConnect(handler: () => void) {
    this.#connectHandlers.add(handler);
    if (this.status === "connected") handler();
    return () => this.#connectHandlers.delete(handler);
  }

  subscribedThreadIds(): string[] {
    return Array.from(this.#subscribedThreads);
  }

  onProtocol(handler: (msg: Record<string, unknown>) => void) {
    this.#protocolHandlers.add(handler);
    return () => this.#protocolHandlers.delete(handler);
  }

  requestAnchors(): SendResult {
    return this.#sendRaw({ type: "orbit.list-anchors" });
  }

  listDirs(path?: string): Promise<ListDirsResult> {
    const id = `dir-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as ListDirsResult),
        reject,
      });
      const result = this.send({ id, method: "anchor.listDirs", params: { path: path ?? "" } });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  gitInspect(path: string): Promise<GitInspectResult> {
    const id = `git-inspect-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as GitInspectResult),
        reject,
      });
      const result = this.send({ id, method: "anchor.git.inspect", params: { path } });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  gitWorktreeList(repoRoot: string): Promise<GitWorktreeListResult> {
    const id = `git-worktree-list-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as GitWorktreeListResult),
        reject,
      });
      const result = this.send({ id, method: "anchor.git.worktree.list", params: { repoRoot } });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  gitWorktreeCreate(params: GitWorktreeCreateParams): Promise<GitWorktreeCreateResult> {
    const id = `git-worktree-create-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as GitWorktreeCreateResult),
        reject,
      });
      const result = this.send({
        id,
        method: "anchor.git.worktree.create",
        params: params as unknown as Record<string, unknown>,
      });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  gitWorktreeRemove(repoRoot: string, path: string, force = false): Promise<GitWorktreeRemoveResult> {
    const id = `git-worktree-remove-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as GitWorktreeRemoveResult),
        reject,
      });
      const result = this.send({
        id,
        method: "anchor.git.worktree.remove",
        params: { repoRoot, path, force },
      });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  gitWorktreePrune(repoRoot: string): Promise<GitWorktreePruneResult> {
    const id = `git-worktree-prune-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as GitWorktreePruneResult),
        reject,
      });
      const result = this.send({ id, method: "anchor.git.worktree.prune", params: { repoRoot } });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  accountRead(): Promise<AccountInfo> {
    const id = `account-read-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as AccountInfo),
        reject,
      });
      const result = this.send({ id, method: "account/read", params: {} });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  mcpServerStatusList(): Promise<McpServerStatus[]> {
    const id = `mcp-status-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => {
          const result = v as { data?: McpServerStatus[] } | McpServerStatus[];
          resolve(Array.isArray(result) ? result : result?.data ?? []);
        },
        reject,
      });
      const result = this.send({ id, method: "mcpServerStatus/list", params: {} });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  skillsList(): Promise<Skill[]> {
    const id = `skills-list-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => {
          const result = v as { data?: Skill[] } | Skill[];
          resolve(Array.isArray(result) ? result : result?.data ?? []);
        },
        reject,
      });
      const result = this.send({ id, method: "skills/list", params: {} });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  fuzzyFileSearch(query: string, limit = 10): Promise<FuzzyFileResult[]> {
    const id = `fuzzy-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => {
          const result = v as { data?: FuzzyFileResult[] } | FuzzyFileResult[];
          resolve(Array.isArray(result) ? result : result?.data ?? []);
        },
        reject,
      });
      const result = this.send({ id, method: "fuzzyFileSearch", params: { query, limit } });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  accountRateLimits(): Promise<RateLimitsResponse> {
    const id = `account-rate-limits-${++this.#rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      this.#pendingRpc.set(id, {
        resolve: (v) => resolve(v as RateLimitsResponse),
        reject,
      });
      const result = this.send({ id, method: "account/rateLimits/read", params: {} });
      if (!result.success) {
        this.#pendingRpc.delete(id);
        reject(new Error(result.error ?? "Not connected"));
      }
    });
  }

  reconnect() {
    if (this.status === "connected" || this.status === "connecting") return;
    this.#intentionalDisconnect = false;
    this.#clearReconnectTimeout();
    this.#connect(this.#url, this.#token);
  }

  subscribeThread(threadId: string): SendResult {
    this.#subscribedThreads.add(threadId);
    return this.#sendRaw({ type: "orbit.subscribe", threadId });
  }

  unsubscribeThread(threadId: string): SendResult {
    this.#subscribedThreads.delete(threadId);
    return this.#sendRaw({ type: "orbit.unsubscribe", threadId });
  }

  #sendRaw(message: Record<string, unknown>): SendResult {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Not connected" };
    }

    try {
      this.#socket.send(JSON.stringify(message));
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Send failed" };
    }
  }

  #resubscribeThreads() {
    for (const threadId of this.#subscribedThreads) {
      this.#sendRaw({ type: "orbit.subscribe", threadId });
    }
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.#heartbeatInterval = setInterval(() => {
      if (this.#socket?.readyState === WebSocket.OPEN) {
        try {
          this.#socket.send(JSON.stringify({ type: "ping" }));
          this.#heartbeatTimeout = setTimeout(() => {
            console.warn("Heartbeat timeout");
            this.#socket?.close();
          }, HEARTBEAT_TIMEOUT);
        } catch {
          this.#socket?.close();
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  #stopHeartbeat() {
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }
    this.#clearHeartbeatTimeout();
  }

  #clearHeartbeatTimeout() {
    if (this.#heartbeatTimeout) {
      clearTimeout(this.#heartbeatTimeout);
      this.#heartbeatTimeout = null;
    }
  }

  #scheduleReconnect() {
    if (this.#reconnectTimeout) return;
    this.#reconnectTimeout = setTimeout(() => {
      this.#reconnectTimeout = null;
      if (!this.#intentionalDisconnect) {
        this.#connect(this.#url, this.#token);
      }
    }, RECONNECT_DELAY);
  }

  #clearReconnectTimeout() {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }
  }

  #cleanup() {
    this.#clearReconnectTimeout();
    this.#stopHeartbeat();
    for (const [, { reject }] of this.#pendingRpc) {
      reject(new Error("Connection closed"));
    }
    this.#pendingRpc.clear();
    if (this.#socket) {
      this.#socket.onopen = null;
      this.#socket.onclose = null;
      this.#socket.onerror = null;
      this.#socket.onmessage = null;
      if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING) {
        this.#socket.close();
      }
      this.#socket = null;
    }
  }
}

export const socket = new SocketStore();
