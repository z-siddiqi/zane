import type {
  ApprovalRequest,
  CollaborationMode,
  Message,
  MessageKind,
  PlanStep,
  RpcMessage,
  TurnStatus,
  UserInputQuestion,
  UserInputRequest,
} from "./types";
import {
  appendItemDelta,
  completeItem,
  completeTurn,
  createThreadTranscript,
  hydrateTranscript,
  removeTranscriptMessage,
  restorePartialItem,
  startItem,
  startTurn,
  upsertTranscriptMessage,
  type ThreadTranscript,
  type ThreadTurnSnapshot,
} from "./thread-transcript";
import { codexTextInput } from "./codex-input";
import { socket } from "./socket.svelte";
import { threads } from "./threads.svelte";

const STORE_KEY = "__zane_messages_store__";

interface ThreadPresentation {
  plan: PlanStep[];
  planExplanation: string | null;
  statusDetail: string | null;
  reasoningItemId: string | null;
}

interface RawThreadTurn {
  id?: string;
  status?: string;
  items?: unknown[];
}

export interface PendingThreadRequest {
  count: number;
  threadId: string;
}

type TurnCompleteCallback = (threadId: string, finalText: string) => void;

class MessagesStore {
  #transcripts = $state<Map<string, ThreadTranscript>>(new Map());
  #presentation = $state<Map<string, ThreadPresentation>>(new Map());
  #interruptPending = new Set<string>();
  #execCommands = new Map<string, string>();
  #turnCompleteCallbacks = new Map<string, TurnCompleteCallback>();

  get current(): Message[] {
    return this.#transcript(threads.currentId)?.messages ?? [];
  }

  get turnStatus(): TurnStatus | null {
    return this.#transcript(threads.currentId)?.turnStatus ?? null;
  }

  get plan(): PlanStep[] {
    return this.#view(threads.currentId).plan;
  }

  get planExplanation(): string | null {
    return this.#view(threads.currentId).planExplanation;
  }

  get statusDetail(): string | null {
    return this.#view(threads.currentId).statusDetail;
  }

  get isReasoningStreaming(): boolean {
    return this.#view(threads.currentId).reasoningItemId !== null;
  }

  get streamingReasoningText(): string {
    const threadId = threads.currentId;
    const itemId = this.#view(threadId).reasoningItemId;
    if (!threadId || !itemId) return "";
    return this.#transcript(threadId)?.messages.find((message) => message.id === itemId)?.text ?? "";
  }

  get pendingThreadRequests(): PendingThreadRequest[] {
    const pending: PendingThreadRequest[] = [];
    for (const [threadId, transcript] of this.#transcripts) {
      const count = transcript.messages.filter((message) =>
        message.approval?.status === "pending" ||
        message.userInputRequest?.status === "pending").length;
      if (count > 0) pending.push({ threadId, count });
    }
    return pending;
  }

  getThreadMessages(threadId: string | null): Message[] {
    return this.#transcript(threadId)?.messages ?? [];
  }

