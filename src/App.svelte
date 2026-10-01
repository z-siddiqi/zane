<script lang="ts">
  import { Router } from "sv-router";
  import AuthGate from "./lib/components/AuthGate.svelte";
  import BottomNav, { isTabRoute } from "./lib/components/BottomNav.svelte";
  import { connectionManager } from "./lib/connection-manager.svelte";
  import { auth } from "./lib/auth.svelte";
  import { route } from "./router";

  const tabbed = $derived(isTabRoute(route.pathname));

  $effect(() => {
    if (auth.status === "signed_in") {
      connectionManager.ensureConnectedOnLoad();
    }
  });
</script>

<AuthGate>
  <div class="app stack" class:tabbed>
    <div class="page">
      <Router />
    </div>
    {#if tabbed}
      <BottomNav />
    {/if}
  </div>
</AuthGate>

<style>
  .app {
    --stack-gap: 0;
    height: 100%;
    width: 100%;
    max-width: var(--app-max-width);
    margin: 0 auto;
  }

  .page {
    height: 100%;
  }

  /* On phones, tab pages scroll above the nav instead of underneath it. */
  @media (max-width: 639px) {
    .tabbed .page {
      flex: 1;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .tabbed .page > :global(:first-child) {
      min-height: 100%;
    }
  }
</style>
