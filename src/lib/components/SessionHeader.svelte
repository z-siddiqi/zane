<script lang="ts">
  import type { ConnectionStatus, SandboxMode } from "../types";
  import { theme, type Theme } from "../theme.svelte";
  import { auth } from "../auth.svelte";
  import ShimmerDot from "./ShimmerDot.svelte";

  interface Props {
    status: ConnectionStatus;
    threadId: string | null;
    sandbox?: SandboxMode;
    onSandboxChange?: (sandbox: SandboxMode) => void;
  }

  let { status, threadId, sandbox, onSandboxChange }: Props = $props();

  let sandboxOpen = $state(false);

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

  const sandboxOptions: { value: SandboxMode; label: string; icon: string }[] = [
    { value: "read-only", label: "Read Only", icon: "◎" },
    { value: "workspace-write", label: "Workspace", icon: "◉" },
    { value: "danger-full-access", label: "Full Access", icon: "⬤" },
  ];

  const config = $derived(statusConfig[status]);
  const selectedSandbox = $derived(
    sandboxOptions.find((s) => s.value === sandbox) || sandboxOptions[1]
  );

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".sandbox-dropdown")) {
      sandboxOpen = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<header class="session-header">
  <div class="session-header-inner">
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

      {#if sandbox && onSandboxChange}
        <span class="separator">·</span>
        <div class="sandbox-dropdown" class:open={sandboxOpen}>
          <button
            type="button"
            class="sandbox-btn"
            class:danger={sandbox === "danger-full-access"}
            onclick={(e) => {
              e.stopPropagation();
              sandboxOpen = !sandboxOpen;
            }}
          >
            <svg class="shield-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
            </svg>
            <span class="sandbox-label">{selectedSandbox.label}</span>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          {#if sandboxOpen}
            <div class="sandbox-menu">
              {#each sandboxOptions as option}
                <button
                  type="button"
                  class="sandbox-item"
                  class:selected={sandbox === option.value}
                  class:danger={option.value === "danger-full-access"}
                  onclick={() => {
                    onSandboxChange(option.value);
                    sandboxOpen = false;
                  }}
                >
                  <span>{option.label}</span>
                  {#if sandbox === option.value}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    <div class="spacer"></div>

    {#if threadId}
      <a class="header-btn" href={`/thread/${threadId}/review`}>review</a>
    {/if}
    <button
      type="button"
      class="header-btn"
      onclick={() => theme.cycle()}
      title="Theme: {theme.current}"
    >
      {themeIcons[theme.current]}
    </button>
    <button
      type="button"
      class="header-btn"
      onclick={() => auth.signOut()}
      title="Sign out"
    >
      ⏻
    </button>
  </div>
</header>

<style>
  .session-header {
    width: 100vw;
    margin-left: calc(50% - 50vw);
    background: var(--cli-bg-elevated);
    border-bottom: 1px solid var(--cli-border);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--cli-text);
  }


  .session-header-inner {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    max-width: var(--app-max-width);
    margin: 0 auto;
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

  .spacer {
    flex: 1;
  }

  /* Sandbox dropdown */
  .sandbox-dropdown {
    position: relative;
  }

  .sandbox-btn {
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

  .sandbox-btn .sandbox-label {
    display: none;
  }

  .sandbox-btn .chevron {
    display: none;
  }

  @media (min-width: 640px) {
    .sandbox-btn .sandbox-label {
      display: inline;
    }

    .sandbox-btn .chevron {
      display: block;
    }
  }

  .sandbox-btn:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .sandbox-btn.danger {
    color: var(--cli-error);
    border-color: var(--cli-error);
  }

  .sandbox-btn.danger:hover {
    background: rgba(255, 100, 100, 0.1);
  }

  .shield-icon {
    width: 0.875rem;
    height: 0.875rem;
  }

  .sandbox-btn .chevron {
    width: 0.625rem;
    height: 0.625rem;
    opacity: 0.5;
    flex-shrink: 0;
  }

  .sandbox-menu {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 140px;
    margin-top: var(--space-xs);
    padding: var(--space-xs);
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100;
    animation: fadeIn 0.1s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .sandbox-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-sm);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .sandbox-item:hover {
    background: var(--cli-bg-hover);
  }

  .sandbox-item.selected {
    color: var(--cli-prefix-agent);
  }

  .sandbox-item.danger {
    color: var(--cli-error);
  }

  .sandbox-item svg {
    width: 0.875rem;
    height: 0.875rem;
  }

  .header-btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .header-btn:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }
</style>
