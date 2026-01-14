<script lang="ts">
  import type { ConnectionStatus } from "../types";
  import { theme, type Theme } from "../theme.svelte";
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

  const themeIcons: Record<Theme, string> = {
    system: "◐",
    light: "○",
    dark: "●",
  };

  const themeLabels: Record<Theme, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  };

  const config = $derived(statusConfig[status]);
</script>

<header class="session-header">
  <a href="/" class="brand">zane</a>
  <span class="separator">·</span>
  {#if status === "connecting"}
    <ShimmerDot color={config.color} />
  {:else}
    <span class="status-icon" style:color={config.color}>{config.icon}</span>
  {/if}
  <span class="status-label" style:color={config.color}>{config.label}</span>
  {#if threadId}
    <span class="separator">·</span>
    <span class="thread-id">{threadId.slice(0, 8)}</span>
  {/if}
  {#if model}
    <span class="separator">·</span>
    <span class="model">{model}</span>
  {/if}

  <div class="spacer"></div>

  <button
    type="button"
    class="theme-toggle"
    onclick={() => theme.cycle()}
    title="Theme: {themeLabels[theme.current]} (click to cycle)"
  >
    <span class="theme-icon">{themeIcons[theme.current]}</span>
    <span class="theme-label">{themeLabels[theme.current]}</span>
  </button>
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

  .status-label {
    font-size: var(--text-xs);
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

  .theme-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .theme-toggle:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .theme-icon {
    font-size: var(--text-sm);
  }

  .theme-label {
    text-transform: lowercase;
  }
</style>
