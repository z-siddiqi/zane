import type { Message, MessageKind, MessageMetadata, MessageRole, TurnStatus } from "./types";

export interface ThreadTurnSnapshot {
  id?: string;
  status?: string;
  items?: Array<Record<string, unknown>>;
}

export interface TranscriptMessage extends Message {
  turnId: string | null;
}

export interface ThreadTranscript {
  threadId: string;
  messages: TranscriptMessage[];
  activeTurnId: string | null;
  turnStatus: TurnStatus | null;
}

export function createThreadTranscript(threadId: string): ThreadTranscript {
  return {
    threadId,
    messages: [],
    activeTurnId: null,
    turnStatus: null,
  };
}

export function hydrateTranscript(
  current: ThreadTranscript,
  turns: ThreadTurnSnapshot[],
): ThreadTranscript {
  const snapshotMessages = messagesFromTurns(current.threadId, turns);
  const activeTurn = [...turns].reverse().find((turn) => normalizeStatus(turn.status) === "InProgress");
  const activeTurnId = activeTurn?.id ?? null;
  const currentById = new Map(current.messages.map((message) => [message.id, message]));
  const messages = snapshotMessages.map((message) => {
    const existing = currentById.get(message.id);
    if (!existing) return message;
    return { ...existing, ...message, text: mergeText(message.text, existing.text) };
  });
  const snapshotIds = new Set(messages.map((message) => message.id));

  if (activeTurnId) {
    for (const message of current.messages) {
      if (snapshotIds.has(message.id)) continue;
      const isPendingRequest = message.approval?.status === "pending" ||
        message.userInputRequest?.status === "pending";
      if (message.turnId !== activeTurnId && !isPendingRequest) continue;
      messages.push(message);
    }
  }

  return {
    ...current,
    messages: markApprovedPlans(messages),
    activeTurnId,
    turnStatus: activeTurn
      ? "InProgress"
      : normalizeStatus(turns.at(-1)?.status) ?? current.turnStatus,
  };
}

export function startTurn(
  current: ThreadTranscript,
  turnId: string,
  status?: string,
): ThreadTranscript {
  return {
    ...current,
    activeTurnId: turnId,
    turnStatus: normalizeStatus(status) ?? "InProgress",
  };
}

export function completeTurn(
  current: ThreadTranscript,
  turnId: string | null,
  status?: string,
): ThreadTranscript {
  if (turnId && current.activeTurnId && turnId !== current.activeTurnId) return current;
  return {
    ...current,
    activeTurnId: null,
    turnStatus: normalizeStatus(status) ?? "Completed",
    messages: markApprovedPlans(current.messages),
  };
}

export function startItem(
  current: ThreadTranscript,
  turnId: string | null,
  item: Record<string, unknown>,
): ThreadTranscript {
  const message = messageFromItem(current.threadId, turnId, item);
  return message ? upsertMessage(current, message) : current;
}

export function completeItem(
  current: ThreadTranscript,
  turnId: string | null,
  item: Record<string, unknown>,
): ThreadTranscript {
  const message = messageFromItem(current.threadId, turnId, item);
  if (!message) return current;
  const existing = current.messages.find((candidate) => candidate.id === message.id);
  return upsertMessage(current, existing
    ? { ...existing, ...message, text: mergeText(message.text, existing.text) }
    : message);
}

export function appendItemDelta(
  current: ThreadTranscript,
  input: {
    itemId: string;
    turnId: string | null;
    delta: string;
    role: MessageRole;
    kind?: MessageKind;
  },
): ThreadTranscript {
  if (!input.delta) return current;
  const index = current.messages.findIndex((message) => message.id === input.itemId);
  if (index < 0) {
    return {
      ...current,
      messages: [...current.messages, {
        id: input.itemId,
        threadId: current.threadId,
        turnId: input.turnId,
        role: input.role,
        kind: input.kind,
        text: input.delta,
      }],
    };
  }

  const messages = [...current.messages];
  messages[index] = {
    ...messages[index],
    turnId: input.turnId ?? messages[index].turnId,
    kind: messages[index].kind ?? input.kind,
    text: `${messages[index].text}${input.delta}`,
  };
  return { ...current, messages };
}

export function restorePartialItem(
  current: ThreadTranscript,
  input: {
    itemId: string;
    turnId: string;
    text: string;
    role: MessageRole;
    kind?: MessageKind;
  },
): ThreadTranscript {
  const index = current.messages.findIndex((message) => message.id === input.itemId);
  if (index < 0) {
    return {
      ...current,
      messages: [...current.messages, {
        id: input.itemId,
        threadId: current.threadId,
        turnId: input.turnId,
        role: input.role,
        kind: input.kind,
        text: input.text,
      }],
    };
  }
  const messages = [...current.messages];
  messages[index] = {
    ...messages[index],
    turnId: input.turnId,
    kind: messages[index].kind ?? input.kind,
    text: mergeText(input.text, messages[index].text),
  };
  return { ...current, messages };
}

export function removeTranscriptMessage(
  current: ThreadTranscript,
  messageId: string,
): ThreadTranscript {
  return {
    ...current,
    messages: current.messages.filter((message) => message.id !== messageId),
  };
}

export function upsertTranscriptMessage(
  current: ThreadTranscript,
  message: Message,
  turnId: string | null = current.activeTurnId,
): ThreadTranscript {
  return upsertMessage(current, { ...message, turnId });
}

