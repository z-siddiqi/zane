<script lang="ts">
  import { onMount } from "svelte";
  import { auth } from "../lib/auth.svelte";
  import { theme } from "../lib/theme.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import { socket } from "../lib/socket.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  interface AnchorInfo {
    id: string;
    hostname: string;
    platform: string;
    connectedAt: string;
  }

  let anchors = $state<AnchorInfo[]>([]);

  const platformLabels: Record<string, string> = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
  };

  function formatSince(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  onMount(() => {
    if (socket.isHealthy) {
      socket.requestAnchors();
    }

    const unsubConnect = socket.onConnect(() => {
      socket.requestAnchors();
    });

    const unsubProtocol = socket.onProtocol((msg) => {
      if (msg.type === "orbit.anchors") {
        anchors = (msg.anchors as AnchorInfo[]) ?? [];
      } else if (msg.type === "orbit.anchor-connected") {
        const anchor = msg.anchor as AnchorInfo;
        if (!anchors.some((a) => a.id === anchor.id)) {
          anchors = [...anchors, anchor];
        }
      } else if (msg.type === "orbit.anchor-disconnected") {
        anchors = anchors.filter((a) => a.id !== (msg.anchorId as string));
      }
    });

    return () => {
      unsubConnect();
      unsubProtocol();
    };
  });
</script>

<div class="settings stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <a href="/">Back</a>
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {themeIcons[theme.current]}
      </button>
      <button type="button" onclick={() => auth.signOut()} title="Sign out">⏻</button>
    {/snippet}
  </AppHeader>

  <div class="content stack">
    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Devices</span>
      </div>
      <div class="section-body stack">
        {#if anchors.length === 0}
          <p class="hint">
            No devices connected. Run <code>zane start</code> in your terminal to connect an anchor.
          </p>
        {:else}
          <ul class="anchor-list">
            {#each anchors as anchor (anchor.id)}
              <li class="anchor-item">
                <span class="anchor-status" title="Connected">●</span>
                <span class="anchor-hostname">{anchor.hostname}</span>
                <span class="anchor-detail">{platformLabels[anchor.platform] ?? anchor.platform}</span>
                <span class="anchor-detail anchor-since">since {formatSince(anchor.connectedAt)}</span>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="hint">
          To connect a new device, run <code>zane start</code> in your terminal.
          A code will appear — enter it at <a href="/device">/device</a> to authorise.
        </p>
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
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) 0;
  }

  .anchor-status {
    font-size: var(--text-xs);
    color: var(--cli-success, #4ade80);
  }

  .anchor-hostname {
    color: var(--cli-text);
    font-weight: 500;
  }

  .anchor-detail {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }

  .anchor-since {
    margin-left: auto;
  }

  .hint {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
    margin: 0;
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
</style>
