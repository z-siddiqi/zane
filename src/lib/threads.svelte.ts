import type { ApprovalPolicy, CollaborationMode, CollaborationModeMask, ModeKind, ReasoningEffort, SandboxMode, ThreadInfo, RpcMessage, ThreadSettings, TokenUsage, ThreadStatus as ThreadStatusType } from "./types";
import { codexTextInput } from "./codex-input";
import { socket } from "./socket.svelte";
import { messages } from "./messages.svelte";
import { models } from "./models.svelte";
import { navigate } from "../router";

const STORE_KEY = "__zane_threads_store__";
const SETTINGS_STORAGE_KEY = "zane_thread_settings";

const DEFAULT_SETTINGS: ThreadSettings = {
  model: "",
  reasoningEffort: "medium",
  sandbox: "workspace-write",
  mode: "code",
};

class ThreadsStore {
  list = $state<ThreadInfo[]>([]);
  currentId = $state<string | null>(null);
  loading = $state(false);
  #threadStatusById = $state<Map<string, ThreadStatusType>>(new Map());
  #tokenUsageById = $state<Map<string, TokenUsage>>(new Map());

  #settings = $state<Map<string, ThreadSettings>>(new Map());
  #nextId = 1;
  #pendingRequests = new Map<number, string>();
  #pendingThreadRequests = new Map<number, { type: string; threadId: string }>();
  #pendingStartInput: string | null = null;
  #pendingStartModel: string | null = null;
  #pendingCollaborationMode: CollaborationMode | null = null;
  #pendingStartCallback: ((threadId: string) => void) | null = null;
  #pendingStartErrorCallback: ((error: Error) => void) | null = null;
  #suppressNextNavigation = false;
  #collaborationPresets: CollaborationModeMask[] = [];

  get currentThreadStatus(): ThreadStatusType | null {
    if (!this.currentId) return null;
    return this.#threadStatusById.get(this.currentId) ?? null;
  }

  get currentTokenUsage(): TokenUsage | null {
    if (!this.currentId) return null;
    return this.#tokenUsageById.get(this.currentId) ?? null;
  }

  constructor() {
    this.#loadSettings();
    socket.onConnect(() => this.#reattachResumedThreads());
  }

  getSettings(threadId: string | null): ThreadSettings {
    if (!threadId) return { ...DEFAULT_SETTINGS };
    const settings = this.#settings.get(threadId);
    return settings ? { ...settings } : { ...DEFAULT_SETTINGS };
  }

  updateSettings(threadId: string, update: Partial<ThreadSettings>) {
    const current = this.#settings.get(threadId) ?? DEFAULT_SETTINGS;
    const next: ThreadSettings = { ...current, ...update };
    if (
      current.model === next.model &&
      current.reasoningEffort === next.reasoningEffort &&
      current.sandbox === next.sandbox &&
      current.mode === next.mode
    ) {
      return;
    }
    this.#settings = new Map(this.#settings).set(threadId, next);
    this.#saveSettings();
  }

  fetch() {
    const id = this.#nextId++;
    this.loading = true;
    this.#pendingRequests.set(id, "list");
    socket.send({
      method: "thread/list",
      id,
      params: { cursor: null, limit: 25 },
    });
  }

  open(threadId: string) {
    const previousId = this.currentId;
    this.loading = true;
    if (previousId && previousId !== threadId) {
      socket.unsubscribeThread(previousId);
    }
    this.currentId = threadId;
    socket.subscribeThread(threadId);
    this.#resumeThread(threadId, true);
  }

  start(
    cwd: string,
    input?: string,
    options?: {
      approvalPolicy?: ApprovalPolicy | string;
      sandbox?: SandboxMode | string;
      suppressNavigation?: boolean;
      onThreadStarted?: (threadId: string) => void;
      onThreadStartFailed?: (error: Error) => void;
      collaborationMode?: CollaborationMode;
      modelProvider?: string;
      baseInstructions?: string;
      developerInstructions?: string;
      personality?: string;
    }
  ) {
    this.#startThread(cwd, input, options);
  }

  fetchCollaborationPresets() {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "collaborationPresets");
    socket.send({
      method: "collaborationMode/list",
      id,
      params: {},
    });
  }

