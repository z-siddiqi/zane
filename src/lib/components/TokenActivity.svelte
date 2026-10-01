<script lang="ts">
  import type { AccountTokenUsageResponse } from "../types";

  const DAY_MS = 86_400_000;
  const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

  interface Props {
    usage: AccountTokenUsageResponse;
    weeks?: number;
    compact?: boolean;
  }

  const { usage, weeks: weekCount = 53, compact = false }: Props = $props();

  interface Cell {
    date: string;
    tokens: number;
    level: number;
    future: boolean;
  }

  function isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function todayUtcMs(): number {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // Quartiles of active days, so one outlier day doesn't flatten the rest of the grid.
  function thresholds(values: number[]): number[] {
    const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return [];
    return [0.25, 0.5, 0.75].map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
  }

  function levelFor(tokens: number, cuts: number[]): number {
    if (tokens <= 0) return 0;
    return 1 + cuts.filter((cut) => tokens > cut).length;
  }

  const grid = $derived.by(() => {
    const byDate = new Map((usage.dailyUsageBuckets ?? []).map((b) => [b.startDate, b.tokens]));

    const today = todayUtcMs();
    const lastSaturday = today + (6 - new Date(today).getUTCDay()) * DAY_MS;
    const start = lastSaturday - (weekCount * 7 - 1) * DAY_MS;

    const days: { date: string; tokens: number; future: boolean }[] = [];
    for (let ms = start; ms <= lastSaturday; ms += DAY_MS) {
      const date = isoDate(ms);
      days.push({ date, tokens: byDate.get(date) ?? 0, future: ms > today });
    }

    const cuts = thresholds(days.map((d) => d.tokens));
    const weeks: Cell[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7).map((d) => ({ ...d, level: levelFor(d.tokens, cuts) })));
    }

    const months = weeks.map((week) => {
      const firstOfMonth = week.find((cell) => cell.date.endsWith("-01"));
      if (!firstOfMonth) return "";
      return new Date(`${firstOfMonth.date}T00:00:00Z`).toLocaleString(undefined, { month: "short", timeZone: "UTC" });
    });

    return { weeks, months };
  });

  const stats = $derived.by(() => {
    const s = usage.summary;
    return [
      { label: "lifetime", value: formatTokens(s.lifetimeTokens) },
      { label: "peak day", value: formatTokens(s.peakDailyTokens) },
      { label: "longest turn", value: formatDuration(s.longestRunningTurnSec) },
      { label: "streak", value: formatDays(s.currentStreakDays) },
      { label: "best streak", value: formatDays(s.longestStreakDays) },
    ];
  });

  function formatTokens(value: number | null | undefined): string {
    if (value == null) return "—";
    const units: [number, string][] = [
      [1e9, "B"],
      [1e6, "M"],
      [1e3, "K"],
    ];
    for (const [size, suffix] of units) {
      if (value >= size) return `${(value / size).toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
    return String(value);
  }

  function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function formatDays(days: number | null | undefined): string {
    if (days == null) return "—";
    return `${days} ${days === 1 ? "day" : "days"}`;
  }

  function cellTitle(cell: Cell): string {
    const date = new Date(`${cell.date}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${date}: ${cell.tokens > 0 ? `${formatTokens(cell.tokens)} tokens` : "no activity"}`;
  }

  function scrollToEnd(node: HTMLElement) {
    node.scrollLeft = node.scrollWidth;
  }
</script>

<div class="token-activity stack" class:compact style:--weeks={weekCount}>
  {#if !compact}
    <div class="stats">
      {#each stats as stat}
        <div class="stat">
          <span class="stat-value">{stat.value}</span>
          <span class="stat-label">{stat.label}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="heatmap-scroll" use:scrollToEnd>
    <div class="heatmap">
      {#if !compact}
        <div class="weekdays">
          <span class="month-spacer"></span>
          {#each WEEKDAY_LABELS as label}
            <span class="weekday">{label}</span>
          {/each}
        </div>
      {/if}
      {#each grid.weeks as week, index}
        <div class="week">
          <span class="month">{grid.months[index]}</span>
          {#each week as cell (cell.date)}
            <span
              class="cell level-{cell.level}"
              class:future={cell.future}
              title={cell.future ? undefined : cellTitle(cell)}
            ></span>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  {#if !compact}
    <div class="legend">
      <span>less</span>
      {#each [0, 1, 2, 3, 4] as level}
        <span class="cell level-{level}"></span>
      {/each}
      <span>more</span>
    </div>
  {/if}
</div>

<style>
  .token-activity {
    --stack-gap: var(--space-md);
    --cell: 10px;
    --cell-gap: 3px;
    --heat: var(--cli-prefix-agent);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr));
    gap: var(--space-sm);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-value {
    color: var(--cli-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
  }

  .heatmap-scroll {
    container-type: inline-size;
    overflow-x: auto;
  }

  .compact .heatmap-scroll {
    overflow: hidden;
  }

  .heatmap {
    --cell: clamp(10px, calc((100cqi - 2rem) / (var(--weeks) + 1) - var(--cell-gap)), 16px);
    display: flex;
    gap: var(--cell-gap);
    width: max-content;
    font-size: 10px;
    color: var(--cli-text-dim);
  }

  .compact .heatmap {
    --cell: clamp(6px, calc(100cqi / var(--weeks) - var(--cell-gap)), 16px);
  }

  .weekdays,
  .week {
    display: grid;
    grid-template-rows: 14px repeat(7, var(--cell));
    gap: var(--cell-gap);
  }

  .weekdays {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--cli-bg);
  }

  .weekday {
    line-height: var(--cell);
    padding-right: var(--space-xs);
  }

  .month {
    white-space: nowrap;
    width: var(--cell);
  }

  .cell {
    display: inline-block;
    width: var(--cell);
    height: var(--cell);
    border-radius: 2px;
  }

  .level-0 {
    background: var(--cli-bg-elevated);
    outline: 1px solid var(--cli-border);
    outline-offset: -1px;
  }

  .level-1 {
    background: color-mix(in srgb, var(--heat) 25%, var(--cli-bg-elevated));
  }

  .level-2 {
    background: color-mix(in srgb, var(--heat) 50%, var(--cli-bg-elevated));
  }

  .level-3 {
    background: color-mix(in srgb, var(--heat) 75%, var(--cli-bg-elevated));
  }

  .level-4 {
    background: var(--heat);
  }

  .cell.future {
    visibility: hidden;
  }

  .legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-xs);
    font-size: var(--text-xs);
    color: var(--cli-text-dim);
  }
</style>
