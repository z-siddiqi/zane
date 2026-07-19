<script lang="ts">
  import type { ModeKind, ModelOption, ReasoningEffort, Skill, FuzzyFileResult } from "../types";
  import { socket } from "../socket.svelte";

  interface Props {
    model: string;
    reasoningEffort: ReasoningEffort;
    mode?: ModeKind;
    modelOptions?: ModelOption[];
    modelsLoading?: boolean;
    turnActive?: boolean;
    skills?: Skill[];
    onStop?: () => void;
    onSubmit: (input: string) => void;
    onSteer?: (input: string) => void;
    onQueue?: (input: string) => void;
    onModelChange: (model: string) => void;
    onReasoningChange: (effort: ReasoningEffort) => void;
    onModeChange?: (mode: ModeKind) => void;
  }

  const {
    model,
    reasoningEffort,
    mode = "code",
    modelOptions = [],
    modelsLoading = false,
    turnActive = false,
    skills = [],
    onStop,
    onSubmit,
    onSteer,
    onQueue,
    onModelChange,
    onReasoningChange,
    onModeChange,
  }: Props = $props();

  let input = $state("");
  let modelOpen = $state(false);
  let reasoningOpen = $state(false);
  let textareaEl: HTMLTextAreaElement | undefined;

  // Skills autocomplete state
  let skillsOpen = $state(false);
  let skillsFilter = $state("");
  let skillsIndex = $state(0);

  // File @-mention autocomplete state
  let mentionOpen = $state(false);
  let mentionQuery = $state("");
  let mentionResults = $state<FuzzyFileResult[]>([]);
  let mentionIndex = $state(0);
  let mentionSearchTimeout: ReturnType<typeof setTimeout> | undefined;

  const canSubmit = $derived(input.trim().length > 0);

  const reasoningOptions: { value: ReasoningEffort; label: string }[] = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  const selectedModelOption = $derived(modelOptions.find((m) => m.value === model));
  const availableReasoningOptions = $derived.by(() => {
    const supported = selectedModelOption?.supportedReasoningEfforts;
    if (!supported?.length) return reasoningOptions;
    const map = new Map(reasoningOptions.map((option) => [option.value, option]));
    const filtered = supported
      .map((effort) => map.get(effort))
      .filter((option): option is { value: ReasoningEffort; label: string } => Boolean(option));
    return filtered.length > 0 ? filtered : reasoningOptions;
  });

  const selectedModel = $derived(
    modelOptions.find((m) => m.value === model)?.label || model || "Model"
  );

  const selectedReasoning = $derived(
    availableReasoningOptions.find((r) => r.value === reasoningEffort)?.label ||
      reasoningOptions.find((r) => r.value === reasoningEffort)?.label ||
      "Medium"
  );

  const filteredSkills = $derived.by(() => {
    if (!skillsOpen) return [];
    const q = skillsFilter.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    closeAutocomplete();

    const trimmed = input.trim();

    if (turnActive && onSteer) {
      onSteer(trimmed);
    } else if (turnActive && onQueue) {
      onQueue(trimmed);
    } else {
      onSubmit(trimmed);
    }
    input = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    // Handle autocomplete navigation
    if (skillsOpen && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); skillsIndex = (skillsIndex + 1) % filteredSkills.length; return; }
      if (e.key === "ArrowUp") { e.preventDefault(); skillsIndex = (skillsIndex - 1 + filteredSkills.length) % filteredSkills.length; return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); selectSkill(filteredSkills[skillsIndex]); return; }
      if (e.key === "Escape") { e.preventDefault(); closeAutocomplete(); return; }
    }

    if (mentionOpen && mentionResults.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); mentionIndex = (mentionIndex + 1) % mentionResults.length; return; }
      if (e.key === "ArrowUp") { e.preventDefault(); mentionIndex = (mentionIndex - 1 + mentionResults.length) % mentionResults.length; return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); selectMention(mentionResults[mentionIndex]); return; }
      if (e.key === "Escape") { e.preventDefault(); closeAutocomplete(); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleInput() {
    const value = input;
    const cursorPos = textareaEl?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);

    // Check for / at start of input for skills
    const slashMatch = textBeforeCursor.match(/^\/(\S*)$/);
    if (slashMatch && skills.length > 0) {
      skillsFilter = slashMatch[1];
      skillsIndex = 0;
      skillsOpen = true;
      mentionOpen = false;
      return;
    }
    skillsOpen = false;

    // Check for @ trigger for file mentions
    const atMatch = textBeforeCursor.match(/@(\S+)$/);
    if (atMatch && atMatch[1].length >= 1) {
      mentionQuery = atMatch[1];
      mentionIndex = 0;
      mentionOpen = true;
      skillsOpen = false;
      if (mentionSearchTimeout) clearTimeout(mentionSearchTimeout);
      mentionSearchTimeout = setTimeout(() => searchFiles(mentionQuery), 150);
      return;
    }
    mentionOpen = false;
  }

  function selectSkill(skill: Skill) {
    input = `/${skill.name} `;
    skillsOpen = false;
    textareaEl?.focus();
  }

  function selectMention(result: FuzzyFileResult) {
    const cursorPos = textareaEl?.selectionStart ?? input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf("@");
    if (atIdx >= 0) {
      input = input.slice(0, atIdx) + "@" + result.path + " " + input.slice(cursorPos);
    }
    mentionOpen = false;
    textareaEl?.focus();
  }

  async function searchFiles(query: string) {
    if (!socket.isHealthy) return;
    try {
      const results = await socket.fuzzyFileSearch(query, 8);
      if (mentionOpen && mentionQuery === query) {
        mentionResults = results;
      }
    } catch {
      mentionResults = [];
    }
  }

  function closeAutocomplete() {
    skillsOpen = false;
    mentionOpen = false;
  }

  function closeAllDropdowns() {
    modelOpen = false;
    reasoningOpen = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".dropdown")) {
      closeAllDropdowns();
    }
    if (!target.closest(".autocomplete-menu") && !target.closest("textarea")) {
      closeAutocomplete();
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<form class="prompt-input" onsubmit={handleSubmit}>
  <div class="input-container stack">
    <div class="textarea-wrapper">
      <textarea
        bind:this={textareaEl}
        bind:value={input}
        onkeydown={handleKeydown}
        oninput={handleInput}
        placeholder={turnActive
          ? (onQueue ? "Queue a follow-up or steer the turn..." : "Steer the current turn...")
          : "What would you like to do?"}
        rows="1"
      ></textarea>

      <!-- Skills autocomplete -->
      {#if skillsOpen && filteredSkills.length > 0}
        <div class="autocomplete-menu">
          {#each filteredSkills as skill, i}
            <button
              type="button"
              class="autocomplete-item"
              class:focused={i === skillsIndex}
              onclick={() => selectSkill(skill)}
            >
              <span class="ac-name">/{skill.name}</span>
              {#if skill.description}
                <span class="ac-desc">{skill.description}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      <!-- File @-mention autocomplete -->
      {#if mentionOpen && mentionResults.length > 0}
        <div class="autocomplete-menu">
          {#each mentionResults as result, i}
            <button
              type="button"
              class="autocomplete-item"
              class:focused={i === mentionIndex}
              onclick={() => selectMention(result)}
            >
              <span class="ac-name">@{result.path}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="footer split">
      <div class="tools row">
        <!-- Model Selector -->
        <div class="dropdown" class:open={modelOpen}>
          <button
            type="button"
            class="tool-btn row"
            onclick={(e) => {
              e.stopPropagation();
              modelOpen = !modelOpen;
              reasoningOpen = false;
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z"/>
              <circle cx="12" cy="14" r="2"/>
            </svg>
            <span class="collapsible-label">{selectedModel}</span>
            <svg class="chevron collapsible-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          {#if modelOpen}
            <div class="dropdown-menu">
              {#if modelsLoading}
                <div class="dropdown-empty">Loading...</div>
              {:else if modelOptions.length === 0}
                <div class="dropdown-empty">No models available</div>
              {:else}
                {#each modelOptions as option}
                  <button
                    type="button"
                    class="dropdown-item split"
                    class:selected={model === option.value}
                    onclick={() => {
                      onModelChange(option.value);
                      modelOpen = false;
                    }}
                  >
                    {option.label}
                    {#if model === option.value}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Reasoning Selector -->
        <div class="dropdown" class:open={reasoningOpen}>
          <button
            type="button"
            class="tool-btn row"
            onclick={(e) => {
              e.stopPropagation();
              reasoningOpen = !reasoningOpen;
              modelOpen = false;
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
              <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
              <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
              <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
              <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
              <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
              <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
              <path d="M6 18a4 4 0 0 1-1.967-.516"/>
              <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
            </svg>
            <span class="collapsible-label">{selectedReasoning}</span>
            <svg class="chevron collapsible-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          {#if reasoningOpen}
            <div class="dropdown-menu">
              {#each availableReasoningOptions as option}
                <button
                  type="button"
                  class="dropdown-item split"
                  class:selected={reasoningEffort === option.value}
                  onclick={() => {
                    onReasoningChange(option.value);
                    reasoningOpen = false;
                  }}
                >
                  {option.label}
                  {#if reasoningEffort === option.value}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Mode Toggle -->
        {#if onModeChange}
          <button
            type="button"
            class="tool-btn mode-toggle row"
            class:active={mode === "plan"}
            onclick={() => onModeChange(mode === "plan" ? "code" : "plan")}
          >
            {#if mode === "plan"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
              <span>Plan</span>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
              </svg>
              <span>Code</span>
            {/if}
          </button>
        {/if}
      </div>

      <div class="action-buttons row">
        {#if turnActive && onStop}
          <button type="button" class="stop-btn row" onclick={onStop} title="Stop">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1"/>
            </svg>
          </button>
        {/if}
        <button type="submit" class="submit-btn row" disabled={!canSubmit} title={turnActive && onQueue ? "Queue follow-up" : "Send"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 17 5-5-5-5"/>
            <path d="m13 17 5-5-5-5"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</form>

<style>
  .prompt-input {
    padding: var(--space-md);
  }

  .input-container {
    --stack-gap: 0;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    background: var(--cli-bg);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .input-container:focus-within {
    border-color: var(--cli-text-muted);
    box-shadow: var(--shadow-focus);
  }

  .textarea-wrapper {
    position: relative;
  }

  textarea {
    flex: 1;
    width: 100%;
    padding: var(--space-md);
    font-family: var(--font-mono);
    line-height: 1.6;
    color: var(--cli-text);
    background: transparent;
    border: none;
    resize: none;
    min-height: 4rem;
    max-height: 12rem;
    field-sizing: content;
    box-sizing: border-box;
  }

  textarea:focus {
    outline: none;
  }

  textarea::placeholder {
    color: var(--cli-text-muted);
  }

  /* Autocomplete menu */
  .autocomplete-menu {
    position: absolute;
    bottom: 100%;
    left: var(--space-md);
    right: var(--space-md);
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: var(--space-xs);
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    z-index: 200;
    animation: fadeIn 0.1s ease;
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    background: transparent;
    border: none;
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .autocomplete-item:hover,
  .autocomplete-item.focused {
    background: var(--cli-bg-hover);
  }

  .ac-name {
    color: var(--cli-prefix-agent);
    font-weight: 500;
    flex-shrink: 0;
  }

  .ac-desc {
    color: var(--cli-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footer {
    --split-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--cli-border);
  }

  .tools {
    --row-gap: var(--space-xs);
  }

  /* Tool buttons */
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

  .dropdown-item {
    --split-gap: var(--space-sm);
    width: 100%;
    padding: var(--space-sm) var(--space-sm);
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

  .dropdown-empty {
    padding: var(--space-sm);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .dropdown-item svg {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
  }

  .action-buttons {
    --row-gap: var(--space-xs);
  }

  /* Submit button */
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

  .stop-btn {
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--cli-error);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity var(--transition-fast);
    --row-gap: 0;
  }

  .stop-btn svg {
    width: 1rem;
    height: 1rem;
    color: var(--cli-bg);
  }

  .stop-btn:hover {
    opacity: 0.85;
  }

  @media (max-width: 480px) {
    .collapsible-label {
      display: none;
    }
  }

</style>