function messagesFromTurns(threadId: string, turns: ThreadTurnSnapshot[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const [turnIndex, turn] of turns.entries()) {
    for (const [itemIndex, item] of (turn.items ?? []).entries()) {
      const fallbackId = `${turn.id ?? turnIndex}:${itemIndex}:${String(item.type ?? "item")}`;
      const message = messageFromItem(threadId, turn.id ?? null, item, fallbackId);
      if (message) messages.push(message);
    }
  }
  return messages;
}

function messageFromItem(
  threadId: string,
  turnId: string | null,
  item: Record<string, unknown>,
  fallbackId?: string,
): TranscriptMessage | null {
  const id = typeof item.id === "string" && item.id ? item.id : fallbackId;
  if (!id) return null;

  switch (item.type) {
    case "userMessage":
      return message(id, threadId, turnId, "user", textFromUserContent(item.content));
    case "agentMessage": {
      const text = stripPlanTags(stringValue(item.text)).trim();
      return text ? message(id, threadId, turnId, "assistant", text) : null;
    }
    case "reasoning": {
      const text = reasoningText(item);
      return text ? message(id, threadId, turnId, "assistant", text, "reasoning") : null;
    }
    case "commandExecution": {
      const command = stringValue(item.command);
      const output = stringValue(item.aggregatedOutput);
      const metadata: MessageMetadata | undefined = typeof item.exitCode === "number"
        ? { exitCode: item.exitCode }
        : undefined;
      return {
        ...message(id, threadId, turnId, "tool", command ? `$ ${command}\n${output}` : output, "command"),
        metadata,
      };
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const text = changes.map((change) => {
        if (!isRecord(change)) return "";
        return `${stringValue(change.path)}\n${stringValue(change.diff)}`;
      }).filter(Boolean).join("\n\n");
      return message(id, threadId, turnId, "tool", text, "file");
    }
    case "mcpToolCall":
      return message(id, threadId, turnId, "tool", `Tool: ${stringValue(item.tool)}\n${jsonValue(item.error ?? item.result)}`, "mcp");
    case "dynamicToolCall":
      return message(id, threadId, turnId, "tool", `Tool: ${stringValue(item.tool)}\n${jsonValue(item.contentItems)}`, "mcp");
    case "webSearch":
      return message(id, threadId, turnId, "tool", `Search: ${stringValue(item.query)}`, "web");
    case "imageView":
      return message(id, threadId, turnId, "tool", `Image: ${stringValue(item.path)}`, "image");
    case "enteredReviewMode":
      return message(id, threadId, turnId, "tool", stringValue(item.review) ? `Review started: ${stringValue(item.review)}` : "Review started.", "review");
    case "exitedReviewMode":
      return message(id, threadId, turnId, "tool", stringValue(item.review) || "Review complete.", "review");
    case "plan": {
      const text = stripPlanTags(stringValue(item.text)).trim();
      return text ? { ...message(id, threadId, turnId, "tool", text, "plan"), planStatus: "pending" } : null;
    }
    case "collabAgentToolCall": {
      const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.map(String) : [];
      const lines = [`${stringValue(item.tool) || "agent"}: ${receivers.join(", ") || "—"}`];
      if (stringValue(item.prompt)) lines.push(stringValue(item.prompt));
      lines.push(`Status: ${stringValue(item.status) || "completed"}`);
      return message(id, threadId, turnId, "tool", lines.join("\n"), "collab");
    }
    case "contextCompaction":
      return message(id, threadId, turnId, "tool", "Context compacted", "compaction");
    default:
      return null;
  }
}

function message(
  id: string,
  threadId: string,
  turnId: string | null,
  role: MessageRole,
  text: string,
  kind?: MessageKind,
): TranscriptMessage {
  return { id, threadId, turnId, role, text, kind };
}

function upsertMessage(current: ThreadTranscript, message: TranscriptMessage): ThreadTranscript {
  const index = current.messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return { ...current, messages: [...current.messages, message] };
  const messages = [...current.messages];
  messages[index] = { ...messages[index], ...message };
  return { ...current, messages };
}

function mergeText(snapshot: string, current: string): string {
  if (!snapshot) return current;
  if (!current || snapshot === current) return snapshot;
  if (current.startsWith(snapshot)) return current;
  if (snapshot.startsWith(current) || snapshot.endsWith(current)) return snapshot;

  const maxOverlap = Math.min(snapshot.length, current.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (snapshot.endsWith(current.slice(0, length))) {
      return `${snapshot}${current.slice(length)}`;
    }
  }
  return `${snapshot}${current}`;
}

function textFromUserContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((part) => isRecord(part) && part.type === "text" ? stringValue(part.text) : "").join("");
}

function reasoningText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content.map(String).join("") : "";
  const summary = Array.isArray(item.summary) ? item.summary.map(String).join("") : "";
  return (content || summary).trim();
}

function stripPlanTags(text: string): string {
  return text.replace(/<\/?proposed_plan>/g, "");
}

function markApprovedPlans(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.map((message, index) => {
    if (message.kind !== "plan") return message;
    const hasFollowUp = messages.slice(index + 1).some(
      (candidate) => candidate.role === "user" || (candidate.role === "assistant" && candidate.kind !== "reasoning"),
    );
    return hasFollowUp ? { ...message, planStatus: "approved" } : message;
  });
}

function normalizeStatus(value: string | undefined): TurnStatus | null {
  switch (value?.toLowerCase()) {
    case "inprogress": return "InProgress";
    case "completed": return "Completed";
    case "interrupted": return "Interrupted";
    case "failed": return "Failed";
    default: return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonValue(value: unknown): string {
  if (value == null || value === "") return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
