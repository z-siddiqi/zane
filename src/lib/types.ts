export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ThreadInfo {
  id: string;
  name?: string;
  preview?: string;
  createdAt?: number;
  modelProvider?: string;
  tokenUsage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ApprovalPolicy = "on-request" | "never";

export interface ModelOption {
  value: string;
  label: string;
  model?: string;
  upgrade?: string | null;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  inputModalities?: string[];
  supportsPersonality?: boolean;
  isDefault?: boolean;
}

export type ReasoningEffort = "low" | "medium" | "high";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ThreadSettings {
  model: string;
  reasoningEffort: ReasoningEffort;
  sandbox: SandboxMode;
  mode: ModeKind;
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
  | "approval-request"
  | "user-input-request"
  | "plan"
  | "collab"
  | "compaction"
  | "error"
  | "warning"
  | "diff";

export interface MessageMetadata {
  filePath?: string;
  exitCode?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface ApprovalRequest {
  id: string;
  rpcId: number | string; // The JSON-RPC request ID to respond to
  method: string;
  type: "command" | "file" | "permissions" | "mcp" | "elicitation" | "dynamic-tool" | "other";
  description: string;
  command?: string;
  cwd?: string;
  filePath?: string;
  grantRoot?: string;
  toolName?: string;
  reason?: string;
  requestedPermissions?: Record<string, unknown>;
  status: "pending" | "approved" | "declined" | "cancelled";
}

export type ThreadStatus = "NotLoaded" | "Idle" | "SystemError" | "Active";
export type ThreadActiveFlag = "WaitingOnApproval" | "WaitingOnUserInput";

export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: UserInputOption[];
}

export interface UserInputRequest {
  rpcId: number | string;
  questions: UserInputQuestion[];
  status: "pending" | "answered";
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
  userInputRequest?: UserInputRequest;
  planStatus?: "pending" | "approved";
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

// Plan step
export type PlanStepStatus = "Pending" | "InProgress" | "Completed";

export interface PlanStep {
  step: string;
  status: PlanStepStatus;
}

// Planning questions
export type PlanningQuestionType = "choice" | "multi" | "text" | "scale" | "confirm";

export interface PlanningQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface PlanningQuestion {
  id: string;
  type: PlanningQuestionType;
  question: string;
  options?: PlanningQuestionOption[];
  min?: number;
  max?: number;
  labels?: [string, string];
  placeholder?: string;
}

export interface PlanningAnswer {
  questionId: string;
  value: string | string[] | number | boolean;
}

export type PlanningPhase = "design" | "review" | "final";

export type ModeKind = "plan" | "code";

export interface CollaborationMode {
  mode: ModeKind;
  settings: {
    model: string;
    reasoning_effort?: ReasoningEffort;
    developer_instructions?: string;
  };
}

export interface CollaborationModeMask {
  name: string;
  mode?: ModeKind;
  model?: string;
  reasoning_effort?: ReasoningEffort | null;
  developer_instructions?: string | null;
}

export interface AccountInfo {
  email?: string;
  name?: string;
  plan?: string;
  id?: string;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

export interface RateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  planType?: string | null;
}

export interface RateLimitsResponse {
  rateLimits: RateLimitSnapshot;
}

export interface GitInspectResult {
  isGitRepo: boolean;
  repoRoot?: string;
  currentBranch?: string | null;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface GitWorktreeListResult {
  repoRoot: string;
  mainPath: string;
  worktrees: GitWorktree[];
}

export interface GitWorktreeCreateParams {
  repoRoot: string;
  baseRef?: string;
  branchName?: string;
  path?: string;
}

export interface GitWorktreeCreateResult {
  repoRoot: string;
  path: string;
  branch: string;
  head: string;
}

export interface McpServerStatus {
  name: string;
  status: "connected" | "connecting" | "disconnected" | "error";
  error?: string;
  tools?: string[];
}

export interface Skill {
  name: string;
  description?: string;
  source?: string;
}

export interface FuzzyFileResult {
  path: string;
  score?: number;
}
