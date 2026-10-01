<script lang="ts">
  import { socket } from "../lib/socket.svelte";
  import { threads } from "../lib/threads.svelte";
  import { theme } from "../lib/theme.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import ShimmerDot from "../lib/components/ShimmerDot.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

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

  $effect(() => {
    if (socket.status === "connected") {
      threads.fetch();
    }
  });

  function loadMoreWhenVisible(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) threads.fetchMore();
    }, { rootMargin: "100%" });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>

<svelte:head>
  <title>Zane · Sessions</title>
</svelte:head>

<div class="sessions stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <a href="/settings">Settings</a>
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {themeIcons[theme.current]}
      </button>
    {/snippet}
  </AppHeader>

  <main class="sessions-content stack">
    {#if threads.loading && threads.list.length === 0}
      <div class="loading row">
        <ShimmerDot /> Loading sessions...
      </div>
    {:else if threads.list.length === 0}
      <div class="empty row">No sessions yet. Start one from Home.</div>
    {:else}
      <ul class="session-list">
        {#each threads.list as thread (thread.id)}
          <li class="session-item row">
            <a class="session-link row" href="/thread/{thread.id}">
              <span class="session-icon">›</span>
              <span class="session-preview">{thread.preview || "New session"}</span>
              <span class="session-meta">{formatTime(thread.createdAt)}</span>
            </a>
            <button
              class="archive-btn"
              onclick={() => threads.archive(thread.id)}
              title="Archive session"
            >×</button>
          </li>
        {/each}
      </ul>
      {#if threads.nextCursor}
        {#key threads.list.length}
          <div class="loading row" use:loadMoreWhenVisible>
            <ShimmerDot /> Loading more...
          </div>
        {/key}
      {/if}
    {/if}
  </main>
</div>

<style>
  .sessions {
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    --stack-gap: 0;
  }

  .sessions-content {
    width: 100%;
    max-width: var(--app-max-width);
    margin: 0 auto;
    padding: var(--space-lg) var(--space-md) var(--space-xl);
    --stack-gap: var(--space-sm);
  }

  .session-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .session-item {
    --row-gap: 0;
    border-bottom: 1px solid var(--cli-border);
  }

  .session-item:last-child {
    border-bottom: none;
  }

  .session-link {
    flex: 1;
    min-width: 0;
    --row-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    text-decoration: none;
    color: inherit;
    background: transparent;
  }

  .session-link:hover {
    background: var(--cli-selection);
  }

  .session-icon {
    color: var(--cli-prefix-agent);
    font-weight: 600;
  }

  .session-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-meta {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
  }

  .archive-btn {
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-left: 1px solid var(--cli-border);
    background: transparent;
    color: var(--cli-text-muted);
    font-size: var(--text-base);
    cursor: pointer;
  }

  .archive-btn:hover {
    color: var(--cli-error);
    background: var(--cli-selection);
  }

  .loading,
  .empty {
    color: var(--cli-text-muted);
    padding: var(--space-md);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: var(--cli-bg-elevated);
  }
</style>
