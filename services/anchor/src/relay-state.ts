import type { JsonObject } from "./types";
import { asRecord, extractThreadId } from "./utils";

export interface RelayItemSnapshot {
  itemId: string;
  kind?: "reasoning" | "command" | "file" | "mcp" | "plan";
  role: "user" | "assistant" | "tool";
  text: string;
}

export interface RelayThreadSnapshot {
  method: "zane/thread/replay";
  params: {
    threadId: string;
    turnId: string;
    items: RelayItemSnapshot[];
  };
}

const snapshots = new Map<string, RelayThreadSnapshot>();

export function recordRelayMessage(message: JsonObject): void {
  const method = typeof message.method === "string" ? message.method : null;
  const params = asRecord(message.params);
  const threadId = extractThreadId(message);
  if (!method || !params || !threadId) return;

  if (method === "turn/started") {
    const turn = asRecord(params.turn);
    if (typeof turn?.id !== "string") return;
    snapshots.set(threadId, {
      method: "zane/thread/replay",
      params: { threadId, turnId: turn.id, items: [] },
    });
    return;
  }
  if (method === "turn/completed") {
    snapshots.delete(threadId);
    return;
  }

  const snapshot = snapshots.get(threadId);
  if (!snapshot) return;
  if (method === "item/started") {
    // Durable thread/resume owns persisted items, including the user message.
    // This relay only fills app-server's gap for unfinished streamed output.
    return;
  }

  const delta = deltaForMethod(method, params);
  if (!delta) return;
  const itemId = stringValue(params.itemId) || stringValue(params.item_id);
  if (!itemId) return;
  const existing = snapshot.params.items.find((item) => item.itemId === itemId);
  if (existing) {
    existing.text += delta.text;
  } else {
    snapshot.params.items.push({ itemId, role: delta.role, kind: delta.kind, text: delta.text });
  }
}

export function relaySnapshot(threadId: string): RelayThreadSnapshot | null {
  const snapshot = snapshots.get(threadId);
  return snapshot ? structuredClone(snapshot) : null;
}

export function clearRelaySnapshots(): void {
  snapshots.clear();
}

function deltaForMethod(
  method: string,
  params: JsonObject,
): Omit<RelayItemSnapshot, "itemId"> | null {
  if (method === "item/agentMessage/delta") {
    return { role: "assistant", text: stringValue(params.delta) };
  }
  if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") {
    return { role: "assistant", kind: "reasoning", text: stringValue(params.delta) };
  }
  if (method === "item/commandExecution/outputDelta") {
    return { role: "tool", kind: "command", text: stringValue(params.delta) };
  }
  if (method === "item/fileChange/outputDelta") {
    return { role: "tool", kind: "file", text: stringValue(params.delta) };
  }
  if (method === "item/mcpToolCall/progress") {
    return { role: "tool", kind: "mcp", text: `${stringValue(params.message)}\n` };
  }
  if (method === "item/plan/delta") {
    return { role: "tool", kind: "plan", text: stringValue(params.delta) };
  }
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
