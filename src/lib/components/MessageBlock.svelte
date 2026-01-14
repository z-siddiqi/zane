<script lang="ts">
  import type { Message } from "../types";
  import OutputBlock from "./OutputBlock.svelte";
  import ShimmerDot from "./ShimmerDot.svelte";

  interface Props {
    message: Message;
  }

  let { message }: Props = $props();

  const prefixConfig = $derived.by(() => {
    if (message.role === "user") {
      return { prefix: "▌", color: "var(--cli-prefix-user)", bgClass: "user-bg" };
    }
    if (message.role === "assistant") {
      if (message.kind === "reasoning") {
        return { prefix: "•", color: "var(--cli-prefix-reasoning)", bgClass: "" };
      }
      return { prefix: "•", color: "var(--cli-prefix-agent)", bgClass: "" };
    }
    if (message.role === "tool") {
      return { prefix: "•", color: "var(--cli-prefix-tool)", bgClass: "" };
    }
    return { prefix: "•", color: "var(--cli-text-dim)", bgClass: "" };
  });

  const isToolOutput = $derived(message.role === "tool" && (message.kind === "command" || message.kind === "file"));
  const isTerminal = $derived(message.role === "tool" && message.kind === "terminal");
  const isWait = $derived(message.role === "tool" && message.kind === "wait");

  const terminalLines = $derived.by(() => {
    if (!isTerminal) return [];
    const lines = message.text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  });

  // Extract command from text like "$ git status\noutput..."
  const commandInfo = $derived.by(() => {
    if (message.kind !== "command") return null;
    const lines = message.text.split("\n");
    const firstLine = lines[0] || "";
    if (firstLine.startsWith("$ ")) {
      return {
        command: firstLine.slice(2),
        output: lines.slice(1).join("\n")
      };
    }
    return { command: null, output: message.text };
  });
</script>

<div class="message-block {prefixConfig.bgClass}">
  {#if isToolOutput && commandInfo}
    <OutputBlock
      text={commandInfo.output}
      command={commandInfo.command}
      exitCode={message.metadata?.exitCode ?? null}
    />
  {:else if isWait}
    <div class="message-line wait">
      <span class="prefix" style:color={prefixConfig.color}>{prefixConfig.prefix}</span>
      <div class="wait-line">
        <ShimmerDot color="var(--cli-prefix-tool)" />
        <span class="text dim">{message.text}</span>
      </div>
    </div>
  {:else if isTerminal}
    <div class="message-line terminal">
      <span class="prefix" style:color={prefixConfig.color}>{prefixConfig.prefix}</span>
      <div class="terminal-lines">
        {#each terminalLines as line}
          <div class="terminal-line">
            <span class="text">{line}</span>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="message-line" class:reasoning={message.kind === "reasoning"}>
      <span class="prefix" style:color={prefixConfig.color}>{prefixConfig.prefix}</span>
      <span class="text">{message.text}</span>
    </div>
  {/if}
</div>

<style>
  .message-block {
    padding: var(--space-xs) var(--space-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .message-block.user-bg {
    background: var(--cli-bg-user);
    border-left: 2px solid var(--cli-prefix-user);
    padding-left: calc(var(--space-md) - 2px);
  }

  .message-line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
  }

  .message-line.reasoning {
    font-style: italic;
    color: var(--cli-text-dim);
  }

  .message-line.terminal {
    align-items: flex-start;
  }

  .message-line.wait {
    align-items: center;
  }

  .terminal-lines {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .terminal-line {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .wait-line {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .prefix {
    flex-shrink: 0;
    font-weight: 600;
  }

  .text {
    color: var(--cli-text);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-line.reasoning .text {
    color: var(--cli-text-dim);
  }

  .text.dim {
    color: var(--cli-text-dim);
    font-style: italic;
  }
</style>
