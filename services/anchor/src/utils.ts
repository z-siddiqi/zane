import type { JsonObject } from "./types";

export function parseJsonRpcMessage(payload: string): JsonObject | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as JsonObject;
    if ("method" in parsed || "id" in parsed) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function asRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

export function extractThreadId(message: JsonObject): string | null {
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const threadFromParams = asRecord(params?.thread);
  const threadFromResult = asRecord(result?.thread);

  const candidates = [
    params?.threadId,
    params?.thread_id,
    params?.conversationId,
    params?.conversation_id,
    result?.threadId,
    result?.thread_id,
    result?.conversationId,
    result?.conversation_id,
    threadFromParams?.id,
    threadFromResult?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }

  return null;
}
