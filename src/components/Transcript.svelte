<script lang="ts">
  import { messages } from "../lib/messages.svelte";
  import { threads } from "../lib/threads.svelte";

  let container: HTMLDivElement;

  $effect(() => {
    if (messages.current.length && container) {
      container.scrollTop = container.scrollHeight;
    }
  });
</script>

<div class="transcript" bind:this={container}>
  {#if !threads.currentId}
    <p class="empty">Select a thread to view transcript</p>
  {:else if messages.current.length === 0}
    <p class="empty">No messages yet</p>
  {:else}
    {#each messages.current as message (message.id)}
      <div class="message {message.role}" class:reasoning={message.kind === "reasoning"}>
        <span class="label">
          {#if message.role === "user"}
            [you]
          {:else if message.role === "assistant"}
            {#if message.kind === "reasoning"}
              [thinking]
            {:else}
              [agent]
            {/if}
          {:else}
            [{message.kind || "tool"}]
          {/if}
        </span>
        <pre class="text">{message.text}</pre>
      </div>
    {/each}
  {/if}
</div>

<style>
  .transcript {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.875rem;
    background: #fafafa;
  }

  .empty {
    color: #888;
    text-align: center;
    padding: 2rem;
    margin: 0;
    font-family: system-ui, sans-serif;
  }

  .message {
    margin-bottom: 0.75rem;
  }

  .message:last-child {
    margin-bottom: 0;
  }

  .label {
    color: #666;
    font-size: 0.75rem;
  }

  .message.user .label {
    color: #2563eb;
  }

  .message.assistant .label {
    color: #16a34a;
  }

  .message.reasoning .label {
    color: #9333ea;
  }

  .message.tool .label {
    color: #d97706;
  }

  .text {
    margin: 0.25rem 0 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.4;
  }

  .message.reasoning .text {
    color: #666;
    font-style: italic;
  }

  .message.tool .text {
    background: #f0f0f0;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
  }
</style>
