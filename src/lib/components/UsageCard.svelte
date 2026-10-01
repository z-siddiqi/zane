<script lang="ts">
  import { account } from "../account.svelte";
  import type { RateLimitWindow } from "../types";
  import TokenActivity from "./TokenActivity.svelte";
  import Heading from "./Heading.svelte";

  const WARNING_PERCENT = 80;

  let cardWidth = $state(0);

  const limits = $derived(account.rateLimits);
  const windows = $derived(
    [limits?.primary, limits?.secondary].filter((w): w is RateLimitWindow => !!w)
  );
  const heatmapWeeks = $derived(Math.max(12, Math.min(53, Math.floor(cardWidth / 15))));

  function windowLabel(mins: number | null | undefined): string {
    if (!mins) return "limit";
    return mins >= 1440 ? `${mins / 1440}d` : `${mins / 60}h`;
  }

  function formatReset(seconds: number | null | undefined): string {
    if (!seconds) return "";
    return new Date(seconds * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

{#if windows.length || account.usage}
  <section class="usage-card stack" bind:clientWidth={cardWidth}>
    <Heading title="Usage" />

    {#each windows as window}
      <div class="limit stack">
        <div class="limit-row split">
          <span class="limit-label">{windowLabel(window.windowDurationMins)}</span>
          <span class="limit-value" class:warning={window.usedPercent >= WARNING_PERCENT}>
            {Math.round(window.usedPercent)}%
            {#if window.resetsAt}
              <span class="limit-reset">· resets {formatReset(window.resetsAt)}</span>
            {/if}
          </span>
        </div>
        <div class="bar">
          <div
            class="bar-fill"
            class:warning={window.usedPercent >= WARNING_PERCENT}
            style:width="{Math.min(100, window.usedPercent)}%"
          ></div>
        </div>
      </div>
    {/each}

    {#if account.usage}
      <div class="activity">
        <TokenActivity usage={account.usage} weeks={heatmapWeeks} />
      </div>
    {/if}
  </section>
{/if}

<style>
  .usage-card {
    --stack-gap: var(--space-sm);
  }

  .limit {
    --stack-gap: 4px;
  }

  .limit-row {
    --split-gap: var(--space-sm);
    font-size: var(--text-xs);
  }

  .limit-label {
    color: var(--cli-text-dim);
  }

  .limit-value {
    color: var(--cli-text);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .limit-reset {
    color: var(--cli-text-muted);
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--cli-bg-elevated);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--cli-prefix-agent);
    transition: width var(--transition-fast);
  }

  .bar-fill.warning {
    background: var(--cli-warning);
  }

  .limit-value.warning {
    color: var(--cli-warning);
  }

  .activity {
    padding-top: var(--space-xs);
  }
</style>
