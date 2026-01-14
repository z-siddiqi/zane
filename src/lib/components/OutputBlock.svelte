<script lang="ts">
  interface Props {
    text: string;
    maxLines?: number;
    exitCode?: number | null;
    command?: string;
  }

  let { text, maxLines = 10, exitCode = null, command }: Props = $props();

  const processedOutput = $derived.by(() => {
    const lines = text.split("\n").filter(line => line.length > 0);
    const half = Math.floor(maxLines / 2);

    if (lines.length <= maxLines) {
      return { lines, truncated: 0 };
    }

    const first = lines.slice(0, half);
    const last = lines.slice(-half);
    const truncated = lines.length - maxLines;

    return {
      lines: [...first, `... +${truncated} more lines`, ...last],
      truncated
    };
  });

  const exitIcon = $derived(exitCode === 0 ? "✓" : "✗");
  const exitColor = $derived(exitCode === 0 ? "var(--cli-success)" : "var(--cli-error)");
</script>

<div class="output-block">
  {#if command}
    <div class="command-line">
      <span class="prefix" style:color="var(--cli-prefix-tool)">•</span>
      <span class="command-label">Ran</span>
      <span class="command-text">{command}</span>
    </div>
  {/if}

  <div class="output-content">
    {#each processedOutput.lines as line, i}
      <div class="output-line" class:truncation-marker={line.startsWith("... +")}>
        {#if i === 0 && !line.startsWith("... +")}
          <span class="prefix">└</span>
        {:else if line.startsWith("... +")}
          <span class="prefix dim">·</span>
        {:else}
          <span class="prefix"> </span>
        {/if}
        <span class="line-text" class:dim={!line.startsWith("... +")}>{line}</span>
      </div>
    {/each}
  </div>

  {#if exitCode !== null}
    <div class="exit-status" style:color={exitColor}>
      <span class="prefix"> </span>
      <span class="exit-icon">{exitIcon}</span>
      <span class="exit-label">exit {exitCode}</span>
    </div>
  {/if}
</div>

<style>
  .output-block {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .command-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    color: var(--cli-text);
    margin-bottom: var(--space-xs);
  }

  .command-label {
    color: var(--cli-text-dim);
  }

  .command-text {
    color: var(--cli-text);
    word-break: break-all;
  }

  .output-content {
    margin-left: var(--space-sm);
  }

  .output-line {
    display: flex;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .output-line.truncation-marker {
    color: var(--cli-text-muted);
    font-style: italic;
  }

  .prefix {
    flex-shrink: 0;
    width: 1.5ch;
    color: var(--cli-text-muted);
  }

  .prefix.dim {
    color: var(--cli-text-muted);
  }

  .line-text {
    color: var(--cli-text);
  }

  .line-text.dim {
    color: var(--cli-text-dim);
  }

  .exit-status {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-top: var(--space-xs);
    font-size: var(--text-xs);
  }

  .exit-icon {
    font-weight: 600;
  }

  .exit-label {
    opacity: 0.8;
  }
</style>
