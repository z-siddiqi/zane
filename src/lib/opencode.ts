import { spawn, type ChildProcess } from "node:child_process";

import type { Session, Message, SpawnOptions } from "../types";

export class OpenCodeInstance {
  private process: ChildProcess | null = null;
  private closed = false;
  public readonly baseUrl: string;
  public readonly port: number;
  public readonly repoPath: string;

  private constructor(port: number, repoPath: string) {
    this.port = port;
    this.repoPath = repoPath;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  static async spawn(
    repoPath: string,
    options: SpawnOptions = {}
  ): Promise<OpenCodeInstance> {
    const port = options.port ?? 4100 + Math.floor(Math.random() * 900);
    const startupTimeoutMs = options.startupTimeoutMs ?? 30000;

    const instance = new OpenCodeInstance(port, repoPath);

    console.log(`[opencode] Spawning server on port ${port} for ${repoPath}`);

    instance.process = spawn("opencode", ["serve", "--port", String(port)], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    instance.process.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[opencode:${port}] ${text}`);
    });

    instance.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[opencode:${port}] ${text}`);
    });

    instance.process.on("exit", (code, signal) => {
      if (!instance.closed) {
        console.log(`[opencode:${port}] Process exited (code=${code}, signal=${signal})`);
      }
    });

    const startTime = Date.now();
    let lastError: Error | null = null;

    while (Date.now() - startTime < startupTimeoutMs) {
      try {
        const response = await fetch(`${instance.baseUrl}/global/health`);
        if (response.ok) {
          const health = (await response.json()) as { healthy: boolean; version: string };
          console.log(`[opencode:${port}] Server ready (version=${health.version})`);
          return instance;
        }
      } catch (error: any) {
        lastError = error;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    instance.close();
    throw new Error(`Server failed to start: ${lastError?.message ?? "timeout"}`);
  }

  async createSession(title?: string): Promise<Session> {
    const body: Record<string, string> = {};
    if (title) body.title = title;

    const response = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`Failed to create session: ${response.status}`);
    return (await response.json()) as Session;
  }

  async sendPromptAsync(
    sessionId: string,
    prompt: string,
    options?: { model?: { providerID: string; modelID: string } }
  ): Promise<void> {
    const body: Record<string, any> = { parts: [{ type: "text", text: prompt }] };
    if (options?.model) {
      body.model = options.model;
    }

    const response = await fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok && response.status !== 204) throw new Error(`Failed to send prompt: ${response.status}`);
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/message`);
    if (!response.ok) throw new Error(`Failed to get messages: ${response.status}`);
    return (await response.json()) as Message[];
  }

  async getSession(sessionId: string): Promise<Session> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}`);
    if (!response.ok) throw new Error(`Failed to get session: ${response.status}`);
    return (await response.json()) as Session;
  }

  async *streamEvents(signal: AbortSignal): AsyncGenerator<{ type: string; properties: Record<string, any> }> {
    const response = await fetch(`${this.baseUrl}/event`, { signal });
    if (!response.ok || !response.body) throw new Error(`Failed to connect to SSE: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr) {
              try {
                yield JSON.parse(jsonStr);
              } catch {}
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getNextControlRequest(): Promise<{ id: string; type: string; body: any } | null> {
    const response = await fetch(`${this.baseUrl}/tui/control/next`);
    if (response.status === 204) return null;
    if (!response.ok) return null;
    return (await response.json()) as { id: string; type: string; body: any };
  }

  async respondToControl(requestId: string, responseBody: any): Promise<void> {
    await fetch(`${this.baseUrl}/tui/control/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestId, body: responseBody }),
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.process) {
      console.log(`[opencode:${this.port}] Shutting down`);
      this.process.kill("SIGTERM");
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
    }
  }
}

export async function waitForCompletion(
  instance: OpenCodeInstance,
  sessionId: string,
  timeoutMs: number,
  onProgress?: (progress: number) => void
): Promise<void> {
  const startTime = Date.now();
  const abortController = new AbortController();
  let lastSummary = "";

  const controlLoop = (async () => {
    while (!abortController.signal.aborted) {
      try {
        const req = await instance.getNextControlRequest();
        if (req) {
          console.log(`[opencode:${instance.port}] Auto-approve: ${req.body?.message || req.type}`);
          await instance.respondToControl(req.id, { response: true });
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    console.log(`[opencode:${instance.port}] Listening for events...`);
    
    for await (const event of instance.streamEvents(abortController.signal)) {
      const elapsed = Date.now() - startTime;
      if (onProgress) onProgress(Math.min(elapsed / timeoutMs, 0.95));

      const props = event.properties;

      if (event.type === "session.updated" && props.info?.id === sessionId) {
        if (props.info.summary) {
          const s = props.info.summary;
          const summary = `${s.files} files (+${s.additions}/-${s.deletions})`;
          if (summary !== lastSummary) {
            console.log(`[opencode:${instance.port}] Progress: ${summary}`);
            lastSummary = summary;
          }
        }
      }

      if (event.type === "message.part.updated" && props.part?.sessionID === sessionId) {
        const part = props.part;
        if (part.type === "tool" && part.state?.status === "completed") {
          console.log(`[opencode:${instance.port}] Tool: ${part.tool} - ${part.state.title || "done"}`);
        }
      }

      if (event.type === "session.idle" && props.sessionID === sessionId) {
        console.log(`[opencode:${instance.port}] Session idle - completed`);
        return;
      }

      if (event.type === "session.status" && props.sessionID === sessionId) {
        if (props.status?.type === "idle") {
          console.log(`[opencode:${instance.port}] Session status idle - completed`);
          return;
        }
      }

      if (event.type === "session.error" && props.sessionID === sessionId) {
        throw new Error(`Session error: ${props.error?.data?.message || "unknown"}`);
      }
    }

    throw new Error("Event stream ended unexpectedly");
  } catch (e: any) {
    if (e.name === "AbortError" || abortController.signal.aborted) {
      throw new Error(`Timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    abortController.abort();
    await controlLoop.catch(() => {});
  }
}