  getLatestAssistantMessage(threadId: string | null): Message | null {
    const messages = this.getThreadMessages(threadId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant" && messages[index].kind !== "reasoning") {
        return messages[index];
      }
    }
    return null;
  }

  hydrateThread(threadId: string, turns: RawThreadTurn[]): void {
    const normalized: ThreadTurnSnapshot[] = turns.map((turn) => ({
      id: turn.id,
      status: turn.status,
      items: turn.items?.filter(isRecord),
    }));
    this.#setTranscript(threadId, hydrateTranscript(this.#ensureTranscript(threadId), normalized));
    if (this.#transcript(threadId)?.turnStatus !== "InProgress") {
      this.#interruptPending.delete(threadId);
      this.#setView(threadId, { reasoningItemId: null, statusDetail: null });
    }
  }

  clearThread(threadId: string): void {
    this.#setTranscript(threadId, createThreadTranscript(threadId));
    this.#presentation = new Map(this.#presentation).set(threadId, emptyPresentation());
    this.#interruptPending.delete(threadId);
  }

  steer(threadId: string, text: string): { success: boolean; error?: string } {
    const transcript = this.#transcript(threadId);
    if (!transcript?.activeTurnId || transcript.turnStatus !== "InProgress") {
      return { success: false, error: "No active turn to steer" };
    }
    return socket.send({
      method: "turn/steer",
      id: Date.now(),
      params: {
        threadId,
        input: [codexTextInput(text)],
        expectedTurnId: transcript.activeTurnId,
      },
    });
  }

  interrupt(threadId: string): { success: boolean; error?: string } {
    const transcript = this.#transcript(threadId);
    if (!transcript?.activeTurnId || transcript.turnStatus !== "InProgress") {
      return { success: true };
    }
    if (this.#interruptPending.has(threadId)) return { success: true };

    const result = socket.send({
      method: "turn/interrupt",
      id: Date.now(),
      params: { threadId, turnId: transcript.activeTurnId },
    });
    if (result.success) this.#interruptPending.add(threadId);
    return result;
  }

  onTurnComplete(threadId: string, callback: TurnCompleteCallback): () => void {
    this.#turnCompleteCallbacks.set(threadId, callback);
    return () => this.#turnCompleteCallbacks.delete(threadId);
  }

  approve(approvalId: string, forSession = false, _collaborationMode?: CollaborationMode): void {
    const found = this.#findApproval(approvalId);
    if (!found || found.approval.status !== "pending") return;
    const result = socket.send({
      id: found.approval.rpcId,
      result: approvalAcceptResult(found.approval, forSession),
    });
    if (result.success) this.#resolveRequest(found.threadId, found.messageId);
  }

  decline(approvalId: string, _collaborationMode?: CollaborationMode): void {
    const found = this.#findApproval(approvalId);
    if (!found || found.approval.status !== "pending") return;
    const result = socket.send({
      id: found.approval.rpcId,
      result: approvalRejectResult(found.approval, "decline"),
    });
    if (result.success) this.#resolveRequest(found.threadId, found.messageId);
  }

  cancel(approvalId: string): void {
    const found = this.#findApproval(approvalId);
    if (!found || found.approval.status !== "pending") return;
    const result = socket.send({
      id: found.approval.rpcId,
      result: approvalRejectResult(found.approval, "cancel"),
    });
    if (result.success) this.#resolveRequest(found.threadId, found.messageId);
  }

  respondToUserInput(
    messageId: string,
    answers: Record<string, string[]>,
    collaborationMode?: CollaborationMode,
  ): void {
    const threadId = threads.currentId;
    const message = this.#transcript(threadId)?.messages.find((candidate) => candidate.id === messageId);
    if (!threadId || message?.userInputRequest?.status !== "pending") return;

    const formattedAnswers: Record<string, { answers: string[] }> = {};
    for (const [questionId, selected] of Object.entries(answers)) {
      formattedAnswers[questionId] = { answers: selected };
    }
    const result = socket.send({
      id: message.userInputRequest.rpcId,
      result: { answers: formattedAnswers, ...(collaborationMode ? { collaborationMode } : {}) },
    });
    if (result.success) this.#resolveRequest(threadId, messageId);
  }

  approvePlan(messageId: string): void {
    const threadId = threads.currentId;
    if (!threadId) return;
    const transcript = this.#ensureTranscript(threadId);
    const message = transcript.messages.find((candidate) => candidate.id === messageId);
    if (!message) return;
    this.#setTranscript(threadId, upsertTranscriptMessage(transcript, { ...message, planStatus: "approved" }, message.turnId));
  }

  handleMessage(message: RpcMessage): void {
    if (this.#handleHostRequest(message)) return;

    if (message.result && !message.method) {
      const result = isRecord(message.result) ? message.result : null;
      const thread = isRecord(result?.thread) ? result.thread : null;
      if (typeof thread?.id === "string" && Array.isArray(thread.turns)) {
        this.hydrateThread(thread.id, thread.turns.filter(isRecord));
      }
      return;
    }

    const method = message.method;
    const params = isRecord(message.params) ? message.params : null;
    if (!method || !params) return;
    const threadId = extractThreadId(params);
    if (!threadId) return;
    const turnId = extractTurnId(params);

    if (method === "zane/thread/replay") {
      if (!turnId || !Array.isArray(params.items)) return;
      let transcript = startTurn(this.#ensureTranscript(threadId), turnId);
      for (const rawItem of params.items) {
        if (!isRecord(rawItem)) continue;
        const itemId = firstString(rawItem.itemId, rawItem.item_id);
        const role = rawItem.role;
        if (!itemId || (role !== "user" && role !== "assistant" && role !== "tool")) continue;
        const kind = typeof rawItem.kind === "string" ? rawItem.kind as MessageKind : undefined;
        transcript = restorePartialItem(transcript, {
          itemId,
          turnId,
          role,
          kind,
          text: stringValue(rawItem.text),
        });
        if (kind === "reasoning") this.#setView(threadId, { reasoningItemId: itemId });
      }
      this.#setTranscript(threadId, transcript);
      return;
    }

    if (method === "turn/started") {
      const turn = isRecord(params.turn) ? params.turn : null;
      if (typeof turn?.id !== "string") return;
      this.#setTranscript(threadId, startTurn(this.#ensureTranscript(threadId), turn.id, stringValue(turn.status)));
      this.#interruptPending.delete(threadId);
      this.#presentation = new Map(this.#presentation).set(threadId, emptyPresentation());
      return;
    }

    if (method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : null;
      this.#setTranscript(threadId, completeTurn(
        this.#ensureTranscript(threadId),
        typeof turn?.id === "string" ? turn.id : turnId,
        stringValue(turn?.status),
      ));
      this.#interruptPending.delete(threadId);
      this.#setView(threadId, { reasoningItemId: null, statusDetail: null });
      const callback = this.#turnCompleteCallbacks.get(threadId);
      if (callback) {
        callback(threadId, this.getLatestAssistantMessage(threadId)?.text ?? "");
        this.#turnCompleteCallbacks.delete(threadId);
      }
      return;
    }

    if (method === "item/started") {
      const item = isRecord(params.item) ? params.item : null;
      if (!item) return;
      this.#setTranscript(threadId, startItem(this.#ensureTranscript(threadId), turnId, item));
      if (item.type === "commandExecution" && typeof item.id === "string") {
        this.#execCommands.set(item.id, stringValue(item.command));
      }
      return;
    }

    if (method === "item/completed") {
      const item = isRecord(params.item) ? params.item : null;
      if (!item) return;
      this.#setTranscript(threadId, completeItem(this.#ensureTranscript(threadId), turnId, item));
      if (typeof item.id === "string") this.#execCommands.delete(item.id);
      if (item.type === "reasoning") this.#setView(threadId, { reasoningItemId: null });
      return;
    }

    if (method === "item/agentMessage/delta") {
      this.#appendDelta(threadId, turnId, params, "assistant");
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      this.#appendDelta(threadId, turnId, params, "tool", "command");
      return;
    }
    if (method === "item/fileChange/outputDelta") {
      this.#appendDelta(threadId, turnId, params, "tool", "file");
      return;
    }
    if (method === "item/mcpToolCall/progress") {
      this.#appendDelta(threadId, turnId, { ...params, delta: `${stringValue(params.message)}\n` }, "tool", "mcp");
      return;
    }
    if (method === "item/plan/delta") {
      this.#appendDelta(threadId, turnId, params, "tool", "plan");
      return;
    }
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      const itemId = itemIdFromParams(params, `reasoning-${turnId ?? threadId}`);
      this.#appendDelta(threadId, turnId, { ...params, itemId }, "assistant", "reasoning");
      this.#setView(threadId, { reasoningItemId: itemId });
      return;
    }

    if (method === "item/commandExecution/terminalInteraction") {
      this.#handleTerminalInteraction(threadId, params);
      return;
    }
    if (method === "turn/plan/updated") {
      const plan = Array.isArray(params.plan)
        ? params.plan.filter(isRecord).map((step) => ({
          step: stringValue(step.step),
          status: stringValue(step.status) as PlanStep["status"],
        }))
        : this.#view(threadId).plan;
      this.#setView(threadId, {
        plan,
        planExplanation: typeof params.explanation === "string"
          ? params.explanation
          : this.#view(threadId).planExplanation,
      });
      return;
    }
    if (method === "item/tool/requestUserInput" && message.id != null) {
      this.#addUserInputRequest(threadId, turnId, message.id, params);
      return;
    }
    if (method === "mcpServer/elicitation/request" && message.id != null) {
      this.#addApproval(threadId, turnId, message.id, method, params, "elicitation");
      return;
    }
    if (isApprovalMethod(method) && message.id != null) {
      this.#addApproval(threadId, turnId, message.id, method, params, approvalType(method));
      return;
    }
    if (method === "serverRequest/resolved" && params.requestId != null) {
      this.#resolveRequestByRpcId(threadId, params.requestId as string | number);
      return;
    }
    if (method === "error" || method === "deprecationNotice" || method === "configWarning" || method === "model/rerouted") {
      this.#addNotice(threadId, turnId, method, params);
      return;
    }
    if (method === "turn/diff/updated" && typeof params.diff === "string") {
      this.#upsert(threadId, {
        id: `diff-${threadId}-${turnId ?? "current"}`,
        role: "tool",
        kind: "diff",
        text: params.diff,
        threadId,
      }, turnId);
    }
  }

  #handleHostRequest(message: RpcMessage): boolean {
    if (message.method === "currentTime/read") {
      if (message.id != null) {
        socket.send({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1_000) } });
      }
      return true;
    }

    if (message.method === "account/chatgptAuthTokens/refresh" || message.method === "attestation/generate") {
      if (message.id != null) {
        socket.send({
          id: message.id,
          error: { code: -32000, message: `Zane cannot handle ${message.method} yet.` },
        });
      }
      return true;
    }

    if (message.method === "item/tool/call") {
      const params = isRecord(message.params) ? message.params : {};
      const threadId = extractThreadId(params);
      const description = `${stringValue(params.namespace) ? `${stringValue(params.namespace)}.` : ""}${stringValue(params.tool) || "dynamic tool"} is not available in Zane yet.`;
      if (threadId) {
        this.#upsert(threadId, {
          id: `dynamic-tool-${stringValue(params.callId) || String(message.id ?? Date.now())}`,
          role: "tool",
          kind: "mcp",
          text: description,
          threadId,
        });
      }
      if (message.id != null) {
        socket.send({ id: message.id, result: { success: false, contentItems: [{ type: "inputText", text: description }] } });
      }
      return true;
    }
    return false;
  }

  #appendDelta(
    threadId: string,
    turnId: string | null,
    params: Record<string, unknown>,
    role: "assistant" | "tool",
    kind?: MessageKind,
  ): void {
    const itemId = itemIdFromParams(params, `${kind ?? role}-${turnId ?? threadId}`);
    this.#setTranscript(threadId, appendItemDelta(this.#ensureTranscript(threadId), {
      itemId,
      turnId,
      delta: stringValue(params.delta),
      role,
      kind,
    }));
  }

  #handleTerminalInteraction(threadId: string, params: Record<string, unknown>): void {
    const itemId = itemIdFromParams(params, `terminal-${threadId}`);
    const stdin = stringValue(params.stdin).replace(/\r?\n$/, "");
    const waitId = `terminal-wait-${itemId}`;
    if (!stdin) {
      const command = this.#execCommands.get(itemId);
      this.#upsert(threadId, {
        id: waitId,
        role: "tool",
        kind: "wait",
        text: command ? `(waiting for ${command})` : "(waiting for command output)",
        threadId,
      });
      return;
    }
    this.#setTranscript(threadId, removeTranscriptMessage(this.#ensureTranscript(threadId), waitId));
    this.#setTranscript(threadId, appendItemDelta(this.#ensureTranscript(threadId), {
      itemId: `terminal-${itemId}`,
      turnId: extractTurnId(params),
      delta: `${stdin}\n`,
      role: "tool",
      kind: "terminal",
    }));
  }

  #addUserInputRequest(
    threadId: string,
    turnId: string | null,
    rpcId: string | number,
    params: Record<string, unknown>,
  ): void {
    const questions = Array.isArray(params.questions) ? params.questions as UserInputQuestion[] : [];
    const request: UserInputRequest = { rpcId, questions, status: "pending" };
    const id = `user-input-${stableRequestId("input", rpcId, params)}`;
    this.#upsert(threadId, {
      id,
      role: "assistant",
      kind: "user-input-request",
      text: questions.map((question) => question.question).join("\n"),
      threadId,
      userInputRequest: request,
    }, turnId);
  }

  #addApproval(
    threadId: string,
    turnId: string | null,
    rpcId: string | number,
    method: string,
    params: Record<string, unknown>,
    type: ApprovalRequest["type"],
  ): void {
    const id = stableRequestId("approval", rpcId, params);
    const request = isRecord(params.request) ? params.request : null;
    const rawCommand = params.command;
    const approval: ApprovalRequest = {
      id,
      rpcId,
      method,
      type,
      description: stringValue(params.reason) || stringValue(request?.message) || approvalDescription(type),
      command: Array.isArray(rawCommand) ? rawCommand.map(String).join(" ") : stringValue(rawCommand) || undefined,
      cwd: stringValue(params.cwd) || undefined,
      grantRoot: stringValue(params.grantRoot) || undefined,
      toolName: stringValue(params.serverName) || undefined,
      requestedPermissions: isRecord(params.permissions) ? params.permissions : undefined,
      status: "pending",
    };
    this.#upsert(threadId, {
      id: `approval-${id}`,
      role: "approval",
      kind: "approval-request",
      text: approval.description,
      threadId,
      approval,
    }, turnId);
  }

  #addNotice(
    threadId: string,
    turnId: string | null,
    method: string,
    params: Record<string, unknown>,
  ): void {
    let text = stringValue(params.message) || stringValue(params.summary) || stringValue(params.error);
    if (method === "deprecationNotice" && stringValue(params.details)) {
      text = `${text}\n${stringValue(params.details)}`;
    }
    if (method === "model/rerouted") {
      text = `Model changed from ${stringValue(params.fromModel)} to ${stringValue(params.toModel)}${stringValue(params.reason) ? `: ${stringValue(params.reason)}` : ""}`;
    }
    this.#upsert(threadId, {
      id: `${method}-${threadId}-${Date.now()}`,
      role: "tool",
      kind: method === "error" ? "error" : "warning",
      text: text || "Unknown error",
      threadId,
    }, turnId);
  }

  #resolveRequestByRpcId(threadId: string, rpcId: string | number): void {
    const transcript = this.#ensureTranscript(threadId);
    const message = transcript.messages.find((candidate) =>
      String(candidate.approval?.rpcId ?? candidate.userInputRequest?.rpcId ?? "") === String(rpcId));
    if (message) this.#resolveRequest(threadId, message.id);
  }

  #resolveRequest(threadId: string, messageId: string): void {
    this.#setTranscript(threadId, removeTranscriptMessage(this.#ensureTranscript(threadId), messageId));
  }

  #findApproval(approvalId: string): {
    threadId: string;
    messageId: string;
    approval: ApprovalRequest;
  } | null {
    for (const [threadId, transcript] of this.#transcripts) {
      const message = transcript.messages.find((candidate) => candidate.approval?.id === approvalId);
      if (message?.approval) return { threadId, messageId: message.id, approval: message.approval };
    }
    return null;
  }

  #upsert(threadId: string, message: Message, turnId?: string | null): void {
    this.#setTranscript(threadId, upsertTranscriptMessage(this.#ensureTranscript(threadId), message, turnId));
  }

  #transcript(threadId: string | null): ThreadTranscript | null {
    return threadId ? this.#transcripts.get(threadId) ?? null : null;
  }

  #ensureTranscript(threadId: string): ThreadTranscript {
    return this.#transcripts.get(threadId) ?? createThreadTranscript(threadId);
  }

  #setTranscript(threadId: string, transcript: ThreadTranscript): void {
    this.#transcripts = new Map(this.#transcripts).set(threadId, transcript);
  }

  #view(threadId: string | null): ThreadPresentation {
    return threadId ? this.#presentation.get(threadId) ?? emptyPresentation() : emptyPresentation();
  }

  #setView(threadId: string, update: Partial<ThreadPresentation>): void {
    this.#presentation = new Map(this.#presentation).set(threadId, { ...this.#view(threadId), ...update });
  }
}

