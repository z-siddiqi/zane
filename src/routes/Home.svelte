<script lang="ts">
  import { socket } from "../lib/socket.svelte";
  import { threads } from "../lib/threads.svelte";
  import { config } from "../lib/config.svelte";
  import { theme, type Theme } from "../lib/theme.svelte";
  import ShimmerDot from "../lib/components/ShimmerDot.svelte";
  import "../lib/styles/tokens.css";

  let newThreadDir = $state("");

  function handleConnect() {
    if (socket.status === "connected") {
      socket.disconnect();
      threads.list = [];
    } else {
      socket.connect(config.url, config.token);
    }
  }

  function handleNewThread() {
    if (newThreadDir.trim()) {
      threads.start(newThreadDir.trim());
    }
  }

  function formatTime(ts?: number): string {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const themeIcons: Record<Theme, string> = {
    system: "◐",
    light: "○",
    dark: "●",
  };

  $effect(() => {
    if (socket.status === "connected") {
      threads.fetch();
    }
  });
</script>

<div class="home">
  <header class="header">
    <span class="brand">zane</span>
    <span class="separator">·</span>
    {#if socket.status === "connecting"}
      <ShimmerDot color="var(--cli-text-dim)" />
    {:else}
      <span
        class="status-icon"
        class:connected={socket.status === "connected"}
        class:error={socket.status === "error"}
      >
        {socket.status === "connected" ? "●" : socket.status === "error" ? "✗" : "○"}
      </span>
    {/if}
    <span class="status-label" class:connected={socket.status === "connected"}>
      {socket.status}
    </span>

    <div class="spacer"></div>

    <button
      type="button"
      class="theme-toggle"
      onclick={() => theme.cycle()}
      title="Theme: {theme.current}"
    >
      {themeIcons[theme.current]}
    </button>
  </header>

  <div class="connection">
    <div class="field">
      <label for="url">url</label>
      <input
        id="url"
        type="text"
        bind:value={config.url}
        placeholder="ws://localhost:8788/ws"
        disabled={socket.status === "connected"}
      />
    </div>
    <div class="field">
      <label for="token">token</label>
      <input
        id="token"
        type="password"
        bind:value={config.token}
        placeholder="(optional)"
        disabled={socket.status === "connected"}
      />
    </div>
    <button class="connect-btn" onclick={handleConnect}>
      {socket.status === "connected" ? "Disconnect" : "Connect"}
    </button>
  </div>

  {#if socket.error}
    <div class="error">
      <span class="error-icon">✗</span>
      <span class="error-text">{socket.error}</span>
    </div>
  {/if}

  {#if socket.status === "connected"}
    <div class="threads-section">
      <div class="section-header">
        <span class="section-title">Threads</span>
        <button class="refresh-btn" onclick={() => threads.fetch()} title="Refresh">↻</button>
      </div>

      <div class="new-thread">
        <span class="prompt">&gt;</span>
        <input
          type="text"
          bind:value={newThreadDir}
          placeholder="Working directory path..."
          onkeydown={(e) => e.key === "Enter" && handleNewThread()}
        />
        <button class="new-btn" onclick={handleNewThread} disabled={!newThreadDir.trim()}>
          New
        </button>
      </div>

      {#if threads.loading}
        <div class="loading">
          <ShimmerDot /> Loading threads...
        </div>
      {:else if threads.list.length === 0}
        <div class="empty">No threads yet. Create one above.</div>
      {:else}
        <ul class="thread-list">
          {#each threads.list as thread (thread.id)}
            <li class="thread-item">
              <a class="thread-link" href="/thread/{thread.id}">
                <span class="thread-icon">›</span>
                <span class="thread-preview">{thread.preview || "New thread"}</span>
                <span class="thread-meta">{formatTime(thread.createdAt)}</span>
              </a>
              <button
                class="archive-btn"
                onclick={() => threads.archive(thread.id)}
                title="Archive thread"
              >×</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    overflow: hidden;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-bg-elevated);
    border-bottom: 1px solid var(--cli-border);
  }

  .brand {
    font-weight: 600;
    color: var(--cli-prefix-agent);
  }

  .separator {
    color: var(--cli-text-muted);
  }

  .status-icon {
    color: var(--cli-text-muted);
  }

  .status-icon.connected {
    color: var(--cli-success);
  }

  .status-icon.error {
    color: var(--cli-error);
  }

  .status-label {
    font-size: var(--text-xs);
    color: var(--cli-text-dim);
  }

  .status-label.connected {
    color: var(--cli-success);
  }

  .spacer {
    flex: 1;
  }

  .theme-toggle {
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .theme-toggle:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
  }

  /* Connection */
  .connection {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    border-bottom: 1px solid var(--cli-border);
  }

  .field {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .field label {
    width: 50px;
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
  }

  .field input {
    flex: 1;
        padding: var(--space-sm);
    background: var(--cli-bg);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .field input:focus {
    outline: none;
    border-color: var(--cli-prefix-agent);
  }

  .field input:disabled {
    opacity: 0.5;
    background: var(--cli-bg-elevated);
  }

  .field input::placeholder {
    color: var(--cli-text-muted);
  }

  .connect-btn {
    align-self: flex-start;
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-prefix-agent);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-bg);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }

  .connect-btn:hover {
    opacity: 0.9;
  }

  /* Error */
  .error {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: rgba(248, 113, 113, 0.1);
    border-bottom: 1px solid var(--cli-border);
    color: var(--cli-error);
  }

  .error-icon {
    font-weight: 600;
  }

  /* Threads Section */
  .threads-section {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--cli-border);
  }

  .section-title {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .refresh-btn {
    padding: var(--space-xs);
    background: transparent;
    border: none;
    color: var(--cli-text-muted);
    font-size: var(--text-base);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .refresh-btn:hover {
    color: var(--cli-text);
  }

  /* New Thread */
  .new-thread {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-bg-elevated);
    border-bottom: 1px solid var(--cli-border);
  }

  .prompt {
    color: var(--cli-prefix-agent);
    font-weight: 600;
  }

  .new-thread input {
    flex: 1;
        padding: var(--space-sm);
    background: transparent;
    border: none;
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .new-thread input:focus {
    outline: none;
  }

  .new-thread input::placeholder {
    color: var(--cli-text-muted);
  }

  .new-btn {
    padding: var(--space-xs) var(--space-sm);
    background: var(--cli-prefix-agent);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-bg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }

  .new-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .new-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Loading / Empty */
  .loading, .empty {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-lg) var(--space-md);
    color: var(--cli-text-muted);
  }

  /* Thread List */
  .thread-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow-y: auto;
  }

  .thread-item {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--cli-border);
  }

  .thread-link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    text-decoration: none;
    color: inherit;
    transition: background var(--transition-fast);
  }

  .thread-link:hover {
    background: var(--cli-selection);
  }

  .thread-icon {
    color: var(--cli-prefix-agent);
    font-weight: 600;
  }

  .thread-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--cli-text);
  }

  .thread-meta {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
  }

  .archive-btn {
    padding: var(--space-sm);
    background: transparent;
    border: none;
    color: var(--cli-text-muted);
    font-size: var(--text-base);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .archive-btn:hover {
    color: var(--cli-error);
  }
</style>
