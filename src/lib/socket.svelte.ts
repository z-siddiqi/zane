import type { ConnectionStatus, RpcMessage } from "./types";
import { DEFAULT_WS_URL } from "./config.svelte";

const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 10_000;
const RECONNECT_DELAY = 2_000;

export interface SendResult {
  success: boolean;
  error?: string;
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
  #intentionalDisconnect = false;
  #subscribedThreads = new Set<string>();

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

    const trimmed = url.trim() || DEFAULT_WS_URL;
    this.#url = trimmed;
    this.#token = token;
    this.status = "connecting";
    this.error = null;

    try {
      const wsUrl = new URL(trimmed);
      if (token) {
        wsUrl.searchParams.set("token", token);
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
      setTimeout(() => {
        if (!this.#intentionalDisconnect) {
          this.#connect(this.#url, this.#token);
        }
      }, RECONNECT_DELAY);
    };

    this.#socket.onerror = () => {
      if (this.status === "connecting") {
        this.error = "Failed to connect";
      }
    };

    this.#socket.onmessage = (event) => {
      if (event.data === "pong" || event.data === '{"type":"pong"}') {
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

  onProtocol(handler: (msg: Record<string, unknown>) => void) {
    this.#protocolHandlers.add(handler);
    return () => this.#protocolHandlers.delete(handler);
  }

  requestAnchors(): SendResult {
    return this.#sendRaw({ type: "orbit.list-anchors" });
  }

  reconnect() {
    if (this.status === "connected") return;
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

  #cleanup() {
    this.#stopHeartbeat();
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
