<script lang="ts">
  import type { ModelOption, Personality, ReasoningEffort } from "../types";
  import {
    DEFAULT_SERVICE_TIER,
    PERSONALITY_OPTIONS,
    formatRuntimeLabel,
    reasoningOptionsForModel,
    serviceTierOptionsForModel,
  } from "../runtime-controls";

  interface Props {
    modelOption: ModelOption | null;
    reasoningEffort: ReasoningEffort;
    serviceTier: string;
    personality: Personality;
    onReasoningChange: (effort: ReasoningEffort) => void;
    onServiceTierChange: (tier: string) => void;
    onPersonalityChange: (personality: Personality) => void;
  }

  const {
    modelOption,
    reasoningEffort,
    serviceTier,
    personality,
    onReasoningChange,
    onServiceTierChange,
    onPersonalityChange,
  }: Props = $props();

  let openMenu = $state<"reasoning" | "tier" | "personality" | null>(null);

  const reasoningOptions = $derived(reasoningOptionsForModel(modelOption));
  const tierOptions = $derived(serviceTierOptionsForModel(modelOption));
  const reasoningLabel = $derived(
    reasoningOptions.find((option) => option.value === reasoningEffort)?.label
      ?? formatRuntimeLabel(reasoningEffort),
  );
  const tierLabel = $derived(
    tierOptions.find((option) => option.value === serviceTier)?.label
      ?? formatRuntimeLabel(serviceTier),
  );
  const personalityLabel = $derived(
    PERSONALITY_OPTIONS.find((option) => option.value === personality)?.label ?? "Default",
  );

  function toggle(menu: "reasoning" | "tier" | "personality", event: MouseEvent) {
    event.stopPropagation();
    openMenu = openMenu === menu ? null : menu;
  }

  function handleWindowClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".runtime-control")) openMenu = null;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="runtime-controls row">
  <div class="runtime-control" class:open={openMenu === "reasoning"}>
    <button
      type="button"
      class="tool-btn row"
      title={`Reasoning: ${reasoningLabel}`}
      onclick={(event) => toggle("reasoning", event)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9.5 4.5a3 3 0 0 0-3 3v1a3.5 3.5 0 0 0 0 7v1a3 3 0 0 0 5.5 1.65V5.85A3 3 0 0 0 9.5 4.5Z"/>
        <path d="M14.5 4.5a3 3 0 0 1 3 3v1a3.5 3.5 0 0 1 0 7v1a3 3 0 0 1-5.5 1.65V5.85A3 3 0 0 1 14.5 4.5Z"/>
      </svg>
      <span class="runtime-label">{reasoningLabel}</span>
      <svg class="chevron runtime-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </button>
    {#if openMenu === "reasoning"}
      <div class="dropdown-menu">
        {#each reasoningOptions as option}
          <button
            type="button"
            class="dropdown-item split"
            class:selected={reasoningEffort === option.value}
            onclick={() => {
              onReasoningChange(option.value);
              openMenu = null;
            }}
          >
            {option.label}
            {#if reasoningEffort === option.value}<span class="check">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if tierOptions.length > 1}
    <div class="runtime-control" class:open={openMenu === "tier"}>
      <button
        type="button"
        class="tool-btn row"
        class:active={serviceTier !== DEFAULT_SERVICE_TIER}
        title={`Speed: ${tierLabel}`}
        onclick={(event) => toggle("tier", event)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>
        </svg>
        <span class="runtime-label">{tierLabel}</span>
        <svg class="chevron runtime-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      {#if openMenu === "tier"}
        <div class="dropdown-menu">
          {#each tierOptions as option}
            <button
              type="button"
              class="dropdown-item split"
              class:selected={serviceTier === option.value}
              title={option.description}
              onclick={() => {
                onServiceTierChange(option.value);
                openMenu = null;
              }}
            >
              {option.label}
              {#if serviceTier === option.value}<span class="check">✓</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if modelOption?.supportsPersonality}
    <div class="runtime-control" class:open={openMenu === "personality"}>
      <button
        type="button"
        class="tool-btn row"
        class:active={personality !== "default"}
        title={`Personality: ${personalityLabel}`}
        onclick={(event) => toggle("personality", event)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <path d="M8.5 10h.01M15.5 10h.01M8.5 15c1.8 1.5 5.2 1.5 7 0"/>
        </svg>
        <span class="runtime-label">{personalityLabel}</span>
        <svg class="chevron runtime-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      {#if openMenu === "personality"}
        <div class="dropdown-menu align-right">
          {#each PERSONALITY_OPTIONS as option}
            <button
              type="button"
              class="dropdown-item split"
              class:selected={personality === option.value}
              onclick={() => {
                onPersonalityChange(option.value);
                openMenu = null;
              }}
            >
              {option.label}
              {#if personality === option.value}<span class="check">✓</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .runtime-controls {
    --row-gap: var(--space-xs);
  }

  .runtime-control {
    position: relative;
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

  .tool-btn.active {
    background: color-mix(in srgb, var(--cli-prefix-agent) 15%, transparent);
    color: var(--cli-prefix-agent);
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

  .dropdown-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    min-width: 150px;
    max-height: 18rem;
    overflow-y: auto;
    margin-bottom: var(--space-xs);
    padding: var(--space-xs);
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    z-index: 110;
  }

  .dropdown-menu.align-right {
    right: 0;
    left: auto;
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
  }

  .dropdown-item:hover {
    background: var(--cli-bg-hover);
  }

  .dropdown-item.selected,
  .check {
    color: var(--cli-prefix-agent);
  }

  @media (max-width: 560px) {
    .runtime-label {
      display: none;
    }
  }
</style>
