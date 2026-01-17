<script lang="ts">
  import type { ConnectionStatus } from "../types";
  import ShimmerDot from "./ShimmerDot.svelte";

  interface Props {
    status: ConnectionStatus;
    threadId: string | null;
    model?: string;
  }

  let { status, threadId, model }: Props = $props();

  const statusConfig: Record<ConnectionStatus, { icon: string; color: string; label: string }> = {
    connected: { icon: "●", color: "var(--cli-success)", label: "connected" },
    connecting: { icon: "○", color: "var(--cli-text-dim)", label: "connecting" },
    disconnected: { icon: "○", color: "var(--cli-text-dim)", label: "disconnected" },
    error: { icon: "✗", color: "var(--cli-error)", label: "error" },
  };

  const config = $derived(statusConfig[status]);
</script>

<header class="session-header">
  <a href="/" class="brand">zane</a>
  <span class="separator">·</span>
  {#if status === "connecting"}
    <ShimmerDot color={config.color} />
  {:else}
    <span class="status-icon" style:color={config.color} title={config.label} aria-label={config.label}>
      {config.icon}
    </span>
  {/if}
  {#if threadId}
    <span class="separator">·</span>
    <span class="thread-id">{threadId.slice(0, 8)}</span>
  {/if}
  {#if model}
    <span class="separator">·</span>
    <span class="model">{model}</span>
  {/if}

  <div class="spacer"></div>

  {#if threadId}
    <a class="review-link" href={`/thread/${threadId}/review`}>review</a>
  {/if}
</header>

<style>
  .session-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-bg-elevated);
    border-bottom: 1px solid var(--cli-border);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--cli-text);
  }

  .brand {
    font-weight: 600;
    color: var(--cli-prefix-agent);
    text-decoration: none;
    transition: opacity var(--transition-fast);
  }

  .brand:hover {
    opacity: 0.8;
  }

  .separator {
    color: var(--cli-text-muted);
  }

  .status-icon {
    line-height: 1;
  }

  .thread-id {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
  }

  .model {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
  }

  .spacer {
    flex: 1;
  }

  .review-link {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
    text-transform: lowercase;
    transition: all var(--transition-fast);
  }

  .review-link:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

</style>
