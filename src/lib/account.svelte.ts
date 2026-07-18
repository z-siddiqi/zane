import type {
  AccountInfo,
  AccountPayload,
  AccountReadResponse,
  RateLimitSnapshot,
  RateLimitResetCreditConsumeResponse,
  RateLimitResetCreditsSummary,
  RateLimitsResponse,
  RpcMessage,
} from "./types";
import { socket } from "./socket.svelte";

const STORE_KEY = "__zane_account_store__";

function mergeAccountInfo(base: AccountInfo | null, update: Partial<AccountInfo>): AccountInfo {
  return { ...base, ...update };
}

function mergeWindow(
  current: RateLimitSnapshot["primary"],
  incoming: RateLimitSnapshot["primary"],
): RateLimitSnapshot["primary"] {
  if (!incoming) return current ?? null;
  return { ...current, ...incoming };
}

function mergeSparseRateLimit(
  current: RateLimitSnapshot | null | undefined,
  incoming: RateLimitSnapshot,
): RateLimitSnapshot {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(incoming).filter(([, value]) => value !== null && value !== undefined),
    ),
    primary: mergeWindow(current?.primary, incoming.primary),
    secondary: mergeWindow(current?.secondary, incoming.secondary),
  };
}

function accountLabel(type: string | undefined): string {
  if (type === "chatgpt") return "ChatGPT";
  if (type === "apiKey") return "API key";
  if (type === "amazonBedrock") return "Amazon Bedrock";
  return type || "account";
}

class AccountStore {
  info = $state<AccountInfo | null>(null);
  rateLimits = $state<RateLimitSnapshot | null>(null);
  rateLimitsByLimitId = $state<Record<string, RateLimitSnapshot> | null>(null);
  rateLimitResetCredits = $state<RateLimitResetCreditsSummary | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  #refreshing = false;

  constructor() {
    socket.onMessage((msg) => this.handleMessage(msg));
    socket.onConnect(() => {
      void this.refresh();
    });
  }

  async refresh() {
    if (this.#refreshing) return;
    if (socket.status !== "connected") {
      this.clear();
      return;
    }

    this.#refreshing = true;
    this.loading = true;
    this.error = null;

    try {
      const [accountResult, limitsResult] = await Promise.allSettled([
        socket.accountRead(),
        socket.accountRateLimits(),
      ]);

      if (accountResult.status === "fulfilled") {
        this.info = this.#normalizeAccount(accountResult.value);
      }
      if (limitsResult.status === "fulfilled") {
        this.#applyRateLimits(limitsResult.value);
      }
      if (accountResult.status === "rejected" && limitsResult.status === "rejected") {
        this.error = "Failed to load account info";
      }
    } finally {
      this.loading = false;
      this.#refreshing = false;
    }
  }

  clear() {
    this.info = null;
    this.rateLimits = null;
    this.rateLimitsByLimitId = null;
    this.rateLimitResetCredits = null;
    this.loading = false;
    this.error = null;
  }

  async consumeResetCredit(creditId?: string | null): Promise<RateLimitResetCreditConsumeResponse> {
    const result = await socket.accountRateLimitResetCreditConsume(creditId);
    await this.refresh();
    return result;
  }

  handleMessage(msg: RpcMessage) {
    if (msg.method === "account/updated") {
      const params = msg.params ?? {};
      this.info = mergeAccountInfo(this.info, {
        authMode: (params.authMode as string | null | undefined) ?? this.info?.authMode ?? null,
        planType: (params.planType as string | null | undefined) ?? this.info?.planType ?? null,
        plan: (params.planType as string | null | undefined) ?? this.info?.plan,
      });
      void this.refresh();
      return;
    }

    if (msg.method === "account/rateLimits/updated") {
      const params = msg.params as { rateLimits?: RateLimitSnapshot } | undefined;
      if (!params?.rateLimits) return;
      const incoming = params.rateLimits;
      this.rateLimits = mergeSparseRateLimit(this.rateLimits, incoming);
      const limitId = incoming.limitId ?? this.rateLimits.limitId;
      if (limitId) {
        this.rateLimitsByLimitId = {
          ...this.rateLimitsByLimitId,
          [limitId]: mergeSparseRateLimit(this.rateLimitsByLimitId?.[limitId], incoming),
        };
      }
    }
  }

  #applyRateLimits(response: RateLimitsResponse) {
    this.rateLimits = response.rateLimits;
    this.rateLimitsByLimitId = response.rateLimitsByLimitId ?? null;
    this.rateLimitResetCredits = response.rateLimitResetCredits ?? null;
  }

  #normalizeAccount(response: AccountReadResponse): AccountInfo | null {
    const raw = response.account;
    if (!raw) {
      return response.requiresOpenaiAuth ? { requiresOpenaiAuth: true, plan: "account details unavailable" } : null;
    }

    const account = raw as AccountPayload & AccountInfo;
    const type = account.type;
    return {
      type,
      email: account.email ?? undefined,
      name: account.name ?? undefined,
      plan: account.plan ?? account.planType ?? accountLabel(type),
      planType: account.planType ?? null,
      requiresOpenaiAuth: response.requiresOpenaiAuth ?? account.requiresOpenaiAuth,
    };
  }
}

function getStore(): AccountStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new AccountStore();
  }
  return global[STORE_KEY] as AccountStore;
}

export const account = getStore();
