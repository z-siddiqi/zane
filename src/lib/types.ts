export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ThreadInfo {
  id: string;
  preview?: string;
  createdAt?: number;
  modelProvider?: string;
}

export type MessageRole = "user" | "assistant" | "tool" | "approval";
export type MessageKind =
  | "reasoning"
  | "command"
  | "file"
  | "mcp"
  | "web"
  | "review"
  | "image"
  | "terminal"
  | "wait"
  | "approval-request";

export interface MessageMetadata {
  filePath?: string;
  exitCode?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

// Approval decision types per Codex protocol (lowercase!)
export type CommandApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "acceptWithExecpolicyAmendment"
  | "decline"
  | "cancel";

export type FileApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface ApprovalRequest {
  id: string;
  rpcId: number; // The JSON-RPC request ID to respond to
  type: "command" | "file" | "mcp" | "other";
  description: string;
  command?: string;
  filePath?: string;
  toolName?: string;
  reason?: string;
  status: "pending" | "approved" | "declined" | "cancelled";
}

export interface Message {
  id: string;
  role: MessageRole;
  kind?: MessageKind;
  text: string;
  threadId: string;
  language?: string;
  metadata?: MessageMetadata;
  approval?: ApprovalRequest;
}

// JSON-RPC style message envelope
export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

// Turn status
export type TurnStatus = "InProgress" | "Completed" | "Interrupted" | "Failed";

export interface Turn {
  id: string;
  threadId: string;
  status: TurnStatus;
}

// Plan step
export type PlanStepStatus = "Pending" | "InProgress" | "Completed";

export interface PlanStep {
  step: string;
  status: PlanStepStatus;
}

export interface TurnPlan {
  turnId: string;
  explanation?: string;
  steps: PlanStep[];
}
