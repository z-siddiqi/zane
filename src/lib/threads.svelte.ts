import type { ThreadInfo, RpcMessage } from "./types";
import { socket } from "./socket.svelte";

class ThreadsStore {
  list = $state<ThreadInfo[]>([]);
  currentId = $state<string | null>(null);
  loading = $state(false);

  #pendingRequests = new Map<number, string>();

  constructor() {
    socket.onMessage((msg) => this.#handleMessage(msg));
  }

  get current(): ThreadInfo | undefined {
    return this.list.find((t) => t.id === this.currentId);
  }

  fetch() {
    const id = Date.now();
    this.loading = true;
    this.#pendingRequests.set(id, "list");
    socket.send({
      method: "thread/list",
      id,
      params: { cursor: null, limit: 50 },
    });
  }

  select(threadId: string | null) {
    this.currentId = threadId;
  }

  open(threadId: string, cwd: string) {
    const id = Date.now();
    this.loading = true;
    this.currentId = threadId;
    this.#pendingRequests.set(id, "resume");
    socket.send({
      method: "thread/resume",
      id,
      params: { threadId, cwd },
    });
  }

  start(cwd: string) {
    const id = Date.now();
    this.#pendingRequests.set(id, "start");
    socket.send({
      method: "thread/start",
      id,
      params: { cwd },
    });
  }

  archive(threadId: string) {
    const id = Date.now();
    this.#pendingRequests.set(id, "archive");
    socket.send({
      method: "thread/archive",
      id,
      params: { threadId },
    });
    this.list = this.list.filter((t) => t.id !== threadId);
    if (this.currentId === threadId) {
      this.currentId = null;
    }
  }

  #handleMessage(msg: RpcMessage) {
    if (msg.method === "thread/started") {
      const params = msg.params as { thread: ThreadInfo };
      if (params?.thread) {
        this.list = [params.thread, ...this.list];
        this.currentId = params.thread.id;
      }
      return;
    }

    if (msg.id && this.#pendingRequests.has(msg.id as number)) {
      const type = this.#pendingRequests.get(msg.id as number);
      this.#pendingRequests.delete(msg.id as number);

      if (type === "list" && msg.result) {
        const result = msg.result as { data: ThreadInfo[] };
        this.list = result.data || [];
        this.loading = false;
      }

      if (type === "resume") {
        this.loading = false;
      }
    }
  }
}

export const threads = new ThreadsStore();
