<script lang="ts">
  import ShimmerDot from "./ShimmerDot.svelte";
  import type { PlanStep } from "../types";

  interface Props {
    detail?: string | null;
    plan?: PlanStep[];
    startTime?: number;
  }

  let { detail = null, plan = [], startTime }: Props = $props();

  let elapsed = $state(0);

  $effect(() => {
    if (!startTime) {
      elapsed = 0;
      return;
    }

    elapsed = Math.floor((Date.now() - startTime) / 1000);

    const interval = setInterval(() => {
      elapsed = Math.floor((Date.now() - startTime) / 1000);
    }, 1000);

    return () => clearInterval(interval);
  });

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const currentStep = $derived(plan.find(s => s.status === "InProgress")?.step || detail);
</script>

<div class="working-status">
  <div class="status-line">
    <ShimmerDot color="var(--cli-prefix-agent)" />
    <span class="label">Working</span>
    <span class="progress-bar">
      <span class="bar-track">
        <span class="bar-fill"></span>
      </span>
    </span>
    {#if currentStep}
      <span class="detail">{currentStep}</span>
    {/if}
    {#if startTime}
      <span class="elapsed">(+{formatTime(elapsed)})</span>
    {/if}
  </div>

  {#if plan.length > 0}
    <div class="plan-steps">
      {#each plan as step}
        <div class="plan-step" class:completed={step.status === "Completed"} class:active={step.status === "InProgress"}>
          <span class="step-icon">
            {#if step.status === "Completed"}
              ✓
            {:else if step.status === "InProgress"}
              ›
            {:else}
              ○
            {/if}
          </span>
          <span class="step-text">{step.step}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .working-status {
    padding: var(--space-sm) var(--space-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .status-line {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    color: var(--cli-text);
  }

  .label {
    font-weight: 500;
  }

  .progress-bar {
    width: 100px;
  }

  .bar-track {
    display: block;
    height: 4px;
    background: var(--cli-border);
    border-radius: 2px;
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    width: 30%;
    background: var(--cli-prefix-agent);
    border-radius: 2px;
    animation: progress-sweep 1.5s ease-in-out infinite;
  }

  @keyframes progress-sweep {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }

  .detail {
    color: var(--cli-text-dim);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .elapsed {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }

  .plan-steps {
    margin-top: var(--space-sm);
    margin-left: var(--space-lg);
  }

  .plan-step {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) 0;
    color: var(--cli-text-muted);
  }

  .plan-step.completed {
    color: var(--cli-text-dim);
  }

  .plan-step.active {
    color: var(--cli-text);
  }

  .step-icon {
    width: 1ch;
    text-align: center;
  }

  .plan-step.completed .step-icon {
    color: var(--cli-success);
  }

  .plan-step.active .step-icon {
    color: var(--cli-prefix-agent);
  }

  .step-text {
    flex: 1;
  }
</style>
