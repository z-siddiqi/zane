<script lang="ts">
  import { threads } from "../lib/threads.svelte";

  interface Props {
    workingDir: string;
  }

  let { workingDir }: Props = $props();

  function handleNew() {
    if (workingDir) {
      threads.start(workingDir);
    }
  }

  function formatTime(ts?: number): string {
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

<div class="thread-list">
  <div class="actions">
    <button onclick={handleNew} disabled={!workingDir}>New Thread</button>
    <button onclick={() => threads.fetch()}>Refresh</button>
  </div>

  {#if threads.loading}
    <p class="loading">Loading...</p>
  {:else if threads.list.length === 0}
    <p class="empty">No threads yet</p>
  {:else}
    <ul>
      {#each threads.list as thread (thread.id)}
        <li class:selected={thread.id === threads.currentId}>
          <button class="thread-item" onclick={() => threads.open(thread.id, workingDir)}>
            <span class="preview">{thread.preview || "New thread"}</span>
            <span class="meta">{formatTime(thread.createdAt)}</span>
          </button>
          <button
            class="archive"
            onclick={() => threads.archive(thread.id)}
            title="Archive"
          >[bin]</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .thread-list {
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    padding: 0.5rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .actions button {
    flex: 1;
    padding: 0.5rem;
    font-size: 0.875rem;
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }

  .actions button:hover:not(:disabled) {
    background: #eee;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading,
  .empty {
    color: #666;
    font-size: 0.875rem;
    text-align: center;
    padding: 1rem;
    margin: 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 300px;
    overflow-y: auto;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 4px;
  }

  li.selected {
    background: #f0f0f0;
  }

  .thread-item {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }

  .thread-item:hover {
    background: #f9f9f9;
  }

  .preview {
    width: 100%;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-size: 0.75rem;
    color: #888;
  }

  .archive {
    padding: 0.25rem 0.5rem;
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.75rem;
  }

  .archive:hover {
    color: #dc2626;
  }
</style>
