export function parseJsonMessage(payload: string): Record<string, unknown> | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function extractThreadId(message: Record<string, unknown>): string | null {
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

export function extractTurnId(message: Record<string, unknown>): string | null {
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const turnFromParams = asRecord(params?.turn);
  const turnFromResult = asRecord(result?.turn);

  const candidates = [params?.turnId, params?.turn_id, turnFromParams?.id, turnFromResult?.id];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }

  return null;
}

export function extractMethod(message: Record<string, unknown>): string | null {
  const method = message.method;
  if (typeof method === "string" && method.trim()) return method;
  const type = message.type;
  if (typeof type === "string" && type.trim()) return type;
  return null;
}
