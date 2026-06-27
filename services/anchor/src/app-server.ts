import {
  appServer,
  appServerStarting,
  appServerInitialized,
  appServerInitializeId,
  warnedNoAppServer,
  setAppServer,
  setAppServerStarting,
  setAppServerInitialized,
  setAppServerInitializeId,
  setWarnedNoAppServer,
  clients,
  orbitSocket,
  pendingApprovals,
  pendingUserMessages,
  approvalRpcIds,
  APPROVAL_METHODS,
} from "./config";
import { parseJsonRpcMessage, extractThreadId } from "./utils";
import { subscribeToThread } from "./orbit";

const MAX_QUEUED_PAYLOADS = 500;
const queuedPayloads: string[] = [];

export function sendToAppServer(payload: string): void {
  if (!appServer || appServer.stdin === undefined || typeof appServer.stdin === "number") {
    if (!warnedNoAppServer) {
      console.warn("[anchor] app-server not running; cannot forward payload");
      setWarnedNoAppServer(true);
    }
    return;
  }

  if (!appServerInitialized) {
    queuePayload(payload);
    return;
  }

  writeToAppServer(payload);
}

function queuePayload(payload: string): void {
  if (queuedPayloads.length >= MAX_QUEUED_PAYLOADS) {
    queuedPayloads.shift();
    console.warn("[anchor] app-server payload queue full; dropped oldest payload");
  }
  queuedPayloads.push(payload);
}

function writeToAppServer(payload: string): void {
  if (!appServer || appServer.stdin === undefined || typeof appServer.stdin === "number") {
    return;
  }

  const stdin = appServer.stdin;
  if (isWritableStream(stdin)) {
    const writer = stdin.getWriter();
    writer.write(new TextEncoder().encode(payload));
    writer.releaseLock();
    return;
  }
  if (isFileSink(stdin)) {
    stdin.write(payload);
  }
}

function flushQueuedPayloads(): void {
  while (appServerInitialized && queuedPayloads.length > 0) {
    const payload = queuedPayloads.shift();
    if (payload) writeToAppServer(payload);
  }
}

export function ensureAppServer(): void {
  if (appServer || appServerStarting) return;
  setAppServerStarting(true);

  try {
    const proc = Bun.spawn({
      cmd: ["codex", "app-server"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    setAppServer(proc);
    setWarnedNoAppServer(false);
    setAppServerInitialized(false);
    setAppServerInitializeId(null);
    initializeAppServer();

    proc.exited.then((code) => {
      console.warn(`[anchor] app-server exited with code ${code}`);
      setAppServer(null);
      setAppServerInitialized(false);
      setAppServerInitializeId(null);
      queuedPayloads.length = 0;
      pendingApprovals.clear();
      approvalRpcIds.clear();
    });

    streamLines(proc.stdout, (line) => {
      const parsed = parseJsonRpcMessage(line);
      if (parsed) {
        if (handleInitializeResponse(parsed)) {
          return;
        }

        const threadId = extractThreadId(parsed);
        if (threadId) {
          subscribeToThread(threadId);
        }

        const method = parsed.method as string | undefined;
        if (method === "item/started" && threadId && isUserMessageItem(parsed)) {
          pendingUserMessages.set(threadId, line);
        }

        if (method && APPROVAL_METHODS.has(method) && threadId) {
          pendingApprovals.set(threadId, line);
          const rpcId = parsed.id as number | string | undefined;
          if (rpcId != null) approvalRpcIds.set(rpcId, threadId);
        } else if (method === "turn/completed" && threadId) {
          pendingApprovals.delete(threadId);
          pendingUserMessages.delete(threadId);
        }
      }

      for (const client of clients) {
        try {
          client.send(line);
        } catch (err) {
          console.warn("[anchor] failed to send to client", err);
        }
      }

      if (orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
        try {
          orbitSocket.send(line);
        } catch (err) {
          console.warn("[anchor] failed to send to orbit", err);
        }
      }
    });

    streamLines(proc.stderr, (line) => {
      console.error(`[app-server] ${line}`);
    });
  } catch (err) {
    console.error("[anchor] failed to start codex app-server", err);
    setAppServer(null);
  } finally {
    setAppServerStarting(false);
  }
}

function initializeAppServer(): void {
  if (appServerInitialized || appServerInitializeId !== null) return;
  const id = Date.now();
  setAppServerInitializeId(id);
  const initPayload = JSON.stringify({
    method: "initialize",
    id,
    params: {
      clientInfo: {
        name: "zane-anchor",
        title: "Zane Anchor",
        version: "dev",
      },
      capabilities: {
        experimentalApi: true,
      },
    },
  });
  console.log("[anchor] app-server initialize");
  writeToAppServer(initPayload + "\n");
}

function handleInitializeResponse(message: Record<string, unknown>): boolean {
  if (appServerInitializeId === null || message.id !== appServerInitializeId) {
    return false;
  }

  if (message.error) {
    const error = message.error as { message?: unknown };
    const errorMessage = typeof error.message === "string" ? error.message : "unknown error";
    console.error(`[anchor] app-server initialize failed: ${errorMessage}`);
    setAppServerInitializeId(null);
    return true;
  }

  writeToAppServer(JSON.stringify({ method: "initialized" }) + "\n");
  setAppServerInitialized(true);
  setAppServerInitializeId(null);
  console.log("[anchor] app-server initialized");
  flushQueuedPayloads();
  return true;
}

function isUserMessageItem(message: Record<string, unknown>): boolean {
  const params = message.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return false;
  const item = (params as Record<string, unknown>).item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return (item as Record<string, unknown>).type === "userMessage";
}

function isWritableStream(input: unknown): input is WritableStream<Uint8Array> {
  return typeof (input as WritableStream<Uint8Array>)?.getWriter === "function";
}

function isFileSink(input: unknown): input is { write: (data: string | Uint8Array) => void } {
  return typeof (input as { write?: unknown })?.write === "function";
}

async function streamLines(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream || typeof stream === "number") return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.length === 0) continue;
      onLine(part);
    }
  }

  const tail = buffer.trim();
  if (tail.length > 0) onLine(tail);
}
