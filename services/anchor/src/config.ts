import type { WsClient } from "./types";

export const PORT = Number(process.env.ANCHOR_PORT ?? 8788);
export const ORBIT_URL = process.env.ANCHOR_ORBIT_URL ?? "";
export const ANCHOR_JWT_TTL_SEC = Number(process.env.ANCHOR_JWT_TTL_SEC ?? 300);
export const AUTH_URL = process.env.AUTH_URL ?? "";
export const FORCE_LOGIN = process.env.ZANE_FORCE_LOGIN === "1";
export const CREDENTIALS_FILE = process.env.ZANE_CREDENTIALS_FILE ?? "";
export const startedAt = Date.now();

export const MAX_SUBSCRIBED_THREADS = 1000;

export const APPROVAL_METHODS = new Set([
  "item/fileChange/requestApproval",
  "item/commandExecution/requestApproval",
  "item/permissions/requestApproval",
  "item/mcpToolCall/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
]);

export let jwtSecret = "";
export let userId: string | undefined;

export function setJwtSecret(s: string): void {
  jwtSecret = s;
}
export function setUserId(id: string | undefined): void {
  userId = id;
}

export const clients = new Set<WsClient>();
export const subscribedThreads = new Set<string>();
export const pendingApprovals = new Map<string, string>();
export const pendingUserMessages = new Map<string, string>();
export const approvalRpcIds = new Map<number | string, string>();

export let appServer: Bun.Subprocess | null = null;
export let appServerStarting = false;
export let appServerInitialized = false;
export let appServerInitializeId: number | null = null;
export let warnedNoAppServer = false;

export function setAppServer(proc: Bun.Subprocess | null): void {
  appServer = proc;
}
export function setAppServerStarting(v: boolean): void {
  appServerStarting = v;
}
export function setAppServerInitialized(v: boolean): void {
  appServerInitialized = v;
}
export function setAppServerInitializeId(v: number | null): void {
  appServerInitializeId = v;
}
export function setWarnedNoAppServer(v: boolean): void {
  warnedNoAppServer = v;
}

export let orbitSocket: WebSocket | null = null;
export let orbitConnecting = false;
export let orbitHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
export let orbitHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

export function setOrbitSocket(ws: WebSocket | null): void {
  orbitSocket = ws;
}
export function setOrbitConnecting(v: boolean): void {
  orbitConnecting = v;
}
export function setOrbitHeartbeatInterval(v: ReturnType<typeof setInterval> | null): void {
  orbitHeartbeatInterval = v;
}
export function setOrbitHeartbeatTimeout(v: ReturnType<typeof setTimeout> | null): void {
  orbitHeartbeatTimeout = v;
}
