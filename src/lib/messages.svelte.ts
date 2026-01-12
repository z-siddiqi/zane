import type { Message, RpcMessage } from "./types";
import { socket } from "./socket.svelte";
import { threads } from "./threads.svelte";

class MessagesStore {
  #byThread = $state<Map<string, Message[]>>(new Map());
  #streamingText = $state<Map<string, string>>(new Map());
  #seenUserMessages = new Set<string>();

  constructor() {
    socket.onMessage((msg) => this.#handleMessage(msg));
  }

  get current(): Message[] {
    const threadId = threads.currentId;
    if (!threadId) return [];
    return this.#byThread.get(threadId) ?? [];
  }

  clear(threadId: string) {
    this.#byThread.delete(threadId);
    this.#streamingText.delete(threadId);
  }

  #add(threadId: string, message: Message) {
    const existing = this.#byThread.get(threadId) ?? [];
    this.#byThread.set(threadId, [...existing, message]);
    this.#byThread = new Map(this.#byThread);
  }

  #updateStreaming(threadId: string, itemId: string, delta: string) {
    const key = `${threadId}:${itemId}`;
    const current = this.#streamingText.get(key) ?? "";
    this.#streamingText.set(key, current + delta);
    this.#streamingText = new Map(this.#streamingText);

    // Update or add the message
    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.id === itemId);

    if (idx >= 0) {
      messages[idx] = { ...messages[idx], text: this.#streamingText.get(key)! };
      this.#byThread.set(threadId, [...messages]);
      this.#byThread = new Map(this.#byThread);
    } else {
      this.#add(threadId, {
        id: itemId,
        role: "assistant",
        text: this.#streamingText.get(key)!,
        threadId,
      });
    }
  }

  #handleMessage(msg: RpcMessage) {
    if (msg.result && !msg.method) {
      const result = msg.result as { thread?: { id: string; turns?: Array<{ items?: unknown[] }> } };
      if (result.thread?.turns) {
        this.#loadThread(result.thread.id, result.thread.turns);
      }
      return;
    }

    const method = msg.method;
    const params = msg.params as Record<string, unknown> | undefined;
    if (!params) return;

    const threadId = this.#extractThreadId(params);
    if (!threadId) return;

    // User message
    if (
      method === "codex/event/user_message" ||
      method === "item/userMessage"
    ) {
      const text =
        (params.msg as { message?: string })?.message ||
        (params.text as string) ||
        "";
      const dedupeKey = `${threadId}:${text.slice(0, 50)}`;

      if (!this.#seenUserMessages.has(dedupeKey)) {
        this.#seenUserMessages.add(dedupeKey);
        setTimeout(() => this.#seenUserMessages.delete(dedupeKey), 15000);

        this.#add(threadId, {
          id: `user-${Date.now()}`,
          role: "user",
          text,
          threadId,
        });
      }
      return;
    }

    // Agent message delta (streaming)
    if (
      method === "codex/event/agent_message_delta" ||
      method === "item/agentMessage/delta"
    ) {
      const delta =
        (params.msg as { delta?: string })?.delta ||
        (params.delta as string) ||
        "";
      const itemId = (params.itemId as string) || `agent-${threadId}`;
      this.#updateStreaming(threadId, itemId, delta);
      return;
    }

    // Reasoning delta
    if (
      method === "codex/event/agent_reasoning_delta" ||
      method === "item/reasoning/textDelta"
    ) {
      const delta =
        (params.msg as { delta?: string })?.delta ||
        (params.delta as string) ||
        "";
      const itemId = (params.itemId as string) || `reasoning-${threadId}`;

      const messages = this.#byThread.get(threadId) ?? [];
      const existing = messages.find((m) => m.id === itemId);

      if (existing) {
        this.#updateStreaming(threadId, itemId, delta);
      } else {
        const key = `${threadId}:${itemId}`;
        this.#streamingText.set(key, delta);
        this.#add(threadId, {
          id: itemId,
          role: "assistant",
          kind: "reasoning",
          text: delta,
          threadId,
        });
      }
      return;
    }

    // Item completed (tool outputs, file changes, commands)
    if (method === "item/completed") {
      const item = params.item as Record<string, unknown>;
      if (!item) return;

      const itemId = item.id as string;
      const type = item.type as string;

      let role: Message["role"] = "tool";
      let kind: Message["kind"];
      let text = "";

      switch (type) {
        case "CommandExecution":
          kind = "command";
          text = `$ ${item.command}\n${item.output || ""}`;
          break;
        case "FileChange":
          kind = "file";
          const changes = item.changes as Array<{ path: string; diff?: string }>;
          text = changes?.map((c) => `${c.path}\n${c.diff || ""}`).join("\n\n") || "";
          break;
        case "MCPToolCall":
          kind = "mcp";
          text = `Tool: ${item.toolName}\n${JSON.stringify(item.result, null, 2)}`;
          break;
        case "WebSearch":
          kind = "web";
          text = `Search: ${item.query}`;
          break;
        default:
          return;
      }

      this.#add(threadId, { id: itemId, role, kind, text, threadId });
    }
  }

  #extractThreadId(params: Record<string, unknown>): string | null {
    return (
      (params.threadId as string) ||
      (params.thread_id as string) ||
      (params.conversationId as string) ||
      ((params.msg as Record<string, unknown>)?.threadId as string) ||
      null
    );
  }

  #loadThread(threadId: string, turns: Array<{ items?: unknown[] }>) {
    const messages: Message[] = [];

    for (const turn of turns) {
      if (!turn.items) continue;

      for (const item of turn.items as Array<Record<string, unknown>>) {
        const id = (item.id as string) || `item-${Date.now()}-${Math.random()}`;
        const type = item.type as string;

        switch (type) {
          case "userMessage": {
            const content = item.content as Array<{ text?: string }>;
            const text = content?.[0]?.text || (item.text as string) || "";
            messages.push({ id, role: "user", text, threadId });
            break;
          }

          case "agentMessage":
            messages.push({
              id,
              role: "assistant",
              text: (item.text as string) || "",
              threadId,
            });
            break;

          case "reasoning": {
            const summary = item.summary as Array<{ text?: string }>;
            const text = summary?.[0]?.text || "";
            if (text) {
              messages.push({ id, role: "assistant", kind: "reasoning", text, threadId });
            }
            break;
          }

          case "commandExecution":
            messages.push({
              id,
              role: "tool",
              kind: "command",
              text: `$ ${item.command}\n${item.output || ""}`,
              threadId,
            });
            break;

          case "fileChange": {
            const changes = item.changes as Array<{ path: string; diff?: string }>;
            messages.push({
              id,
              role: "tool",
              kind: "file",
              text: changes?.map((c) => `${c.path}\n${c.diff || ""}`).join("\n\n") || "",
              threadId,
            });
            break;
          }

          case "mcpToolCall":
            messages.push({
              id,
              role: "tool",
              kind: "mcp",
              text: `Tool: ${item.toolName}\n${JSON.stringify(item.result, null, 2)}`,
              threadId,
            });
            break;
        }
      }
    }

    this.#byThread.set(threadId, messages);
    this.#byThread = new Map(this.#byThread);
  }
}

export const messages = new MessagesStore();
