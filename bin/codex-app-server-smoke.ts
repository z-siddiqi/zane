const timeoutMs = Number(process.env.ZANE_SMOKE_TIMEOUT_MS ?? 10_000);
const requestId = Date.now();

const proc = Bun.spawn({
  cmd: ["codex", "app-server"],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

const timeout = setTimeout(() => {
  proc.kill();
  console.error(`codex app-server smoke check timed out after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);

const initPayload = {
  method: "initialize",
  id: requestId,
  params: {
    clientInfo: {
      name: "zane_doctor",
      title: "Zane Doctor",
      version: "dev",
    },
    capabilities: {
      experimentalApi: true,
    },
  },
};

writeLine(JSON.stringify(initPayload));

const response = await readJsonLine(proc.stdout, requestId);

if (response?.error) {
  clearTimeout(timeout);
  proc.kill();
  const message = errorMessage(response.error);
  console.error(`codex app-server initialize failed: ${message}`);
  process.exit(1);
}

writeLine(JSON.stringify({ method: "initialized" }));
clearTimeout(timeout);
proc.kill();
console.log("codex app-server initialized successfully");

function writeLine(payload: string): void {
  const stdin = proc.stdin;
  if (!stdin || typeof stdin === "number") return;

  if (typeof (stdin as { write?: unknown }).write === "function") {
    (stdin as { write: (data: string) => void }).write(`${payload}\n`);
    return;
  }

  if (typeof (stdin as WritableStream<Uint8Array>).getWriter === "function") {
    const writer = (stdin as WritableStream<Uint8Array>).getWriter();
    writer.write(new TextEncoder().encode(`${payload}\n`));
    writer.releaseLock();
  }
}

async function readJsonLine(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  id: number,
): Promise<Record<string, unknown> | null> {
  if (!stream || typeof stream === "number") return null;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) return null;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (!part.trim()) continue;

      try {
        const parsed = JSON.parse(part) as Record<string, unknown>;
        if (parsed.id === id) return parsed;
      } catch {
        // Ignore non-JSON tracing noise.
      }
    }
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "unknown error";
}
