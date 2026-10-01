<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { theme } from "../lib/theme.svelte";
  import { config } from "../lib/config.svelte";
  import { connectionManager } from "../lib/connection-manager.svelte";
  import { socket } from "../lib/socket.svelte";
  import { account } from "../lib/account.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import NotificationSettings from "../lib/components/NotificationSettings.svelte";
  import { anchors } from "../lib/anchors.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  const anchorList = $derived(anchors.list);
  const accountInfo = $derived(account.info);
  const rateLimits = $derived(account.rateLimits);
  const accountError = $derived(account.error);
  const rateLimitEntries = $derived.by(() => {
    const entries = Object.entries(account.rateLimitsByLimitId ?? {});
    if (entries.length > 0) return entries;
    return rateLimits ? [[rateLimits.limitId ?? "default", rateLimits] as const] : [];
  });

  const resetOutcomes: Record<string, string> = {
    reset: "Limits reset.",
    nothingToReset: "Nothing to reset yet.",
    noCredit: "No reset credits left.",
    alreadyRedeemed: "That reset was already used.",
  };

  let confirmingReset = $state(false);
  let resetting = $state(false);
  let resetMessage = $state<string | null>(null);
  const availableCredits = $derived(Number(account.rateLimitResetCredits?.availableCount ?? 0));

  async function useReset() {
    resetting = true;
    try {
      const result = await account.consumeResetCredit();
      resetMessage = resetOutcomes[result.outcome] ?? result.outcome;
    } catch (err) {
      resetMessage = err instanceof Error ? err.message : "Reset failed.";
    } finally {
      resetting = false;
      confirmingReset = false;
    }
  }

  $effect(() => {
    if (socket.status === "connected") {
      void account.refresh();
    } else {
      account.clear();
    }
  });

  function formatTimestamp(seconds: number | null | undefined): string {
    if (!seconds) return "";
    return new Date(seconds * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDate(seconds: number): string {
    return new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatReset(seconds: number | null | undefined): string {
    const formatted = formatTimestamp(seconds);
    return formatted ? `resets ${formatted}` : "";
  }

  const platformLabels: Record<string, string> = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
  };

  const urlLocked = $derived(
    socket.status === "connected" || socket.status === "connecting" || socket.status === "reconnecting"
  );
  const canDisconnect = $derived(
    socket.status === "connected" || socket.status === "connecting" || socket.status === "reconnecting"
  );
  const canConnect = $derived(socket.status === "disconnected" || socket.status === "error");
  const isSocketConnected = $derived(socket.status === "connected");
  const connectionActionLabel = $derived.by(() => {
    if (socket.status === "connecting") return "Cancel";
    if (socket.status === "reconnecting") return "Stop reconnect";
    if (socket.status === "connected") return "Disconnect";
    return "Connect";
  });

  function formatSince(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

</script>

<div class="settings stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {themeIcons[theme.current]}
      </button>
    {/snippet}
  </AppHeader>

  <div class="content stack">
    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Connection</span>
      </div>
      <div class="section-body stack">
        {#if auth.canToggleLocalMode}
          <div class="field stack">
            <span class="field-label">mode</span>
            <div class="mode-toggle row">
              <button
                class="mode-btn {!auth.isLocalMode ? 'active' : ''}"
                type="button"
                onclick={() => {
                  if (!auth.isLocalMode) return;
                  connectionManager.requestDisconnect();
                  auth.disableLocalMode();
                }}
              >orbit</button>
              <button
                class="mode-btn {auth.isLocalMode ? 'active' : ''}"
                type="button"
                onclick={() => {
                  if (auth.isLocalMode) return;
                  connectionManager.requestDisconnect();
                  auth.enableLocalMode();
                }}
              >local</button>
            </div>
          </div>
        {/if}
        <div class="field stack">
          <label for="orbit-url">{auth.isLocalMode ? "anchor url" : "orbit url"}</label>
          <input
            id="orbit-url"
            type="text"
            bind:value={config.url}
            placeholder={auth.isLocalMode ? "ws://<anchor-ip>:8788/ws" : "wss://orbit.example.com/ws/client"}
            disabled={urlLocked}
          />
        </div>
        <div class="connect-actions row">
          <button
            class="connect-btn"
            type="button"
            onclick={() => {
              if (canDisconnect) {
                connectionManager.requestDisconnect();
              } else if (canConnect) {
                connectionManager.requestConnect();
              }
            }}
            disabled={!canDisconnect && !canConnect}
          >
            {connectionActionLabel}
          </button>
        </div>
        {#if socket.error}
          <p class="hint hint-error">{socket.error}</p>
        {/if}
        <p class="hint">
          {socket.status === "disconnected"
            ? "Auto-connect paused. Click Connect to resume."
            : "Connection is automatic on app load. Disconnect to pause and to change the URL."}
        </p>
      </div>
    </div>

    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Devices</span>
      </div>
      <div class="section-body stack">
        {#if auth.isLocalMode}
          <p class="hint {isSocketConnected ? 'hint-local' : ''}">
            {isSocketConnected
              ? "Direct Anchor connection active."
              : "Enter the Anchor URL above and click Connect."}
          </p>
        {:else if !isSocketConnected}
          <p class="hint">
            Connect to load devices.
          </p>
        {:else if anchorList.length === 0}
          <p class="hint">
            No devices connected. Run <code>zane start</code> in your terminal — a code will appear, then enter it at <a href="/device">/device</a> to authorise.
          </p>
        {:else}
          <ul class="anchor-list">
            {#each anchorList as anchor (anchor.id)}
              <li class="anchor-item">
                <span class="anchor-status" title="Connected">●</span>
                <div class="anchor-info">
                  <span class="anchor-hostname">{anchor.hostname}</span>
                  <span class="anchor-meta">{platformLabels[anchor.platform] ?? anchor.platform} · since {formatSince(anchor.connectedAt)}</span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <NotificationSettings />

    <div class="section stack">
      <div class="section-header split">
        <span class="section-title">Account</span>
        {#if !auth.isLocalMode}
          <button class="sign-out" type="button" onclick={() => auth.signOut()}>sign out</button>
        {/if}
      </div>
      <div class="section-body stack">
        {#if accountError}
          <p class="hint hint-error">{accountError}</p>
        {:else if accountInfo || rateLimits}
          <div class="account-info stack">
            {#if accountInfo}
              {#if accountInfo.type}
                <div class="account-row split">
                  <span class="account-label">type</span>
                  <span class="account-value">{accountInfo.type}</span>
                </div>
              {/if}
              {#if accountInfo.email}
                <div class="account-row split">
                  <span class="account-label">email</span>
                  <span class="account-value">{accountInfo.email}</span>
                </div>
              {/if}
              {#if accountInfo.name}
                <div class="account-row split">
                  <span class="account-label">name</span>
                  <span class="account-value">{accountInfo.name}</span>
                </div>
              {/if}
              {#if accountInfo.plan}
                <div class="account-row split">
                  <span class="account-label">plan</span>
                  <span class="account-value">{accountInfo.plan}</span>
                </div>
              {/if}
              {#if accountInfo.requiresOpenaiAuth && !accountInfo.type}
                <div class="account-row split">
                  <span class="account-label">provider auth</span>
                  <span class="account-value">OpenAI required</span>
                </div>
              {/if}
            {/if}

            {#if rateLimitEntries.length}
              <div class="rate-limits stack">
                <span class="field-label">rate limits</span>
                {#each rateLimitEntries as [limitId, limit]}
                  <div class="limit-group stack">
                    <div class="rate-limit-row split">
                      <span class="account-label">{limit.limitName || limitId}</span>
                      <span class="account-value">{limit.rateLimitReachedType || limit.planType || ""}</span>
                    </div>
                    {#if limit.primary}
                      <div class="rate-limit-row split">
                        <span class="account-label">{limit.primary.windowDurationMins ? `${limit.primary.windowDurationMins}m window` : "primary"}</span>
                        <span class="account-value">{limit.primary.usedPercent}% used{formatReset(limit.primary.resetsAt) ? ` · ${formatReset(limit.primary.resetsAt)}` : ""}</span>
                      </div>
                    {/if}
                    {#if limit.secondary}
                      <div class="rate-limit-row split">
                        <span class="account-label">{limit.secondary.windowDurationMins ? `${limit.secondary.windowDurationMins}m window` : "secondary"}</span>
                        <span class="account-value">{limit.secondary.usedPercent}% used{formatReset(limit.secondary.resetsAt) ? ` · ${formatReset(limit.secondary.resetsAt)}` : ""}</span>
                      </div>
                    {/if}
                    {#if limit.credits}
                      <div class="rate-limit-row split">
                        <span class="account-label">credits</span>
                        <span class="account-value">{limit.credits.unlimited ? "unlimited" : limit.credits.balance ?? (limit.credits.hasCredits ? "available" : "none")}</span>
                      </div>
                    {/if}
                    {#if limit.individualLimit}
                      <div class="rate-limit-row split">
                        <span class="account-label">spend control</span>
                        <span class="account-value">{limit.individualLimit.used} / {limit.individualLimit.limit} · {limit.individualLimit.remainingPercent}% left</span>
                      </div>
                    {/if}
                    {#if limit.spendControlReached}
                      <div class="rate-limit-row split">
                        <span class="account-label">status</span>
                        <span class="account-value warning-value">spend control reached</span>
                      </div>
                    {/if}
                  </div>
                {/each}
                {#if account.rateLimitResetCredits}
                  <div class="rate-limit-row split">
                    <span class="account-label">reset credits</span>
                    <span class="account-value">{availableCredits} available</span>
                  </div>
                  {#if account.rateLimitResetCredits.credits?.length}
                    {#each account.rateLimitResetCredits.credits as credit}
                      <div class="rate-limit-row split">
                        <span class="account-label">{credit.title || credit.resetType}</span>
                        <span class="account-value nowrap">{credit.expiresAt ? `expires ${formatDate(credit.expiresAt)}` : credit.status}</span>
                      </div>
                    {/each}
                  {/if}
                  {#if availableCredits > 0}
                    <div class="setting-row">
                      {#if confirmingReset}
                        <span class="setting-label">Use 1 of {availableCredits} credits?</span>
                        <div class="btn-group">
                          <button type="button" class="setting-btn warning-btn" disabled={resetting} onclick={useReset}>
                            {resetting ? "Resetting..." : "Reset"}
                          </button>
                          <button type="button" class="setting-btn" disabled={resetting} onclick={() => (confirmingReset = false)}>
                            Cancel
                          </button>
                        </div>
                      {:else}
                        <span class="setting-label">Reset usage limits</span>
                        <button type="button" class="setting-btn" onclick={() => (confirmingReset = true)}>Use</button>
                      {/if}
                    </div>
                  {/if}
                  {#if resetMessage}
                    <p class="hint">{resetMessage}</p>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        {:else if socket.status === "connected" || account.loading}
          <p class="hint">Loading account info...</p>
        {:else}
          <p class="hint">Connect to view account info.</p>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .settings {
    --stack-gap: 0;
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .content {
    --stack-gap: var(--space-lg);
    padding: var(--space-md);
    max-width: var(--app-max-width);
    margin: 0 auto;
    width: 100%;
  }

  .section {
    --stack-gap: 0;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .section-header {
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-bg-elevated);
    border-bottom: 1px solid var(--cli-border);
  }

  .section-title {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--cli-text-dim);
  }

  .section-body {
    --stack-gap: var(--space-md);
    padding: var(--space-md);
  }

  .field {
    --stack-gap: var(--space-xs);
  }

  .field label,
  .field-label {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    text-transform: lowercase;
  }

  .mode-toggle {
    gap: 0;
    width: fit-content;
  }

  .mode-btn {
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid var(--cli-border);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .mode-btn:first-child {
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }

  .mode-btn:last-child {
    border-left: none;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .mode-btn.active {
    background: var(--cli-bg-elevated);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .mode-btn:not(.active):hover {
    background: var(--cli-bg-hover);
    color: var(--cli-text);
  }

  .field input {
    padding: var(--space-sm);
    background: var(--cli-bg);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
  }

  .field input:focus {
    outline: none;
    border-color: var(--cli-prefix-agent);
  }

  .field input:disabled {
    opacity: 0.6;
    background: var(--cli-bg-elevated);
  }

  .connect-actions {
    align-items: center;
    gap: var(--space-sm);
  }

  .connect-btn {
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .connect-btn:hover:enabled {
    background: var(--cli-bg-hover);
    border-color: var(--cli-text-muted);
  }

  .connect-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .anchor-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .anchor-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    padding: var(--space-xs) 0;
  }

  .anchor-status {
    font-size: var(--text-xs);
    color: var(--cli-success, #4ade80);
    margin-top: 2px;
  }

  .anchor-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .anchor-hostname {
    color: var(--cli-text);
    font-weight: 500;
  }

  .anchor-meta {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }

  .hint {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
    margin: 0;
  }

  .hint-error {
    color: var(--cli-error);
  }

  .hint-local {
    color: var(--cli-success, #4ade80);
  }

  .hint code {
    color: var(--cli-text-dim);
    background: var(--cli-bg-elevated);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
  }

  .hint a {
    color: var(--cli-prefix-agent);
  }

  .account-info {
    --stack-gap: var(--space-xs);
  }

  .account-row,
  .rate-limit-row {
    --split-gap: var(--space-sm);
    font-size: var(--text-xs);
  }

  .account-label {
    color: var(--cli-text-dim);
  }

  .account-value {
    color: var(--cli-text);
    text-align: right;
  }

  .nowrap {
    white-space: nowrap;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding-top: var(--space-xs);
  }

  .setting-label {
    font-size: var(--text-xs);
    color: var(--cli-text);
  }

  .btn-group {
    display: flex;
    gap: var(--space-xs);
  }

  .setting-btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .setting-btn:hover:enabled {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .setting-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .warning-btn {
    border-color: var(--cli-warning);
    color: var(--cli-warning);
  }

  .warning-value {
    color: var(--cli-warning);
  }

  .rate-limits {
    --stack-gap: var(--space-xs);
  }

  .limit-group {
    --stack-gap: 2px;
    padding-top: var(--space-xs);
    border-top: 1px solid var(--cli-border);
  }

  .sign-out {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--cli-error);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .sign-out:hover {
    text-decoration: underline;
  }
</style>
