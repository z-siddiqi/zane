import type { Message, RpcMessage, ApprovalRequest, UserInputRequest, UserInputQuestion, TurnStatus, PlanStep, CollaborationMode } from "./types";
import { codexTextInput } from "./codex-input";
import { socket } from "./socket.svelte";
import { threads } from "./threads.svelte";

const STORE_KEY = "__zane_messages_store__";

type ReasoningMode = "summary" | "raw";
interface ReasoningState {
  buffer: string;
  full: string;
  mode: ReasoningMode | null;
  header: string | null;
}

type TurnCompleteCallback = (threadId: string, finalText: string) => void;

class MessagesStore {
  #byThread = $state<Map<string, Message[]>>(new Map());
  #streamingText = $state<Map<string, string>>(new Map());
  #loadedThreads = new Set<string>();
  #pendingApprovals = $state<Map<string, ApprovalRequest>>(new Map());
  #pendingLiveMessages = new Map<string, Message>(); // survives clearThread for replay preservation
  #reasoningByThread = new Map<string, ReasoningState>();
  #execCommands = new Map<string, string>();
  #turnCompleteCallbacks = new Map<string, TurnCompleteCallback>();
  #pendingAgentMessageIds = new Map<string, string>();

  // Streaming reasoning state (reactive, per thread)
  #streamingReasoningTextByThread = $state<Map<string, string>>(new Map());
  #isReasoningStreamingByThread = $state<Map<string, boolean>>(new Map());

  // Turn state (per thread)
  #turnIdByThread = $state<Map<string, string>>(new Map());
  #turnStatusByThread = $state<Map<string, TurnStatus>>(new Map());
  #interruptPendingByThread = new Set<string>();
  #planByThread = $state<Map<string, PlanStep[]>>(new Map());
  #planExplanationByThread = $state<Map<string, string | null>>(new Map());
  #statusDetailByThread = $state<Map<string, string | null>>(new Map());

  get turnStatus() {
    const threadId = threads.currentId;
    if (!threadId) return null;
    return this.#turnStatusByThread.get(threadId) ?? null;
  }
  get plan() {
    const threadId = threads.currentId;
    if (!threadId) return [];
    return this.#planByThread.get(threadId) ?? [];
  }
  get planExplanation() {
    const threadId = threads.currentId;
    if (!threadId) return null;
    return this.#planExplanationByThread.get(threadId) ?? null;
  }
  get statusDetail() {
    const threadId = threads.currentId;
    if (!threadId) return null;
    return this.#statusDetailByThread.get(threadId) ?? null;
  }
  get isReasoningStreaming() {
    const threadId = threads.currentId;
    if (!threadId) return false;
    return this.#isReasoningStreamingByThread.get(threadId) ?? false;
  }
  get streamingReasoningText() {
    const threadId = threads.currentId;
    if (!threadId) return "";
    return this.#streamingReasoningTextByThread.get(threadId) ?? "";
  }

  steer(threadId: string, text: string): { success: boolean; error?: string } {
    const turnId = this.#turnIdByThread.get(threadId);
    const turnStatus = this.#turnStatusByThread.get(threadId) ?? null;
    if (!turnId || (turnStatus ?? "").toLowerCase() !== "inprogress") {
      return { success: false, error: "No active turn to steer" };
    }

    return socket.send({
      method: "turn/steer",
      id: Date.now(),
      params: {
        threadId,
        input: [codexTextInput(text)],
        expectedTurnId: turnId,
      },
    });
  }

  interrupt(threadId: string): { success: boolean; error?: string } {
    const turnId = this.#turnIdByThread.get(threadId);
    const turnStatus = this.#turnStatusByThread.get(threadId) ?? null;
    if (!turnId || (turnStatus ?? "").toLowerCase() !== "inprogress") {
      return { success: true };
    }
    if (this.#interruptPendingByThread.has(threadId)) {
      return { success: true };
    }

    const result = socket.send({
      method: "turn/interrupt",
      id: Date.now(),
      params: { threadId, turnId },
    });

    if (result.success) {
      this.#interruptPendingByThread.add(threadId);
    }
    return result;
  }

  onTurnComplete(threadId: string, callback: TurnCompleteCallback): () => void {
    this.#turnCompleteCallbacks.set(threadId, callback);
    return () => {
      this.#turnCompleteCallbacks.delete(threadId);
    };
  }

