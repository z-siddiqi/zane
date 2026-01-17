<script lang="ts">
  import type { ApprovalRequest } from "../types";

  interface Props {
    approval: ApprovalRequest;
    onApprove: (forSession?: boolean) => void;
    onDecline: () => void;
    onCancel: () => void;
  }

  let { approval, onApprove, onDecline, onCancel }: Props = $props();

  let selectedIndex = $state(0);

  const options = [
    { key: "Y", label: "Yes, proceed", action: () => onApprove(false) },
    { key: "A", label: "Yes, always for this session", action: () => onApprove(true) },
    { key: "N", label: "No, decline", action: () => onDecline() },
    { key: "Esc", label: "Cancel turn", action: () => onCancel() },
  ];

  const actionLabels: Record<ApprovalRequest["type"], string> = {
    command: "Run shell command",
    file: "Modify file",
    mcp: "Run MCP tool",
    other: "Perform action",
  };

  const statusLabels: Record<string, { text: string; color: string }> = {
    approved: { text: "APPROVED", color: "var(--cli-success)" },
    declined: { text: "DECLINED", color: "var(--cli-error)" },
    cancelled: { text: "CANCELLED", color: "var(--cli-text-muted)" },
  };

  function handleOptionClick(index: number) {
    if (approval.status !== "pending") return;
    selectedIndex = index;
    options[index].action();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (approval.status !== "pending") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const key = e.key.toLowerCase();

    if (key === "arrowdown" || key === "j") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
    } else if (key === "arrowup" || key === "k") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (key === "enter") {
      e.preventDefault();
      options[selectedIndex].action();
    } else if (key === "y") {
      e.preventDefault();
      onApprove(false);
    } else if (key === "a" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onApprove(true);
    } else if (key === "n") {
      e.preventDefault();
      onDecline();
    } else if (key === "escape") {
      e.preventDefault();
      onCancel();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="approval-prompt" class:resolved={approval.status !== "pending"}>
  <div class="border-top">┌─ Approval Required ─{"─".repeat(30)}┐</div>

  <div class="content">
    <div class="line">
      <span class="border">│</span>
      <span class="action-type">{actionLabels[approval.type]}</span>
    </div>

    {#if approval.command}
      <div class="line command">
        <span class="border">│</span>
        <span class="prompt">$</span>
        <span class="command-text">{approval.command}</span>
      </div>
    {/if}

    {#if approval.filePath}
      <div class="line">
        <span class="border">│</span>
        <span class="file-path">{approval.filePath}</span>
      </div>
    {/if}

    {#if approval.description && approval.description !== approval.command}
      <div class="line description">
        <span class="border">│</span>
        <span class="desc-text">{approval.description}</span>
      </div>
    {/if}

    <div class="line empty"><span class="border">│</span></div>

    {#if approval.status === "pending"}
      {#each options as option, i}
        <button
          type="button"
          class="line option"
          class:selected={i === selectedIndex}
          onclick={() => handleOptionClick(i)}
        >
          <span class="border">│</span>
          <span class="selector">{i === selectedIndex ? "›" : " "}</span>
          <span class="key">[{option.key}]</span>
          <span class="option-label">{option.label}</span>
        </button>
      {/each}
    {:else}
      <div class="line status">
        <span class="border">│</span>
        <span class="status-text" style:color={statusLabels[approval.status].color}>
          {statusLabels[approval.status].text}
        </span>
      </div>
    {/if}
  </div>

  <div class="border-bottom">└{"─".repeat(50)}┘</div>
</div>

<style>
  .approval-prompt {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--cli-text);
    padding: var(--space-sm) var(--space-md);
  }

  .approval-prompt.resolved {
    opacity: 0.6;
  }

  .border-top,
  .border-bottom {
    color: var(--cli-prefix-tool);
    white-space: pre;
    overflow: hidden;
  }

  .content {
    padding: var(--space-xs) 0;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    padding: 1px 0;
    white-space: nowrap;
  }

  .line.empty {
    height: var(--text-sm);
  }

  .border {
    color: var(--cli-prefix-tool);
    flex-shrink: 0;
  }

  .action-type {
    color: var(--cli-text);
    font-weight: 500;
  }

  .line.command {
    margin: var(--space-xs) 0;
  }

  .prompt {
    color: var(--cli-prefix-reasoning);
    font-weight: 600;
  }

  .command-text {
    color: var(--cli-text);
  }

  .file-path {
    color: var(--cli-prefix-user);
  }

  .line.description .desc-text {
    color: var(--cli-text-dim);
    font-style: italic;
  }

  .line.option {
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .line.option:hover {
    background: var(--cli-selection);
  }

  .line.option.selected {
    background: var(--cli-selection);
  }

  .selector {
    color: var(--cli-prefix-agent);
    font-weight: 600;
    width: 1ch;
  }

  .key {
    color: var(--cli-text-muted);
    width: 5ch;
  }

  .option-label {
    color: var(--cli-text);
  }

  .line.option.selected .option-label {
    color: var(--cli-prefix-agent);
  }

  .status-text {
    font-weight: 600;
  }
</style>