  resolveCollaborationMode(
    mode: ModeKind,
    model: string,
    reasoningEffort?: ReasoningEffort,
  ): CollaborationMode {
    const preset = this.#collaborationPresets.find((p) => p.mode === mode);
    return {
      mode,
      settings: {
        model,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(preset?.developer_instructions
          ? { developer_instructions: preset.developer_instructions }
          : {}),
      },
    };
  }

  setName(threadId: string, name: string) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "setName");
    socket.send({
      method: "thread/name/set",
      id,
      params: { threadId, name },
    });
    // Optimistic update
    this.list = this.list.map((t) => (t.id === threadId ? { ...t, name } : t));
  }

  compact(threadId: string) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "compact");
    socket.send({
      method: "thread/compact/start",
      id,
      params: { threadId },
    });
  }

  archive(threadId: string) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "archive");
    socket.unsubscribeThread(threadId);
    socket.send({
      method: "thread/archive",
      id,
      params: { threadId },
    });
    this.list = this.list.filter((t) => t.id !== threadId);
    if (this.currentId === threadId) {
      this.currentId = null;
    }
    if (this.#settings.has(threadId)) {
      const next = new Map(this.#settings);
      next.delete(threadId);
      this.#settings = next;
      this.#saveSettings();
    }
  }

  fork(threadId: string) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "fork");
    socket.send({
      method: "thread/fork",
      id,
      params: { threadId },
    });
  }

  rollback(threadId: string, numTurns = 1) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "rollback");
    socket.send({
      method: "thread/rollback",
      id,
      params: { threadId, numTurns },
    });
  }

  handleMessage(msg: RpcMessage) {
    if (msg.method === "thread/started") {
      const params = msg.params as { thread: ThreadInfo };
      if (params?.thread) {
        socket.subscribeThread(params.thread.id);
        this.#handleNewThread(params.thread);
      }
      return;
    }

    if (msg.method === "thread/name/updated") {
      const params = msg.params as { threadId: string; name: string };
      if (params?.threadId) {
        this.list = this.list.map((t) =>
          t.id === params.threadId ? { ...t, name: params.name } : t,
        );
      }
      return;
    }

    if (msg.method === "thread/status/changed") {
      const params = msg.params as { threadId: string; status: ThreadStatusType };
      if (params?.threadId) {
        this.#threadStatusById = new Map(this.#threadStatusById).set(params.threadId, params.status);
      }
      return;
    }

    if (msg.method === "thread/tokenUsage/updated") {
      const params = msg.params as Record<string, unknown> | undefined;
      const threadId = (params?.threadId as string) || null;
      if (threadId) {
        this.#tokenUsageById = new Map(this.#tokenUsageById).set(threadId, {
          inputTokens: params?.inputTokens as number | undefined,
          outputTokens: params?.outputTokens as number | undefined,
          totalTokens: params?.totalTokens as number | undefined,
        });
      }
      return;
    }

    if (msg.method === "thread/closed") {
      const params = msg.params as { threadId: string };
      if (params?.threadId) {
        this.#threadStatusById = new Map(this.#threadStatusById).set(params.threadId, "NotLoaded");
      }
      return;
    }

    if (msg.method === "thread/archived") {
      const params = msg.params as { threadId: string };
      if (params?.threadId) {
        this.list = this.list.filter((t) => t.id !== params.threadId);
        if (this.currentId === params.threadId) {
          this.currentId = null;
        }
      }
      return;
    }

    if (msg.id != null && this.#pendingRequests.has(msg.id as number)) {
      const type = this.#pendingRequests.get(msg.id as number);
      this.#pendingRequests.delete(msg.id as number);

      if (type === "list" && msg.result) {
        const result = msg.result as { data: ThreadInfo[] };
        this.list = result.data || [];
        this.loading = false;
      }

      if (type === "fork" && msg.result) {
        const result = msg.result as { thread?: ThreadInfo };
        if (result.thread) {
          this.#handleNewThread(result.thread);
        }
      }

      if (type === "resume") {
        this.loading = false;
      }

      if (type === "read" && msg.result) {
        const result = msg.result as { thread?: { id: string; turns?: Array<{ items?: unknown[] }> } };
        if (result.thread?.id && result.thread.turns) {
          messages.hydrateThread(result.thread.id, result.thread.turns, { authoritative: true });
        }
      }

      if (type === "collaborationPresets" && msg.result) {
        const result = msg.result as { data: CollaborationModeMask[] };
        this.#collaborationPresets = result.data || [];
      }

      if (type === "rollback" && msg.result) {
        const result = msg.result as { thread?: { id: string; turns?: Array<{ items?: unknown[] }> } };
        if (result.thread?.id) {
          messages.clearThread(result.thread.id);
        }
      }

      if (type === "start" && msg.error) {
        this.#handleStartFailure(msg.error);
      }

      if (type === "start" && msg.result) {
        const result = msg.result as {
          thread?: ThreadInfo;
          model?: string;
          reasoningEffort?: ReasoningEffort;
          sandbox?: { type?: string } | string;
        };
        const thread = result.thread;
        if (thread?.id) {
          const sandbox = this.#normalizeSandbox(result.sandbox);
          this.updateSettings(thread.id, {
            model: result.model ?? this.#pendingStartModel ?? "",
            reasoningEffort: result.reasoningEffort ?? DEFAULT_SETTINGS.reasoningEffort,
            ...(sandbox ? { sandbox } : {}),
          });

          // Handle thread creation if thread/started notification hasn't arrived
          if (!this.list.some((t) => t.id === thread.id)) {
            socket.subscribeThread(thread.id);
            this.#handleNewThread(thread);
          }
        }
      }

      if (type === "start") {
        this.#pendingStartModel = null;
      }
    }

    if (msg.id != null && this.#pendingThreadRequests.has(msg.id as number)) {
      const request = this.#pendingThreadRequests.get(msg.id as number)!;
      this.#pendingThreadRequests.delete(msg.id as number);
      if (request.type === "resume") {
        this.loading = false;
        if (!msg.error && this.currentId === request.threadId) {
          this.#readThreadHistory(request.threadId);
        }
      }
      if (request.type === "read" && msg.result) {
        const result = msg.result as { thread?: { id: string; turns?: Array<{ items?: unknown[] }> } };
        if (result.thread?.id && result.thread.turns) {
          messages.hydrateThread(result.thread.id, result.thread.turns, { authoritative: true });
        }
      }
    }
  }

  #resumeThread(threadId: string, readHistory: boolean) {
    const id = this.#nextId++;
    this.#pendingThreadRequests.set(id, { type: "resume", threadId });
    const result = socket.send({
      method: "thread/resume",
      id,
      params: { threadId },
    });
    if (!result.success) {
      this.#pendingThreadRequests.delete(id);
      if (readHistory) this.#readThreadHistory(threadId);
    }
  }

  #readThreadHistory(threadId: string) {
    const id = this.#nextId++;
    this.#pendingThreadRequests.set(id, { type: "read", threadId });
    const result = socket.send({
      method: "thread/read",
      id,
      params: { threadId, includeTurns: true },
    });
    if (!result.success) {
      this.#pendingThreadRequests.delete(id);
    }
  }

  #reattachResumedThreads() {
    const threadIds = new Set(socket.subscribedThreadIds());
    if (this.currentId) {
      threadIds.add(this.currentId);
    }

    for (const threadId of threadIds) {
      socket.subscribeThread(threadId);
      this.#resumeThread(threadId, threadId === this.currentId);
    }
  }

  #handleNewThread(thread: ThreadInfo) {
    if (this.list.some((t) => t.id === thread.id)) return;
    this.list = [thread, ...this.list];
    this.currentId = thread.id;
    if (this.#pendingStartCallback) {
      this.#pendingStartCallback(thread.id);
      this.#pendingStartCallback = null;
    }
    this.#pendingStartErrorCallback = null;
    if (!this.#suppressNextNavigation) {
      navigate("/thread/:id", { params: { id: thread.id } });
    }
    if (this.#pendingStartInput) {
      socket.send({
        method: "turn/start",
        id: this.#nextId++,
        params: {
          threadId: thread.id,
          input: [codexTextInput(this.#pendingStartInput)],
          ...(this.#pendingCollaborationMode
            ? { collaborationMode: this.#pendingCollaborationMode }
            : {}),
        },
      });
      this.#pendingStartInput = null;
      this.#pendingCollaborationMode = null;
    }
    this.#suppressNextNavigation = false;
  }

  #normalizeSandbox(input: unknown): SandboxMode | null {
    if (!input) return null;
    if (typeof input === "string") {
      if (input === "read-only" || input === "workspace-write" || input === "danger-full-access") {
        return input;
      }
      const lower = input.toLowerCase();
      if (lower.includes("readonly")) return "read-only";
      if (lower.includes("workspace")) return "workspace-write";
      if (lower.includes("danger") || lower.includes("full")) return "danger-full-access";
      return null;
    }
    if (typeof input === "object") {
      const type = (input as { type?: string }).type;
      if (!type) return null;
      if (type === "readOnly") return "read-only";
      if (type === "workspaceWrite") return "workspace-write";
      if (type === "dangerFullAccess") return "danger-full-access";
      return this.#normalizeSandbox(type);
    }
    return null;
  }

  #startThread(
    cwd: string,
    input: string | undefined,
    options?: {
      approvalPolicy?: ApprovalPolicy | string;
      sandbox?: SandboxMode | string;
      suppressNavigation?: boolean;
      onThreadStarted?: (threadId: string) => void;
      onThreadStartFailed?: (error: Error) => void;
      collaborationMode?: CollaborationMode;
      modelProvider?: string;
      baseInstructions?: string;
      developerInstructions?: string;
      personality?: string;
    }
  ) {
    const requestedModel = this.#resolveStartModel(options?.collaborationMode);
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "start");
    this.#pendingStartInput = input?.trim() ? input.trim() : null;
    this.#pendingStartModel = requestedModel;
    this.#pendingCollaborationMode = options?.collaborationMode ?? null;
    this.#pendingStartCallback = options?.onThreadStarted ?? null;
    this.#pendingStartErrorCallback = options?.onThreadStartFailed ?? null;
    this.#suppressNextNavigation = options?.suppressNavigation ?? false;
    const sendResult = socket.send({
      method: "thread/start",
      id,
      params: {
        cwd,
        ...(requestedModel ? { model: requestedModel } : {}),
        ...(options?.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
        ...(options?.sandbox ? { sandbox: options.sandbox } : {}),
        ...(options?.modelProvider ? { modelProvider: options.modelProvider } : {}),
        ...(options?.baseInstructions ? { baseInstructions: options.baseInstructions } : {}),
        ...(options?.developerInstructions ? { developerInstructions: options.developerInstructions } : {}),
        ...(options?.personality ? { personality: options.personality } : {}),
      },
    });
    if (!sendResult.success) {
      this.#pendingRequests.delete(id);
      const message = sendResult.error ?? "Failed to start thread";
      this.#handleStartFailure({ message });
      throw new Error(message);
    }
  }

  #resolveStartModel(collaborationMode?: CollaborationMode): string | null {
    const collabModel = collaborationMode?.settings?.model?.trim();
    if (collabModel) return collabModel;
    return models.defaultModel?.value ?? null;
  }

  #handleStartFailure(error: unknown) {
    const message = this.#getErrorMessage(error);
    if (this.#pendingStartErrorCallback) {
      this.#pendingStartErrorCallback(new Error(message));
    }
    this.#pendingStartCallback = null;
    this.#pendingStartErrorCallback = null;
    this.#pendingStartInput = null;
    this.#pendingStartModel = null;
    this.#pendingCollaborationMode = null;
    this.#suppressNextNavigation = false;
  }

  #getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return "Failed to start thread";
  }

  #loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved) as Record<string, ThreadSettings>;
      const next = new Map<string, ThreadSettings>();
      for (const [threadId, settings] of Object.entries(data)) {
        if (!threadId) continue;
        next.set(threadId, { ...DEFAULT_SETTINGS, ...settings });
      }
      this.#settings = next;
    } catch {
      // ignore
    }
  }

  #saveSettings() {
    try {
      const data: Record<string, ThreadSettings> = {};
      for (const [threadId, settings] of this.#settings) {
        data[threadId] = settings;
      }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

function getStore(): ThreadsStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    const store = new ThreadsStore();
    global[STORE_KEY] = store;
    socket.onMessage((msg) => store.handleMessage(msg));
  }
  return global[STORE_KEY] as ThreadsStore;
}

export const threads = getStore();