function emptyPresentation(): ThreadPresentation {
  return { plan: [], planExplanation: null, statusDetail: null, reasoningItemId: null };
}

function extractThreadId(params: Record<string, unknown>): string | null {
  return firstString(params.threadId, params.thread_id, params.conversationId, params.conversation_id);
}

function extractTurnId(params: Record<string, unknown>): string | null {
  const turn = isRecord(params.turn) ? params.turn : null;
  return firstString(params.turnId, params.turn_id, turn?.id);
}

function itemIdFromParams(params: Record<string, unknown>, fallback: string): string {
  return firstString(params.itemId, params.item_id) ?? fallback;
}

function stableRequestId(prefix: string, rpcId: string | number, params: Record<string, unknown>): string {
  return firstString(params.approvalId, params.itemId, params.item_id, params.callId, params.call_id)
    ?? `${prefix}-${String(rpcId)}`;
}

function isApprovalMethod(method: string): boolean {
  return method.includes("/requestApproval") || method === "applyPatchApproval" || method === "execCommandApproval";
}

function approvalType(method: string): ApprovalRequest["type"] {
  if (method.includes("fileChange") || method === "applyPatchApproval") return "file";
  if (method.includes("commandExecution") || method === "execCommandApproval") return "command";
  if (method.includes("permissions")) return "permissions";
  if (method.includes("mcpToolCall")) return "mcp";
  return "other";
}

