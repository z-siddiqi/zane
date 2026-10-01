<script lang="ts">
  import type { ThreadInfo } from "../types";
  import ShimmerDot from "./ShimmerDot.svelte";
  import Heading from "./Heading.svelte";

  interface Props {
    loading: boolean;
    recentThreads: ThreadInfo[];
  }

  const { loading, recentThreads }: Props = $props();

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
</script>

<section class="recent-sessions stack">
  <Heading title="Recent Sessions" href="/sessions" linkLabel="all" />

  <div class="content stack">
    {#if loading && recentThreads.length === 0}
      <div class="loading row">
        <ShimmerDot /> Loading sessions...
      </div>
    {:else if recentThreads.length === 0}
      <div class="empty row">No sessions yet. Start a task above.</div>
    {:else}
      <ul class="recent-list">
        {#each recentThreads as thread (thread.id)}
          <li>
            <a class="recent-item split" href="/thread/{thread.id}">
              <span class="recent-preview">{thread.preview || "New session"}</span>
              <span class="recent-time">{formatTime(thread.createdAt)}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .recent-sessions {
    --stack-gap: var(--space-sm);
  }

  .content {
    --stack-gap: var(--space-sm);
  }

  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .recent-item {
    --split-gap: var(--space-md);
    grid-template-columns: minmax(0, 1fr) auto;
    padding: var(--space-xs) 0;
    text-decoration: none;
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    transition: color var(--transition-fast);
  }

  .recent-item:hover {
    color: var(--cli-text);
  }

  .recent-preview {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .recent-time {
    color: var(--cli-text-muted);
    white-space: nowrap;
    font-size: var(--text-xs);
  }

  .loading,
  .empty {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }
</style>
