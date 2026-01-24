import type { ConnectionStatus, RpcMessage } from "./types";
import { DEFAULT_WS_URL } from "./config.svelte";

class SocketStore {
  status = $state<ConnectionStatus>("disconnected");
  error = $state<string | null>(null);

  #socket: WebSocket | null = null;
  #url = "";
  #messageHandlers = new Set<(msg: RpcMessage) => void>();
  #connectHandlers = new Set<() => void>();

  get url() {
    return this.#url;
  }

  connect(url: string, token?: string | null) {
    if (this.#socket) {
      this.disconnect();
    }

    const trimmed = url.trim() || DEFAULT_WS_URL;
    this.#url = trimmed;
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
      this.error = "Invalid server URL";
      return;
    }

    this.#socket.onopen = () => {
      this.status = "connected";
      this.#notifyConnect();
    };

    this.#socket.onclose = () => {
      this.status = "disconnected";
      this.#socket = null;
    };

    this.#socket.onerror = () => {
      this.status = "error";
      this.error = "Connection failed";
    };

    this.#socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as RpcMessage;
        this.#notifyMessage(msg);
      } catch {
        console.error("Failed to parse message:", event.data);
      }
    };
  }

  disconnect() {
    if (this.#socket) {
      this.#socket.close();
      this.#socket = null;
    }
    this.status = "disconnected";
  }

  send(message: RpcMessage) {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (msg: RpcMessage) => void) {
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onConnect(handler: () => void) {
    this.#connectHandlers.add(handler);
    // If already connected, call immediately
    if (this.status === "connected") {
      handler();
    }
    return () => this.#connectHandlers.delete(handler);
  }

  #notifyMessage(msg: RpcMessage) {
    for (const handler of this.#messageHandlers) {
      handler(msg);
    }
  }

  #notifyConnect() {
    for (const handler of this.#connectHandlers) {
      handler();
    }
  }
}

export const socket = new SocketStore();
