import type { ApprovalPolicy, CollaborationMode, CollaborationModeMask, ModeKind, Personality, ReasoningEffort, SandboxMode, ThreadInfo, RpcMessage, ThreadSettings, TokenUsage, ThreadStatus as ThreadStatusType } from "./types";
import { codexTextInput } from "./codex-input";
import { socket } from "./socket.svelte";
import { models } from "./models.svelte";
import { navigate } from "../router";

const STORE_KEY = "__zane_threads_store__";
const SETTINGS_STORAGE_KEY = "zane_thread_settings";

const DEFAULT_SETTINGS: ThreadSettings = {
  model: "",
  reasoningEffort: "medium",
  serviceTier: "default",
  personality: "default",
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
  #pendingResumeRequests = new Map<number, { threadId: string; attempt: number }>();
  #resumeRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #pendingStartInput: string | null = null;
  #pendingStartThreadId: string | null = null;
  #pendingStartModel: string | null = null;
  #pendingCollaborationMode: CollaborationMode | null = null;
  #pendingServiceTier = "default";
  #pendingPersonality: Personality = "default";
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
    socket.onConnect(() => {
      this.#reattachResumedThreads();
      this.#sendPendingStartTurn();
    });
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
      current.serviceTier === next.serviceTier &&
      current.personality === next.personality &&
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
    this.#resumeThread(threadId);
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
      serviceTier?: string;
      personality?: Personality;
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
        this.#upsertThread(params.thread);
      }
      return;
    }

    if (msg.method === "thread/settings/updated") {
      const params = msg.params as {
        threadId?: string;
        threadSettings?: {
          model?: string;
          serviceTier?: string | null;
          effort?: string | null;
          personality?: Personality | null;
          sandboxPolicy?: unknown;
        };
      };
      const threadId = params?.threadId;
      const settings = params?.threadSettings;
      if (threadId && settings) {
        const sandbox = this.#normalizeSandbox(settings.sandboxPolicy);
        this.updateSettings(threadId, {
          ...(settings.model ? { model: settings.model } : {}),
          ...(settings.effort ? { reasoningEffort: settings.effort } : {}),
          serviceTier: settings.serviceTier ?? "default",
          personality: settings.personality ?? "default",
          ...(sandbox ? { sandbox } : {}),
        });
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
      }

      if (type === "list") this.loading = false;

      if (type === "fork" && msg.result) {
        const result = msg.result as { thread?: ThreadInfo };
        if (result.thread) {
          this.#openCreatedThread(result.thread, false);
        }
      }

      if (type === "collaborationPresets" && msg.result) {
        const result = msg.result as { data: CollaborationModeMask[] };
        this.#collaborationPresets = result.data || [];
      }

      if (type === "rollback" && msg.result) {
        const result = msg.result as { thread?: { id: string; turns?: Array<{ items?: unknown[] }> } };
        if (result.thread?.id) {
          this.#resumeThread(result.thread.id);
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
            reasoningEffort: result.reasoningEffort
              ?? this.#pendingCollaborationMode?.settings?.reasoning_effort
              ?? DEFAULT_SETTINGS.reasoningEffort,
            serviceTier: this.#pendingServiceTier,
            personality: this.#pendingPersonality,
            mode: this.#pendingCollaborationMode?.mode ?? DEFAULT_SETTINGS.mode,
            ...(sandbox ? { sandbox } : {}),
          });

          this.#openCreatedThread(thread, true);
        }
      }

      if (type === "start") {
        this.#pendingStartModel = null;
      }
    }

    if (msg.id != null && this.#pendingResumeRequests.has(msg.id as number)) {
      const request = this.#pendingResumeRequests.get(msg.id as number)!;
      this.#pendingResumeRequests.delete(msg.id as number);
      if (msg.error && request.attempt < 5 && this.#isTransientResumeError(msg.error)) {
        this.#scheduleResumeRetry(request.threadId, request.attempt + 1);
      } else if (this.currentId === request.threadId) {
        this.loading = false;
      }
    }
  }

  #resumeThread(threadId: string, attempt = 0) {
    const retryTimer = this.#resumeRetryTimers.get(threadId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.#resumeRetryTimers.delete(threadId);
    }
    const id = this.#nextId++;
    this.#pendingResumeRequests.set(id, { threadId, attempt });
    const result = socket.send({
      method: "thread/resume",
      id,
      params: { threadId },
    });
    if (!result.success) {
      this.#pendingResumeRequests.delete(id);
      if (this.currentId === threadId) this.loading = false;
    }
  }

  #scheduleResumeRetry(threadId: string, attempt: number) {
    const delays = [50, 100, 250, 500, 1_000];
    const timer = setTimeout(() => {
      this.#resumeRetryTimers.delete(threadId);
      this.#resumeThread(threadId, attempt);
    }, delays[Math.min(attempt - 1, delays.length - 1)]);
    this.#resumeRetryTimers.set(threadId, timer);
  }

  #isTransientResumeError(error: unknown): boolean {
    const message = this.#getErrorMessage(error).toLowerCase();
    return message.includes("rollout") && (
      message.includes("empty") ||
      message.includes("failed to read") ||
      message.includes("session metadata")
    );
  }

  #reattachResumedThreads() {
    const threadIds = new Set(socket.subscribedThreadIds());
    if (this.currentId) {
      threadIds.add(this.currentId);
    }

    for (const threadId of threadIds) {
      this.#resumeThread(threadId);
    }
  }

  #upsertThread(thread: ThreadInfo) {
    const index = this.list.findIndex((candidate) => candidate.id === thread.id);
    if (index < 0) {
      this.list = [thread, ...this.list];
      return;
    }
    const list = [...this.list];
    list[index] = { ...list[index], ...thread };
    this.list = list;
  }

  #openCreatedThread(thread: ThreadInfo, consumePendingStart: boolean) {
    this.#upsertThread(thread);
    this.currentId = thread.id;
    socket.subscribeThread(thread.id);
    if (consumePendingStart && this.#pendingStartCallback) {
      this.#pendingStartCallback(thread.id);
      this.#pendingStartCallback = null;
    }
    if (consumePendingStart) this.#pendingStartErrorCallback = null;
    if (!consumePendingStart || !this.#suppressNextNavigation) {
      navigate("/thread/:id", { params: { id: thread.id } });
    }
    if (consumePendingStart) {
      this.#pendingStartThreadId = this.#pendingStartInput ? thread.id : null;
      this.#sendPendingStartTurn();
      this.#suppressNextNavigation = false;
    }
  }

  #sendPendingStartTurn() {
    if (!this.#pendingStartThreadId || !this.#pendingStartInput) return;
    const result = socket.send({
      method: "turn/start",
      id: this.#nextId++,
      params: {
        threadId: this.#pendingStartThreadId,
        input: [codexTextInput(this.#pendingStartInput)],
        ...(this.#pendingCollaborationMode
          ? { collaborationMode: this.#pendingCollaborationMode }
          : {}),
        serviceTier: this.#pendingServiceTier === "default" ? null : this.#pendingServiceTier,
        ...(this.#pendingPersonality !== "default"
          ? { personality: this.#pendingPersonality }
          : {}),
      },
    });
    if (result.success) {
      this.#pendingStartInput = null;
      this.#pendingStartThreadId = null;
      this.#pendingCollaborationMode = null;
      this.#pendingServiceTier = "default";
      this.#pendingPersonality = "default";
    }
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
      serviceTier?: string;
      personality?: Personality;
    }
  ) {
    const requestedModel = this.#resolveStartModel(options?.collaborationMode);
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "start");
    this.#pendingStartInput = input?.trim() ? input.trim() : null;
    this.#pendingStartModel = requestedModel;
    this.#pendingCollaborationMode = options?.collaborationMode ?? null;
    this.#pendingServiceTier = options?.serviceTier ?? "default";
    this.#pendingPersonality = options?.personality ?? "default";
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
        ...(options?.serviceTier && options.serviceTier !== "default"
          ? { serviceTier: options.serviceTier }
          : {}),
        ...(options?.personality && options.personality !== "default"
          ? { personality: options.personality }
          : {}),
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
    this.#pendingStartThreadId = null;
    this.#pendingStartModel = null;
    this.#pendingCollaborationMode = null;
    this.#pendingServiceTier = "default";
    this.#pendingPersonality = "default";
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
