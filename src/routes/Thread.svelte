<script lang="ts">
    import type { ReasoningEffort, SandboxMode } from "../lib/types";
    import { route } from "../router";
    import { socket } from "../lib/socket.svelte";
    import { threads } from "../lib/threads.svelte";
    import { messages } from "../lib/messages.svelte";
    import { models } from "../lib/models.svelte";
    import { theme } from "../lib/theme.svelte";
    import { auth } from "../lib/auth.svelte";
    import AppHeader from "../lib/components/AppHeader.svelte";
    import MessageBlock from "../lib/components/MessageBlock.svelte";
    import ApprovalPrompt from "../lib/components/ApprovalPrompt.svelte";
    import WorkingStatus from "../lib/components/WorkingStatus.svelte";
    import Reasoning from "../lib/components/Reasoning.svelte";
    import PromptInput from "../lib/components/PromptInput.svelte";
    import "../lib/styles/tokens.css";

    const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

    let model = $state("");
    let reasoningEffort = $state<ReasoningEffort>("medium");
    let sandbox = $state<SandboxMode>("workspace-write");
    let container: HTMLDivElement | undefined;
    let turnStartTime = $state<number | undefined>(undefined);

    const threadId = $derived(route.params.id);

    $effect(() => {
        if (threadId && socket.status === "connected" && threads.currentId !== threadId) {
            threads.open(threadId);
        }
    });

    $effect(() => {
        if (!threadId) return;
        const settings = threads.getSettings(threadId);
        model = settings.model;
        reasoningEffort = settings.reasoningEffort;
        sandbox = settings.sandbox;
    });

    $effect(() => {
        if (!threadId) return;
        threads.updateSettings(threadId, { model, reasoningEffort, sandbox });
    });

    $effect(() => {
        if (messages.current.length && container) {
            container.scrollTop = container.scrollHeight;
        }
    });

    // Track turn start time for elapsed timer
    $effect(() => {
        if (messages.turnStatus === "InProgress" && !turnStartTime) {
            turnStartTime = Date.now();
        } else if (messages.turnStatus !== "InProgress") {
            turnStartTime = undefined;
        }
    });

    function handleSubmit(inputText: string) {
        if (!inputText || !threadId) return;

        const params: Record<string, unknown> = {
            threadId,
            input: [{ type: "text", text: inputText }],
        };

        if (model.trim()) {
            params.model = model.trim();
        }
        if (reasoningEffort) {
            params.reasoningEffort = reasoningEffort;
        }
        if (sandbox) {
            params.sandbox = sandbox;
        }

        socket.send({
            method: "turn/start",
            id: Date.now(),
            params,
        });
    }
</script>

<div class="thread-page">
    <AppHeader
        status={socket.status}
        threadId={threadId}
        {sandbox}
        onSandboxChange={(v) => sandbox = v}
    >
        {#snippet actions()}
            <a href={`/thread/${threadId}/review`}>review</a>
            <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
                {themeIcons[theme.current]}
            </button>
            <button type="button" onclick={() => auth.signOut()} title="Sign out">⏻</button>
        {/snippet}
    </AppHeader>

    <div class="transcript" bind:this={container}>
        {#if messages.current.length === 0}
            <div class="empty">
                <span class="empty-prompt">&gt;</span>
                <span class="empty-text">No messages yet. Start a conversation.</span>
            </div>
        {:else}
            {#each messages.current as message (message.id)}
                {#if message.role === "approval" && message.approval}
                    <ApprovalPrompt
                        approval={message.approval}
                        onApprove={(forSession) => messages.approve(message.approval!.id, forSession)}
                        onDecline={() => messages.decline(message.approval!.id)}
                        onCancel={() => messages.cancel(message.approval!.id)}
                    />
                {:else}
                    <MessageBlock {message} />
                {/if}
            {/each}

            {#if messages.isReasoningStreaming}
                <Reasoning
                    content={messages.streamingReasoningText}
                    isStreaming={true}
                    defaultOpen={true}
                />
            {/if}

            {#if messages.turnStatus === "InProgress" && !messages.isReasoningStreaming}
                <WorkingStatus
                    detail={messages.statusDetail ?? messages.planExplanation}
                    plan={messages.plan}
                    startTime={turnStartTime}
                />
            {/if}
        {/if}
    </div>

    <PromptInput
        {model}
        {reasoningEffort}
        modelOptions={models.options}
        modelsLoading={models.status === "loading"}
        disabled={messages.turnStatus === "InProgress"}
        onSubmit={handleSubmit}
        onModelChange={(v) => model = v}
        onReasoningChange={(v) => reasoningEffort = v}
    />
</div>

<style>
    .thread-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--cli-bg);
    }

    /* Transcript */
    .transcript {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--space-sm) 0;
    }

    .empty {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-xl) var(--space-md);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
    }

    .empty-prompt {
        color: var(--cli-prefix-agent);
    }

    .empty-text {
        color: var(--cli-text-muted);
    }
</style>
