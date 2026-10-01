<script module lang="ts">
  const tabs = [
    { path: "/app", label: "new", icon: "M12 5v14M5 12h14" },
    {
      path: "/inbox",
      label: "inbox",
      icon: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    },
    { path: "/sessions", label: "sessions", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
    {
      path: "/settings",
      label: "settings",
      icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    },
  ];

  export function isTabRoute(pathname: string): boolean {
    return tabs.some((tab) => tab.path === pathname);
  }
</script>

<script lang="ts">
  import { route } from "../../router";
  import { messages } from "../messages.svelte";

  const pendingCount = $derived(messages.pendingRequests.length);
</script>

<nav class="bottom-nav">
  {#each tabs as tab (tab.path)}
    <a href={tab.path} class="tab" class:active={route.pathname === tab.path}>
      <span class="icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d={tab.icon} />
        </svg>
        {#if tab.path === "/inbox" && pendingCount > 0}
          <span class="badge">{pendingCount}</span>
        {/if}
      </span>
      <span>{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--cli-bg-elevated);
    border-top: 1px solid var(--cli-border);
  }

  @media (min-width: 640px) {
    .bottom-nav {
      display: none;
    }
  }

  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--space-sm) 0;
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
    transition: color var(--transition-fast);
  }

  .tab.active {
    color: var(--cli-prefix-agent);
  }

  .icon {
    position: relative;
    display: flex;
  }

  .icon svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  .badge {
    position: absolute;
    top: -0.375rem;
    right: -0.625rem;
    min-width: 1rem;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--cli-warning);
    color: var(--cli-bg);
    font-size: 10px;
    font-weight: 600;
    line-height: 1rem;
    text-align: center;
  }
</style>