  clearThread(threadId: string) {
    this.#byThread.delete(threadId);
    this.#loadedThreads.delete(threadId);
    this.#interruptPendingByThread.delete(threadId);
    for (const key of this.#streamingText.keys()) {
      if (key.startsWith(`${threadId}:`)) {
        this.#streamingText.delete(key);
      }
    }
  }

  get current(): Message[] {
    const threadId = threads.currentId;
    if (!threadId) return [];
    return this.#byThread.get(threadId) ?? [];
  }

  getThreadMessages(threadId: string | null): Message[] {
    if (!threadId) return [];
    return this.#byThread.get(threadId) ?? [];
  }

  getLatestAssistantMessage(threadId: string | null): Message | null {
    const messages = this.getThreadMessages(threadId);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.role === "assistant") return msg;
    }
    return null;
  }

  approve(approvalId: string, forSession = false, _collaborationMode?: CollaborationMode) {
    const approval = this.#pendingApprovals.get(approvalId);
    if (!approval || approval.status !== "pending") return;

    approval.status = "approved";
    this.#pendingApprovals = new Map(this.#pendingApprovals);
    this.#updateApprovalInMessages(approvalId, "approved");

    socket.send({
      id: approval.rpcId,
      result: this.#approvalAcceptResult(approval, forSession),
    });
  }

  decline(approvalId: string, _collaborationMode?: CollaborationMode) {
    const approval = this.#pendingApprovals.get(approvalId);
    if (!approval || approval.status !== "pending") return;

    approval.status = "declined";
    this.#pendingApprovals = new Map(this.#pendingApprovals);
    this.#updateApprovalInMessages(approvalId, "declined");

    socket.send({
      id: approval.rpcId,
      result: this.#approvalRejectResult(approval, "decline"),
    });
  }

  cancel(approvalId: string) {
    const approval = this.#pendingApprovals.get(approvalId);
    if (!approval || approval.status !== "pending") return;

    approval.status = "cancelled";
    this.#pendingApprovals = new Map(this.#pendingApprovals);
    this.#updateApprovalInMessages(approvalId, "cancelled");

    socket.send({
      id: approval.rpcId,
      result: this.#approvalRejectResult(approval, "cancel"),
    });
  }

  #approvalAcceptResult(approval: ApprovalRequest, forSession: boolean): Record<string, unknown> {
    if (approval.method === "item/permissions/requestApproval") {
      return {
        permissions: this.#grantedPermissions(approval.requestedPermissions),
        scope: forSession ? "session" : "turn",
      };
    }

    if (approval.method === "mcpServer/elicitation/request") {
      return { action: "accept", content: {}, _meta: null };
    }

    return { decision: forSession ? "acceptForSession" : "accept" };
  }

  #approvalRejectResult(approval: ApprovalRequest, action: "decline" | "cancel"): Record<string, unknown> {
    if (approval.method === "item/permissions/requestApproval") {
      return { permissions: {}, scope: "turn" };
    }

    if (approval.method === "mcpServer/elicitation/request") {
      return { action, content: null, _meta: null };
    }

    return { decision: action };
  }

  #grantedPermissions(requestedPermissions: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!requestedPermissions) return {};

    const granted: Record<string, unknown> = {};
    const network = requestedPermissions.network;
    const fileSystem = requestedPermissions.fileSystem ?? requestedPermissions.file_system;

    if (network && typeof network === "object") {
      granted.network = network;
    }
    if (fileSystem && typeof fileSystem === "object") {
      granted.fileSystem = fileSystem;
    }

    return granted;
  }

  respondToUserInput(messageId: string, answers: Record<string, string[]>, collaborationMode?: CollaborationMode) {
    this.#pendingLiveMessages.delete(messageId);

    const threadId = threads.currentId;
    if (!threadId) return;

    const msgs = this.#byThread.get(threadId) ?? [];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const msg = msgs[idx];
    if (!msg.userInputRequest || msg.userInputRequest.status !== "pending") return;

    const formattedAnswers: Record<string, { answers: string[] }> = {};
    for (const [questionId, selected] of Object.entries(answers)) {
      formattedAnswers[questionId] = { answers: selected };
    }

    socket.send({
      id: msg.userInputRequest.rpcId,
      result: { answers: formattedAnswers, ...(collaborationMode ? { collaborationMode } : {}) },
    });

    const updated = [...msgs];
    updated[idx] = {
      ...msgs[idx],
      userInputRequest: { ...msgs[idx].userInputRequest!, status: "answered" },
    };
    this.#byThread = new Map(this.#byThread).set(threadId, updated);
  }

  approvePlan(messageId: string) {
    const threadId = threads.currentId;
    if (!threadId) return;

    const msgs = this.#byThread.get(threadId) ?? [];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const updated = [...msgs];
    updated[idx] = { ...msgs[idx], planStatus: "approved" };
    this.#byThread = new Map(this.#byThread).set(threadId, updated);
  }

  #updateApprovalInMessages(approvalId: string, status: "approved" | "declined" | "cancelled") {
    this.#pendingLiveMessages.delete(`approval-${approvalId}`);

    const threadId = threads.currentId;
    if (!threadId) return;

    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.approval?.id === approvalId);
    if (idx >= 0) {
      const updated = [...messages];
      updated[idx] = {
        ...messages[idx],
        approval: { ...messages[idx].approval!, status },
      };
      this.#byThread = new Map(this.#byThread).set(threadId, updated);
    }
  }

  #add(threadId: string, message: Message) {
    const existing = this.#byThread.get(threadId) ?? [];
    if (existing.some((m) => m.id === message.id)) {
      return;
    }
    this.#byThread.set(threadId, [...existing, message]);
    this.#byThread = new Map(this.#byThread);
  }

  #upsert(threadId: string, message: Message) {
    const existing = this.#byThread.get(threadId) ?? [];
    const idx = existing.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      const updated = [...existing];
      updated[idx] = { ...updated[idx], ...message };
      this.#byThread = new Map(this.#byThread).set(threadId, updated);
      return;
    }
    this.#byThread.set(threadId, [...existing, message]);
    this.#byThread = new Map(this.#byThread);
  }

  #remove(threadId: string, messageId: string) {
    const existing = this.#byThread.get(threadId) ?? [];
    const idx = existing.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const updated = [...existing];
    updated.splice(idx, 1);
    this.#byThread = new Map(this.#byThread).set(threadId, updated);
  }

  #appendToMessage(threadId: string, itemId: string, delta: string, role: Message["role"], kind?: Message["kind"]) {
    const key = `${threadId}:${itemId}`;
    const current = this.#streamingText.get(key) ?? "";
    this.#streamingText.set(key, current + delta);
    this.#streamingText = new Map(this.#streamingText);

    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.id === itemId);
    const nextText = this.#streamingText.get(key) ?? "";

    if (idx >= 0) {
      const updated = [...messages];
      updated[idx] = { ...messages[idx], text: nextText };
      this.#byThread = new Map(this.#byThread).set(threadId, updated);
    } else {
      this.#upsert(threadId, {
        id: itemId,
        role,
        kind,
        text: nextText,
        threadId,
      });
    }
  }

  #updateStreaming(threadId: string, itemId: string, delta: string) {
    this.#appendToMessage(threadId, itemId, delta, "assistant");
  }

  #updateStreamingTool(threadId: string, itemId: string, delta: string, kind?: Message["kind"]) {
    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.id === itemId);

    if (idx >= 0) {
      this.#appendToMessage(threadId, itemId, delta, messages[idx].role, messages[idx].kind ?? kind);
      return;
    }
    this.#appendToMessage(threadId, itemId, delta, "tool", kind);
  }

  #clearStreaming(threadId: string, itemId: string) {
    const key = `${threadId}:${itemId}`;
    if (this.#streamingText.delete(key)) {
      this.#streamingText = new Map(this.#streamingText);
    }
  }

  #getReasoningState(threadId: string): ReasoningState {
    const existing = this.#reasoningByThread.get(threadId);
    if (existing) return existing;
    const next: ReasoningState = { buffer: "", full: "", mode: null, header: null };
    this.#reasoningByThread.set(threadId, next);
    return next;
  }

  #resetReasoningState(threadId: string) {
    this.#reasoningByThread.set(threadId, { buffer: "", full: "", mode: null, header: null });
    this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, false);
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, "");
  }

  #appendReasoningDelta(threadId: string, delta: string, mode: ReasoningMode) {
    const state = this.#getReasoningState(threadId);
    if (state.mode === "raw" && mode === "summary") return;
    if (!state.mode || mode === "raw") {
      state.mode = mode;
    }

    state.buffer += delta;

    // Update reactive streaming state
    this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, true);
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, state.full + state.buffer);

    const header = this.#extractFirstBold(state.buffer);
    if (header) {
      state.header = header;
      this.#statusDetailByThread = new Map(this.#statusDetailByThread).set(threadId, header);
    }
  }

  #reasoningSectionBreak(threadId: string) {
    const state = this.#getReasoningState(threadId);
    if (state.buffer) {
      state.full += state.buffer;
      state.buffer = "";
    }
    state.full += "\n\n";
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, state.full);
  }

  #finaliseReasoning(threadId: string, item: Record<string, unknown>) {
    const state = this.#getReasoningState(threadId);
    if (state.buffer) {
      state.full += state.buffer;
      state.buffer = "";
    }

    const fromItem = this.#reasoningTextFromItem(item);
    const full = state.full.trim().length > 0 ? state.full : fromItem;

    state.full = "";
    state.mode = null;
    state.header = null;

    // Reset streaming state
    this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, false);
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, "");

    const summary = this.#extractReasoningSummary(full);
    if (!summary) return;

    const itemId = (item.id as string) || `reasoning-${threadId}-${Date.now()}`;
    this.#upsert(threadId, {
      id: itemId,
      role: "assistant",
      kind: "reasoning",
      text: summary,
      threadId,
    });
  }

  #reasoningTextFromItem(item: Record<string, unknown>): string {
    const summary = Array.isArray(item.summary) ? item.summary.join("") : "";
    const content = Array.isArray(item.content) ? item.content.join("") : "";
    return (content || summary).trim();
  }

  #extractFirstBold(text: string): string | null {
    const match = text.match(/\*\*(.+?)\*\*/s);
    return match?.[1]?.trim() || null;
  }

  #extractReasoningSummary(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const open = trimmed.indexOf("**");
    if (open >= 0) {
      const afterOpen = trimmed.slice(open + 2);
      const close = afterOpen.indexOf("**");
      if (close >= 0) {
        const afterCloseIdx = open + 2 + close + 2;
        if (afterCloseIdx < trimmed.length) {
          return trimmed.slice(afterCloseIdx).trim();
        }
      }
    }
    return trimmed;
  }

  handleMessage(msg: RpcMessage) {
    if (msg.result && !msg.method) {
      const result = msg.result as { thread?: { id: string; turns?: Array<{ items?: unknown[] }> } };
      if (result.thread?.turns) {
        const threadId = result.thread.id;
        if (!this.#loadedThreads.has(threadId)) {
          this.#loadedThreads.add(threadId);
          this.#loadThread(threadId, result.thread.turns);
        }
      }
      return;
    }

    const method = msg.method;
    const params = msg.params as Record<string, unknown> | undefined;
    if (!params) return;

    const threadId = this.#extractThreadId(params);
    if (!threadId) return;

    // Item started - handle user messages
    if (method === "item/started") {
      const item = params.item as Record<string, unknown>;
      if (!item) return;

      const type = item.type as string;
      if (type === "userMessage") {
        const itemId = item.id as string;
        const content = item.content as Array<{ type: string; text?: string }>;
        const text = content?.find((c) => c.type === "text")?.text || "";

        this.#add(threadId, {
          id: itemId,
          role: "user",
          text,
          threadId,
        });
      } else if (type === "commandExecution") {
        const itemId = item.id as string;
        const command = (item.command as string) || "";
        if (itemId && command) {
          this.#execCommands.set(itemId, command);
        }
      }
      return;
    }

    // Agent message delta (streaming)
    if (method === "item/agentMessage/delta") {
      const delta = (params.delta as string) || "";
      const providedId = (params.itemId as string) || (params.item_id as string);
      const itemId = providedId || `agent-${threadId}`;
      if (!providedId) {
        this.#pendingAgentMessageIds.set(threadId, itemId);
      }
      this.#updateStreaming(threadId, itemId, delta);
      return;
    }

    // Reasoning summary delta
    if (method === "item/reasoning/summaryTextDelta") {
      const delta = (params.delta as string) || "";
      if (delta) {
        this.#appendReasoningDelta(threadId, delta, "summary");
      }
      return;
    }

    // Reasoning content delta (raw)
    if (method === "item/reasoning/textDelta") {
      const delta = (params.delta as string) || "";
      if (delta) {
        this.#appendReasoningDelta(threadId, delta, "raw");
      }
      return;
    }

    // Reasoning section break
    if (method === "item/reasoning/summaryPartAdded") {
      this.#reasoningSectionBreak(threadId);
      return;
    }

    // Terminal interaction (interactive command)
    if (method === "item/commandExecution/terminalInteraction") {
      const stdin = (params.stdin as string) || "";
      const processId = (params.processId as string) || (params.process_id as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || "";
      const key = processId || itemId || `terminal-${threadId}`;
      const command = itemId ? this.#execCommands.get(itemId) : null;
      const waitingLine = command ? `(waiting for ${command})` : "(waiting for command output)";
      const waitId = `terminal-wait-${key}`;
      const messageId = `terminal-${key}`;
      const trimmed = stdin.replace(/\r?\n$/, "");

      if (!stdin) {
        this.#upsert(threadId, {
          id: waitId,
          role: "tool",
          kind: "wait",
          text: waitingLine,
          threadId,
        });
        return;
      }

      this.#remove(threadId, waitId);
      if (trimmed) {
        this.#appendToMessage(threadId, messageId, `${trimmed}\n`, "tool", "terminal");
      }
      return;
    }

    // Command execution output delta (streaming)
    if (method === "item/commandExecution/outputDelta") {
      const delta = (params.delta as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `cmd-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, delta, "command");
      return;
    }

    // File change output delta (streaming)
    if (method === "item/fileChange/outputDelta") {
      const delta = (params.delta as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `file-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, delta, "file");
      return;
    }

    // MCP tool call progress
    if (method === "item/mcpToolCall/progress") {
      const message = (params.message as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `mcp-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, message + "\n", "mcp");
      return;
    }

    // Plan item delta (streaming)
    if (method === "item/plan/delta") {
      const delta = (params.delta as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `plan-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, delta, "plan");
      return;
    }

    // Turn started
    if (method === "turn/started") {
      const turn = params.turn as { id: string; status?: string } | undefined;
      if (turn) {
        this.#turnIdByThread = new Map(this.#turnIdByThread).set(threadId, turn.id);
        this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, (turn.status as TurnStatus) || "InProgress");
        this.#interruptPendingByThread.delete(threadId);
        this.#planByThread = new Map(this.#planByThread).set(threadId, []);
        this.#planExplanationByThread = new Map(this.#planExplanationByThread).set(threadId, null);
        this.#statusDetailByThread = new Map(this.#statusDetailByThread).set(threadId, null);
        this.#resetReasoningState(threadId);
      }
      return;
    }

    // Turn completed
    if (method === "turn/completed") {
      const turn = params.turn as { id: string; status?: string } | undefined;
      if (turn) {
        this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, (turn.status as TurnStatus) || "Completed");
        this.#interruptPendingByThread.delete(threadId);
        this.#statusDetailByThread = new Map(this.#statusDetailByThread).set(threadId, null);

        // Clear pending live messages for this thread — turn is done
        for (const [id, msg] of this.#pendingLiveMessages) {
          if (msg.threadId === threadId) this.#pendingLiveMessages.delete(id);
        }

        // Fire turn complete callback if registered
        const callback = this.#turnCompleteCallbacks.get(threadId);
        if (callback) {
          const latestMessage = this.getLatestAssistantMessage(threadId);
          callback(threadId, latestMessage?.text ?? "");
          this.#turnCompleteCallbacks.delete(threadId);
        }
      }
      return;
    }

    // Turn plan updated
    if (method === "turn/plan/updated") {
      const explanation = params.explanation as string | undefined;
      const plan = params.plan as Array<{ step: string; status: string }> | undefined;

      if (explanation) {
        this.#planExplanationByThread = new Map(this.#planExplanationByThread).set(threadId, explanation);
      }
      if (plan) {
        this.#planByThread = new Map(this.#planByThread).set(threadId, plan.map((p) => ({
          step: p.step,
          status: p.status as PlanStep["status"],
        })));
      }
      return;
    }

    // User input requests (plan mode questions)
    if (method === "item/tool/requestUserInput") {
      const rpcId = msg.id as number | string;
      const itemId = (params.itemId as string) || (params.item_id as string) || `user-input-${Date.now()}`;
      const questions = (params.questions as UserInputQuestion[]) || [];

      // A pending request means a turn is actively waiting
      this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, "InProgress");

      const userInputRequest: UserInputRequest = {
        rpcId,
        questions,
        status: "pending",
      };

      const inputMsg: Message = {
        id: `user-input-${itemId}`,
        role: "assistant",
        kind: "user-input-request",
        text: questions.map((q) => q.question).join("\n"),
        threadId,
        userInputRequest,
      };
      this.#pendingLiveMessages.set(inputMsg.id, inputMsg);
      const existing = this.#byThread.get(threadId);
      if (!existing?.some((m) => m.id === inputMsg.id)) {
        this.#add(threadId, inputMsg);
      }
      return;
    }

    // MCP server elicitation request (form input)
    if (method === "mcpServer/elicitation/request") {
      const rpcId = msg.id as number | string;
      const itemId = `elicitation-${rpcId}`;
      const serverName = (params.serverName as string) || "MCP Server";
      const request = params.request as { message?: string } | undefined;
      const description = request?.message || `${serverName} requires input`;

      this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, "InProgress");

      const approval: ApprovalRequest = {
        id: itemId,
        rpcId,
        method,
        type: "elicitation",
        description,
        toolName: serverName,
        status: "pending",
      };

      this.#pendingApprovals.set(itemId, approval);
      this.#pendingApprovals = new Map(this.#pendingApprovals);

      const approvalMsg: Message = {
        id: `approval-${itemId}`,
        role: "approval",
        kind: "approval-request",
        text: description,
        threadId,
        approval,
      };
      this.#pendingLiveMessages.set(approvalMsg.id, approvalMsg);
      const existing = this.#byThread.get(threadId);
      if (!existing?.some((m) => m.id === approvalMsg.id)) {
        this.#add(threadId, approvalMsg);
      }
      return;
    }

    // Approval requests (file changes, commands, etc.)
    if (method?.includes("/requestApproval")) {
      const itemId = (params.approvalId as string) || (params.itemId as string) || `approval-${Date.now()}`;
      const reason = (params.reason as string) || null;
      const rpcId = msg.id as number | string; // Capture the request ID for response

      // A pending approval means a turn is actively waiting
      this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, "InProgress");

      // Determine type from method name
      let approvalType: ApprovalRequest["type"] = "other";
      let description = "";

      if (method === "item/fileChange/requestApproval") {
        approvalType = "file";
        description = reason || "File change requires approval";
      } else if (method === "item/commandExecution/requestApproval") {
        approvalType = "command";
        description = reason || "Command execution requires approval";
      } else if (method === "item/permissions/requestApproval") {
        approvalType = "permissions";
        description = reason || "Additional permissions required";
      } else if (method === "item/mcpToolCall/requestApproval") {
        approvalType = "mcp";
        description = reason || "MCP tool call requires approval";
      } else {
        description = reason || "Action requires approval";
      }

      // Extract richer params from command approval
      const command = (params.command as string) || undefined;
      const cwd = (params.cwd as string) || undefined;
      const grantRoot = (params.grantRoot as string) || undefined;
      const requestedPermissions =
        params.permissions && typeof params.permissions === "object" && !Array.isArray(params.permissions)
          ? (params.permissions as Record<string, unknown>)
          : undefined;

      const approval: ApprovalRequest = {
        id: itemId,
        rpcId, // Store the RPC ID so we can respond to it
        method,
        type: approvalType,
        description,
        command,
        cwd,
        grantRoot,
        requestedPermissions,
        status: "pending",
      };

      this.#pendingApprovals.set(itemId, approval);
      this.#pendingApprovals = new Map(this.#pendingApprovals);

      const approvalMsg: Message = {
        id: `approval-${itemId}`,
        role: "approval",
        kind: "approval-request",
        text: description,
        threadId,
        approval,
      };
      this.#pendingLiveMessages.set(approvalMsg.id, approvalMsg);
      const existing = this.#byThread.get(threadId);
      if (!existing?.some((m) => m.id === approvalMsg.id)) {
        this.#add(threadId, approvalMsg);
      }
      return;
    }

    // Error notification
    if (method === "error") {
      const message = (params.message as string) || (params.error as string) || "Unknown error";
      this.#add(threadId, {
        id: `error-${threadId}-${Date.now()}`,
        role: "tool",
        kind: "error",
        text: message,
        threadId,
      });
      return;
    }

    // Model rerouted notification
    if (method === "model/rerouted") {
      const from = (params.fromModel as string) || "";
      const to = (params.toModel as string) || "";
      const reason = (params.reason as string) || "";
      const text = `Model changed from ${from} to ${to}${reason ? `: ${reason}` : ""}`;
      this.#add(threadId, {
        id: `reroute-${threadId}-${Date.now()}`,
        role: "tool",
        kind: "warning",
        text,
        threadId,
      });
      return;
    }

    // Deprecation notice
    if (method === "deprecationNotice") {
      const summary = (params.summary as string) || "";
      const details = (params.details as string) || "";
      this.#add(threadId, {
        id: `deprecation-${threadId}-${Date.now()}`,
        role: "tool",
        kind: "warning",
        text: details ? `${summary}\n${details}` : summary,
        threadId,
      });
      return;
    }

    // Config warning
    if (method === "configWarning") {
      const message = (params.message as string) || (params.summary as string) || "Configuration warning";
      this.#add(threadId, {
        id: `config-warn-${threadId}-${Date.now()}`,
        role: "tool",
        kind: "warning",
        text: message,
        threadId,
      });
      return;
    }

    // Turn diff updated
    if (method === "turn/diff/updated") {
      const diff = (params.diff as string) || "";
      if (diff) {
        const turnId = (params.turnId as string) || "";
        this.#upsert(threadId, {
          id: `diff-${threadId}-${turnId}`,
          role: "tool",
          kind: "diff",
          text: diff,
          threadId,
        });
      }
      return;
    }

    // Server request resolved (clear the corresponding pending approval)
    if (method === "serverRequest/resolved") {
      const requestId = params.requestId as number | undefined;
      if (requestId != null) {
        for (const [id, approval] of this.#pendingApprovals) {
          if (approval.rpcId === requestId && approval.status === "pending") {
            approval.status = "approved";
            this.#pendingApprovals = new Map(this.#pendingApprovals);
            this.#updateApprovalInMessages(id, "approved");
            break;
          }
        }
      }
      return;
    }

    // Item completed (tool outputs, file changes, commands)
    if (method === "item/completed") {
      const item = params.item as Record<string, unknown>;
      if (!item) return;

      const itemId = (item.id as string) || `item-${Date.now()}`;
      const type = item.type as string;

      switch (type) {
        case "agentMessage": {
          const text = ((item.text as string) || "").replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/g, "").trim();
          if (!text) return;
          const pendingId = this.#pendingAgentMessageIds.get(threadId);
          if (pendingId && pendingId !== itemId) {
            this.#remove(threadId, pendingId);
            this.#clearStreaming(threadId, pendingId);
          }
          this.#pendingAgentMessageIds.delete(threadId);
          this.#upsert(threadId, { id: itemId, role: "assistant", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "reasoning":
          this.#finaliseReasoning(threadId, item);
          return;
        case "commandExecution": {
          const command = (item.command as string) || "";
          const output = (item.aggregatedOutput as string) || "";
          const text = command ? `$ ${command}\n${output}` : output;
          const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
          this.#upsert(threadId, {
            id: itemId,
            role: "tool",
            kind: "command",
            text,
            threadId,
            metadata: exitCode !== null ? { exitCode } : undefined,
          });
          this.#clearStreaming(threadId, itemId);
          this.#execCommands.delete(itemId);
          return;
        }
        case "fileChange": {
          const changes = item.changes as Array<{ path: string; diff?: string }>;
          const text = changes?.map((c) => `${c.path}\n${c.diff || ""}`).join("\n\n") || "";
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "file", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "mcpToolCall": {
          const result = item.error ?? item.result ?? "";
          const text = `Tool: ${item.tool}\n${result ? JSON.stringify(result, null, 2) : ""}`;
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "mcp", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "webSearch": {
          const text = `Search: ${item.query}`;
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "web", text, threadId });
          return;
        }
        case "imageView": {
          const text = `Image: ${item.path ?? ""}`;
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "image", text, threadId });
          return;
        }
        case "enteredReviewMode": {
          const review = (item.review as string) || "";
          const text = review ? `Review started: ${review}` : "Review started.";
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "review", text, threadId });
          return;
        }
        case "exitedReviewMode": {
          const review = (item.review as string) || "";
          const text = review || "Review complete.";
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "review", text, threadId });
          return;
        }
        case "plan": {
          const text = ((item.text as string) || "").replace(/<\/?proposed_plan>/g, "").trim();
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "plan", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "collabAgentToolCall": {
          const tool = (item.tool as string) || "spawnAgent";
          const receivers = (item.receiverThreadIds as string[]) || [];
          const prompt = (item.prompt as string) || "";
          const status = (item.status as string) || "completed";
          const lines = [`${tool}: ${receivers.join(", ") || "—"}`];
          if (prompt) lines.push(prompt);
          lines.push(`Status: ${status}`);
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "collab", text: lines.join("\n"), threadId });
          return;
        }
        case "contextCompaction": {
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "compaction", text: "Context compacted", threadId });
          return;
        }
        default:
          return;
      }
    }
  }

  #extractThreadId(params: Record<string, unknown>): string | null {
    return (params.threadId as string) || (params.thread_id as string) || null;
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
            const content = item.content as Array<{ type: string; text?: string }>;
            const text = content?.find((c) => c.type === "text")?.text || "";
            messages.push({ id, role: "user", text, threadId });
            break;
          }

          case "agentMessage": {
            const agentText = ((item.text as string) || "").replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/g, "").trim();
            if (agentText) {
              messages.push({
                id,
                role: "assistant",
                text: agentText,
                threadId,
              });
            }
            break;
          }

          case "reasoning": {
            const text = this.#extractReasoningSummary(this.#reasoningTextFromItem(item));
            if (text) messages.push({ id, role: "assistant", kind: "reasoning", text, threadId });
            break;
          }

          case "commandExecution": {
            const command = (item.command as string) || "";
            const output = (item.aggregatedOutput as string) || "";
            const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
            messages.push({
              id,
              role: "tool",
              kind: "command",
              text: command ? `$ ${command}\n${output}` : output,
              threadId,
              metadata: exitCode !== null ? { exitCode } : undefined,
            });
            break;
          }

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
              text: `Tool: ${item.tool}\n${JSON.stringify(item.error ?? item.result ?? "", null, 2)}`,
              threadId,
            });
            break;

          case "webSearch":
            messages.push({
              id,
              role: "tool",
              kind: "web",
              text: `Search: ${item.query}`,
              threadId,
            });
            break;

          case "imageView":
            messages.push({
              id,
              role: "tool",
              kind: "image",
              text: `Image: ${item.path ?? ""}`,
              threadId,
            });
            break;

          case "enteredReviewMode": {
            const review = (item.review as string) || "";
            messages.push({
              id,
              role: "tool",
              kind: "review",
              text: review ? `Review started: ${review}` : "Review started.",
              threadId,
            });
            break;
          }

          case "exitedReviewMode": {
            const review = (item.review as string) || "";
            messages.push({
              id,
              role: "tool",
              kind: "review",
              text: review || "Review complete.",
              threadId,
            });
            break;
          }

          case "plan": {
            const text = ((item.text as string) || "").replace(/<\/?proposed_plan>/g, "").trim();
            if (text) messages.push({ id, role: "tool", kind: "plan", text, threadId });
            break;
          }

          case "collabAgentToolCall": {
            const tool = (item.tool as string) || "spawnAgent";
            const receivers = (item.receiverThreadIds as string[]) || [];
            const prompt = (item.prompt as string) || "";
            const status = (item.status as string) || "completed";
            const lines = [`${tool}: ${receivers.join(", ") || "—"}`];
            if (prompt) lines.push(prompt);
            lines.push(`Status: ${status}`);
            messages.push({ id, role: "tool", kind: "collab", text: lines.join("\n"), threadId });
            break;
          }

          case "contextCompaction":
            messages.push({ id, role: "tool", kind: "compaction", text: "Context compacted", threadId });
            break;
        }
      }
    }

    // Mark plans as approved if a user message follows them
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].kind !== "plan") continue;
      const hasFollowUp = messages.slice(i + 1).some(
        (m) => m.role === "user" || (m.role === "assistant" && m.kind !== "reasoning"),
      );
      if (hasFollowUp) {
        messages[i] = { ...messages[i], planStatus: "approved" };
      }
    }

    // Preserve any pending approval or user-input messages that arrived
    // before the thread history loaded (e.g. replayed from orbit).
    // We read from #pendingLiveMessages (a plain Map, not a Svelte proxy)
    // to avoid timing issues with the reactive #byThread proxy.
    for (const [id, msg] of this.#pendingLiveMessages) {
      if (msg.threadId !== threadId) continue;
      if (!messages.some((m) => m.id === id)) {
        messages.push(msg);
      }
    }

    this.#byThread.set(threadId, messages);
    this.#byThread = new Map(this.#byThread);
  }
}

function getStore(): MessagesStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    const store = new MessagesStore();
    global[STORE_KEY] = store;
    socket.onMessage((msg) => store.handleMessage(msg));
  }
  return global[STORE_KEY] as MessagesStore;
}

export const messages = getStore();
