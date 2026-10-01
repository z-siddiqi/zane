<script lang="ts">
  import { socket } from "../lib/socket.svelte";
  import { threads } from "../lib/threads.svelte";
  import { messages } from "../lib/messages.svelte";
  import { theme } from "../lib/theme.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import type { Message } from "../lib/types";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  const typeLabels: Record<string, string> = {
    command: "run command",
    file: "edit files",
    permissions: "permissions",
    mcp: "mcp tool",
    elicitation: "question",
    "dynamic-tool": "tool",
    other: "approval",
  };

  function threadName(threadId: string): string {
    const thread = threads.list.find((t) => t.id === threadId);
    return thread?.name || thread?.preview || threadId.slice(0, 8);
  }

  function requestLabel(message: Message): string {
    if (message.userInputRequest) return "question";
    return typeLabels[message.approval?.type ?? "other"] ?? "approval";
  }

  $effect(() => {
    if (socket.status === "connected" && threads.list.length === 0) {
      threads.fetch();
    }
  });
</script>

<svelte:head>
  <title>Zane · Inbox</title>
</svelte:head>

<div class="inbox stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <a href="/settings">Settings</a>
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {themeIcons[theme.current]}
      </button>
    {/snippet}
  </AppHeader>

  <main class="inbox-content stack">
    <span class="section-title">Waiting on you</span>

    {#if messages.pendingRequests.length === 0}
      <p class="empty">Nothing waiting. Approvals and questions from Codex show up here.</p>
    {:else}
      <ul class="request-list">
        {#each messages.pendingRequests as request (request.id)}
          <li>
            <a class="request stack" href="/thread/{request.threadId}">
              <span class="request-meta split">
                <span class="request-type">{requestLabel(request)}</span>
                <span class="request-thread">{threadName(request.threadId)}</span>
              </span>
              <span class="request-text">{request.approval?.command || request.text}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </main>
</div>

<style>
  .inbox {
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    --stack-gap: 0;
  }

  .inbox-content {
    width: 100%;
    max-width: var(--app-max-width);
    margin: 0 auto;
    padding: var(--space-lg) var(--space-md) var(--space-xl);
    --stack-gap: var(--space-sm);
  }

  .section-title {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .empty {
    margin: 0;
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }

  .request-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .request {
    --stack-gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    text-decoration: none;
    transition: background var(--transition-fast);
  }

  .request:hover {
    background: var(--cli-bg-hover);
  }

  .request-meta {
    --split-gap: var(--space-sm);
    grid-template-columns: auto minmax(0, 1fr);
    font-size: var(--text-xs);
  }

  .request-type {
    color: var(--cli-warning);
  }

  .request-thread {
    color: var(--cli-text-muted);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .request-text {
    font-size: var(--text-xs);
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