function approvalDescription(type: ApprovalRequest["type"]): string {
  switch (type) {
    case "file": return "File change requires approval";
    case "command": return "Command execution requires approval";
    case "permissions": return "Additional permissions required";
    case "mcp": return "MCP tool call requires approval";
    case "elicitation": return "MCP server requires input";
    default: return "Action requires approval";
  }
}

function approvalAcceptResult(approval: ApprovalRequest, forSession: boolean): Record<string, unknown> {
  if (approval.method === "item/permissions/requestApproval") {
    return {
      permissions: grantedPermissions(approval.requestedPermissions),
      scope: forSession ? "session" : "turn",
    };
  }
  if (approval.method === "mcpServer/elicitation/request") {
    return { action: "accept", content: {}, _meta: null };
  }
  if (approval.method === "applyPatchApproval" || approval.method === "execCommandApproval") {
    return { decision: forSession ? "approved_for_session" : "approved" };
  }
  return { decision: forSession ? "acceptForSession" : "accept" };
}

function approvalRejectResult(
  approval: ApprovalRequest,
  action: "decline" | "cancel",
): Record<string, unknown> {
  if (approval.method === "item/permissions/requestApproval") {
    return { permissions: {}, scope: "turn" };
  }
  if (approval.method === "mcpServer/elicitation/request") {
    return { action, content: null, _meta: null };
  }
  if (approval.method === "applyPatchApproval" || approval.method === "execCommandApproval") {
    return { decision: action === "cancel" ? "abort" : "denied" };
  }
  return { decision: action };
}

function grantedPermissions(requested: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!requested) return {};
  const granted: Record<string, unknown> = {};
  if (isRecord(requested.network)) granted.network = requested.network;
  const fileSystem = requested.fileSystem ?? requested.file_system;
  if (isRecord(fileSystem)) granted.fileSystem = fileSystem;
  return granted;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStore(): MessagesStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    const store = new MessagesStore();
    global[STORE_KEY] = store;
    socket.onMessage((message) => store.handleMessage(message));
  }
  return global[STORE_KEY] as MessagesStore;
}

export const messages = getStore();
