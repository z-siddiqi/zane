<script lang="ts">
  import { socket } from "../lib/socket.svelte";
  import { threads } from "../lib/threads.svelte";
  import { theme } from "../lib/theme.svelte";
  import { models } from "../lib/models.svelte";
  import { worktrees } from "../lib/worktrees.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import HomeTaskComposer from "../lib/components/HomeTaskComposer.svelte";
  import WorktreeModal from "../lib/components/WorktreeModal.svelte";
  import RecentSessionsList from "../lib/components/RecentSessionsList.svelte";
  import { DEFAULT_SERVICE_TIER } from "../lib/runtime-controls";
  import type { ModeKind, Personality, ReasoningEffort } from "../lib/types";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;
  const RECENT_LIMIT = 5;

  const recentThreads = $derived(threads.list.slice(0, RECENT_LIMIT));
  const hasMoreThreads = $derived(threads.list.length > RECENT_LIMIT);

  let task = $state("");
  let project = $state("");
  let mode = $state<ModeKind>("code");
  let selectedModel = $state("");
  let reasoningEffort = $state<ReasoningEffort>("medium");
  let serviceTier = $state(DEFAULT_SERVICE_TIER);
  let personality = $state<Personality>("default");
  let worktreeModalOpen = $state(false);

  let isCreating = $state(false);
  let pendingStartToken: number | null = null;
  let pendingStartTimeout: ReturnType<typeof setTimeout> | null = null;
  let submitError = $state<string | null>(null);

  const isConnected = $derived(socket.status === "connected");
  const canSubmit = $derived(
    isConnected && task.trim().length > 0 && project.trim().length > 0 && !isCreating
  );

  const currentModelLabel = $derived(
    models.options.find((m) => m.value === selectedModel)?.label ||
      selectedModel ||
      "Select model"
  );
  const selectedModelOption = $derived(models.options.find((option) => option.value === selectedModel) ?? null);

  const worktreeDisplay = $derived.by(() => {
    if (!project) return "Select project";
    const repo = worktrees.repoRoot
      ? worktrees.repoRoot.split("/").filter(Boolean).pop()
      : null;
    const selected = worktrees.worktrees.find((wt) => wt.path === project);
    const branch = selected?.branch;
    if (repo && branch) return `${repo} / ${branch}`;
    if (repo) return repo;
    return project.split("/").filter(Boolean).pop() || project;
  });

  function clearPendingStart(token: number) {
    if (pendingStartToken !== token) return;
    pendingStartToken = null;
    isCreating = false;
    if (pendingStartTimeout) {
      clearTimeout(pendingStartTimeout);
      pendingStartTimeout = null;
    }
  }

  function handleTaskChange(value: string) {
    task = value;
  }

  function handleSelectModel(value: string) {
    selectedModel = value;
  }

  async function handleProjectConfirm(value: string) {
    project = value;
    worktreeModalOpen = false;
    worktrees.select(value);
    if (!worktrees.repoRoot) {
      await worktrees.inspect(value);
    }
  }

  async function handleSubmit() {
    if (!canSubmit || pendingStartToken !== null) return;
    submitError = null;
    const token = Date.now() + Math.floor(Math.random() * 1000);
    pendingStartToken = token;
    isCreating = true;
    pendingStartTimeout = setTimeout(() => clearPendingStart(token), 30000);

    try {
      const effectiveModel = selectedModel.trim() || models.defaultModel?.value?.trim() || "";
      const collaborationMode = effectiveModel
        ? threads.resolveCollaborationMode(mode, effectiveModel, reasoningEffort)
        : undefined;

      threads.start(project.trim(), task.trim(), {
        ...(collaborationMode ? { collaborationMode } : {}),
        serviceTier,
        ...(selectedModelOption?.supportsPersonality && personality !== "default" ? { personality } : {}),
        onThreadStarted: () => clearPendingStart(token),
        onThreadStartFailed: (error) => {
          submitError = error.message || "Failed to create task";
          clearPendingStart(token);
        },
      });
    } catch (err) {
      console.error("Failed to create task:", err);
      submitError = err instanceof Error ? err.message : "Failed to create task";
      clearPendingStart(token);
    }
  }

  $effect(() => {
    if (!selectedModel && models.defaultModel) {
      selectedModel = models.defaultModel.value;
    }
  });

  $effect(() => {
    if (!selectedModelOption) return;
    const supportedEfforts = selectedModelOption?.supportedReasoningEfforts;
    if (supportedEfforts?.length && !supportedEfforts.includes(reasoningEffort)) {
      reasoningEffort = selectedModelOption?.defaultReasoningEffort ?? supportedEfforts[0];
    }

    const supportedTiers = new Set(selectedModelOption?.serviceTiers?.map((tier) => tier.id) ?? []);
    if (serviceTier !== DEFAULT_SERVICE_TIER && !supportedTiers.has(serviceTier)) {
      serviceTier = DEFAULT_SERVICE_TIER;
    }

    if (!selectedModelOption.supportsPersonality && personality !== "default") {
      personality = "default";
    }
  });

  $effect(() => {
    if (socket.status === "connected") {
      threads.fetch();
      models.fetch();
      threads.fetchCollaborationPresets();
    }
  });
</script>

<svelte:head>
  <title>Zane</title>
</svelte:head>

<div class="home stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <a href="/settings">Settings</a>
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {themeIcons[theme.current]}
      </button>
    {/snippet}
  </AppHeader>

  {#if socket.error}
    <div class="error row">
      <span class="error-icon">✗</span>
      <span class="error-text">{socket.error}</span>
    </div>
  {/if}

  {#if submitError}
    <div class="error row">
      <span class="error-icon">!</span>
      <span class="error-text">{submitError}</span>
    </div>
  {/if}

  <main class="hero">
    <div class="hero-content">
      <HomeTaskComposer
        task={task}
        mode={mode}
        {isCreating}
        {canSubmit}
        {worktreeDisplay}
        {currentModelLabel}
        modelsStatus={models.status}
        modelOptions={models.options}
        {selectedModel}
        {reasoningEffort}
        {serviceTier}
        {personality}
        on:taskChange={(e) => handleTaskChange(e.detail.value)}
        on:toggleMode={() => {
          mode = mode === "plan" ? "code" : "plan";
        }}
        on:openWorktrees={() => {
          worktreeModalOpen = true;
        }}
        on:selectModel={(e) => handleSelectModel(e.detail.value)}
        on:selectReasoning={(e) => reasoningEffort = e.detail.value}
        on:selectServiceTier={(e) => serviceTier = e.detail.value}
        on:selectPersonality={(e) => personality = e.detail.value}
        on:submit={handleSubmit}
      />

      <RecentSessionsList
        loading={threads.loading}
        {recentThreads}
        {hasMoreThreads}
        on:refresh={() => threads.fetch()}
      />
    </div>
  </main>
</div>

<WorktreeModal
  open={worktreeModalOpen}
  {project}
  on:close={() => {
    worktreeModalOpen = false;
  }}
  on:confirm={(e) => handleProjectConfirm(e.detail.project)}
/>

<style>
  .home {
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    --stack-gap: 0;
  }

  .hero {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 3rem);
    padding: var(--space-md);
  }

  .hero-content {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-md);
    width: 100%;
    max-width: var(--app-max-width);
  }

  .error {
    --row-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-error-bg);
    border-bottom: 1px solid var(--cli-border);
    color: var(--cli-error);
  }

  .error-icon {
    font-weight: 600;
  }
</style>
