<script lang="ts">
  interface Props {
    title: string;
    href?: string;
    linkLabel?: string;
  }

  const { title, href, linkLabel }: Props = $props();
</script>

<div class="section-header split">
  <span class="section-title">{title}</span>
  {#if href}
    <a class="section-link" {href}>{linkLabel} →</a>
  {/if}
</div>

<style>
  .section-header {
    --split-gap: var(--space-sm);
  }

  .section-title {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .section-link {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  .section-link:hover {
    color: var(--cli-text);
  }
</style>
