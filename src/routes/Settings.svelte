<script lang="ts">
  import type { AccountInfo, RateLimitSnapshot } from "../lib/types";
  import { auth } from "../lib/auth.svelte";
  import { theme } from "../lib/theme.svelte";
  import { config } from "../lib/config.svelte";
  import { connectionManager } from "../lib/connection-manager.svelte";
  import { socket } from "../lib/socket.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import NotificationSettings from "../lib/components/NotificationSettings.svelte";
  import { anchors } from "../lib/anchors.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  let accountInfo = $state<AccountInfo | null>(null);
  let rateLimits = $state<RateLimitSnapshot | null>(null);
  let accountError = $state<string | null>(null);

  const anchorList = $derived(anchors.list);

  $effect(() => {
    if (socket.status === "connected") {
      loadAccountInfo();
    } else {
      accountInfo = null;
      rateLimits = null;
      accountError = null;
    }
  });

  async function loadAccountInfo() {
    accountError = null;
    try {
      const [info, limits] = await Promise.allSettled([
        socket.accountRead(),
        socket.accountRateLimits(),
      ]);
      accountInfo = info.status === "fulfilled" ? info.value : null;
      rateLimits = limits.status === "fulfilled" ? limits.value.rateLimits : null;
    } catch {
      accountError = "Failed to load account info";
    }
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
      <div class="section-header">
        <span class="section-title">Account</span>
      </div>
      <div class="section-body stack">
        {#if accountError}
          <p class="hint hint-error">{accountError}</p>
        {:else if accountInfo || rateLimits}
          <div class="account-info stack">
            {#if accountInfo}
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
            {/if}

            {#if rateLimits}
              <div class="rate-limits stack">
                <span class="field-label">rate limits{rateLimits.limitName ? ` · ${rateLimits.limitName}` : ""}</span>
                {#if rateLimits.primary}
                  <div class="rate-limit-row split">
                    <span class="account-label">{rateLimits.primary.windowDurationMins ? `${rateLimits.primary.windowDurationMins}m window` : "primary"}</span>
                    <span class="account-value">{rateLimits.primary.usedPercent}% used</span>
                  </div>
                {/if}
                {#if rateLimits.secondary}
                  <div class="rate-limit-row split">
                    <span class="account-label">{rateLimits.secondary.windowDurationMins ? `${rateLimits.secondary.windowDurationMins}m window` : "secondary"}</span>
                    <span class="account-value">{rateLimits.secondary.usedPercent}% used</span>
                  </div>
                {/if}
                {#if rateLimits.planType}
                  <div class="rate-limit-row split">
                    <span class="account-label">plan tier</span>
                    <span class="account-value">{rateLimits.planType}</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if socket.status === "connected"}
          <p class="hint">Loading account info...</p>
        {:else}
          <p class="hint">Connect to view account info.</p>
        {/if}

        {#if !auth.isLocalMode}
          <button class="sign-out-btn" type="button" onclick={() => auth.signOut()}>Sign out</button>
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

  .rate-limits {
    --stack-gap: var(--space-xs);
  }

  .sign-out-btn {
    align-self: flex-start;
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-error, #ef4444);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .sign-out-btn:hover {
    background: var(--cli-error-bg);
    border-color: var(--cli-error, #ef4444);
  }
</style>
