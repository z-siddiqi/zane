<script lang="ts">
  import { createEventDispatcher } from "svelte";

  import type { ModeKind, ModelOption, Personality, ReasoningEffort } from "../types";
  import RuntimeControls from "./RuntimeControls.svelte";

  interface Props {
    task: string;
    mode: ModeKind;
    isCreating: boolean;
    canSubmit: boolean;
    worktreeDisplay: string;
    currentModelLabel: string;
    modelsStatus: string;
    modelOptions: ModelOption[];
    selectedModel: string;
    reasoningEffort: ReasoningEffort;
    serviceTier: string;
    personality: Personality;
  }

  const {
    task,
    mode,
    isCreating,
    canSubmit,
    worktreeDisplay,
    currentModelLabel,
    modelsStatus,
    modelOptions,
    selectedModel,
    reasoningEffort,
    serviceTier,
    personality,
  }: Props = $props();

  const dispatch = createEventDispatcher<{
    submit: void;
    taskChange: { value: string };
    toggleMode: void;
    openWorktrees: void;
    selectModel: { value: string };
    selectReasoning: { value: ReasoningEffort };
    selectServiceTier: { value: string };
    selectPersonality: { value: Personality };
  }>();

  let modelOpen = $state(false);
  const selectedModelOption = $derived(modelOptions.find((option) => option.value === selectedModel) ?? null);

  function handleTaskKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      dispatch("submit");
    }
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".dropdown")) modelOpen = false;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<form
  class="input-card stack"
  onsubmit={(e) => {
    e.preventDefault();
    dispatch("submit");
  }}
>
  <textarea
    value={task}
    oninput={(e) => {
      const value = (e.currentTarget as HTMLTextAreaElement).value;
      dispatch("taskChange", { value });
    }}
    onkeydown={handleTaskKeydown}
    placeholder="Fix a bug, build a feature, refactor code..."
    rows="3"
    disabled={isCreating}
  ></textarea>

  <div class="input-footer split">
    <div class="tools row">
      <!-- Model Selector -->
      <div class="dropdown" class:open={modelOpen}>
        <button
          type="button"
          class="tool-btn row"
          onclick={(e) => {
            e.stopPropagation();
            modelOpen = !modelOpen;
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z" />
            <circle cx="12" cy="14" r="2" />
          </svg>
          <span class="collapsible-label">{currentModelLabel}</span>
          <svg class="chevron collapsible-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {#if modelOpen}
          <div class="dropdown-menu">
            {#if modelsStatus === "loading"}
              <div class="dropdown-empty">Loading...</div>
            {:else if modelOptions.length === 0}
              <div class="dropdown-empty">No models available</div>
            {:else}
              {#each modelOptions as option}
                <button
                  type="button"
                  class="dropdown-item split"
                  class:selected={selectedModel === option.value}
                  onclick={() => {
                    dispatch("selectModel", { value: option.value });
                    modelOpen = false;
                  }}
                >
                  {option.label}
                  {#if selectedModel === option.value}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <RuntimeControls
        modelOption={selectedModelOption}
        {reasoningEffort}
        {serviceTier}
        {personality}
        onReasoningChange={(value) => dispatch("selectReasoning", { value })}
        onServiceTierChange={(value) => dispatch("selectServiceTier", { value })}
        onPersonalityChange={(value) => dispatch("selectPersonality", { value })}
      />

      <!-- Mode Toggle -->
      <button
        type="button"
        class="tool-btn mode-toggle row"
        class:active={mode === "plan"}
        onclick={() => dispatch("toggleMode")}
      >
        {#if mode === "plan"}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          </svg>
          <span>Plan</span>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span>Code</span>
        {/if}
      </button>
    </div>

    <button type="submit" class="submit-btn row" disabled={!canSubmit}>
      {#if isCreating}
        <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 17 5-5-5-5" />
          <path d="m13 17 5-5-5-5" />
        </svg>
      {/if}
    </button>
  </div>
</form>

<button type="button" class="chip" onclick={() => dispatch("openWorktrees")}>
  <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
  <span>{worktreeDisplay}</span>
</button>

<style>
  .input-card {
    --stack-gap: 0;
    width: 100%;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    background: var(--cli-bg);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .input-card:focus-within {
    border-color: var(--cli-text-muted);
    box-shadow: var(--shadow-focus);
  }

  .input-card textarea {
    flex: 1;
    display: block;
    width: 100%;
    padding: var(--space-md);
    background: transparent;
    border: none;
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: 16px;
    line-height: 1.6;
    resize: vertical;
    min-height: 5.5rem;
  }

  .input-card textarea:focus {
    outline: none;
  }

  .input-card textarea::placeholder {
    color: var(--cli-text-muted);
  }

  .input-card textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input-footer {
    --split-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--cli-border);
  }

  .tools {
    --row-gap: var(--space-xs);
    flex-wrap: wrap;
  }

  .tool-btn {
    --row-gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .tool-btn:hover {
    background: var(--cli-bg-hover);
    color: var(--cli-text);
  }

  .tool-btn svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .tool-btn .chevron {
    width: 0.75rem;
    height: 0.75rem;
    opacity: 0.5;
  }

  .mode-toggle.active {
    background: color-mix(in srgb, var(--cli-prefix-agent) 15%, transparent);
    color: var(--cli-prefix-agent);
  }

  .submit-btn {
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--cli-prefix-agent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity var(--transition-fast);
    --row-gap: 0;
  }

  .submit-btn svg {
    width: 1rem;
    height: 1rem;
    color: var(--cli-bg);
  }

  .submit-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Worktree chip */

  .chip {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    max-width: 16rem;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .chip:hover {
    background: var(--cli-bg-hover);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .chip-icon {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
  }

  .chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Dropdown */

  .dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    min-width: 140px;
    margin-bottom: var(--space-xs);
    padding: var(--space-xs);
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    z-index: 100;
    animation: fadeIn 0.1s ease;
  }

  .dropdown-item {
    --split-gap: var(--space-sm);
    width: 100%;
    padding: var(--space-sm);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .dropdown-item:hover {
    background: var(--cli-bg-hover);
  }

  .dropdown-item.selected {
    color: var(--cli-prefix-agent);
  }

  .dropdown-item svg {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
  }

  .dropdown-empty {
    padding: var(--space-sm);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @media (max-width: 480px) {
    .collapsible-label {
      display: none;
    }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
