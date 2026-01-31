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

    $effect(() => {
        if ((messages.turnStatus ?? "").toLowerCase() === "inprogress" && !turnStartTime) {
            turnStartTime = Date.now();
        } else if ((messages.turnStatus ?? "").toLowerCase() !== "inprogress") {
            turnStartTime = undefined;
        }
    });

    let sendError = $state<string | null>(null);

    function handleSubmit(inputText: string) {
        if (!inputText || !threadId) return;

        sendError = null;

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

        const result = socket.send({
            method: "turn/start",
            id: Date.now(),
            params,
        });

        if (!result.success) {
            sendError = result.error ?? "Failed to send message";
        }
    }

    function handleStop() {
        if (!threadId) return;
        const result = messages.interrupt(threadId);
        if (!result.success) {
            sendError = result.error ?? "Failed to stop turn";
        }
    }

    $effect(() => {
        if (socket.status === "connected") {
            sendError = null;
        }
    });

</script>

<div class="thread-page stack">
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
            <div class="empty row">
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
                <div class="streaming-reasoning">
                    <Reasoning
                        content={messages.streamingReasoningText}
                        isStreaming={true}
                        defaultOpen={true}
                    />
                </div>
            {/if}

            {#if (messages.turnStatus ?? "").toLowerCase() === "inprogress" && !messages.isReasoningStreaming}
                <WorkingStatus
                    detail={messages.statusDetail ?? messages.planExplanation}
                    plan={messages.plan}
                    startTime={turnStartTime}
                />
            {/if}
        {/if}

        {#if sendError || (socket.status !== "connected" && socket.status !== "connecting" && socket.error)}
            <div class="connection-error row">
                <span class="error-icon row">!</span>
                <span class="error-text">{sendError || socket.error}</span>
                {#if socket.status === "reconnecting"}
                    <span class="error-hint">Reconnecting automatically...</span>
                {:else if socket.status === "error" || socket.status === "disconnected"}
                    <button type="button" class="retry-btn" onclick={() => socket.reconnect()}>
                        Retry
                    </button>
                {/if}
            </div>
        {/if}
    </div>

    <PromptInput
        {model}
        {reasoningEffort}
        modelOptions={models.options}
        modelsLoading={models.status === "loading"}
        disabled={(messages.turnStatus ?? "").toLowerCase() === "inprogress" || !socket.isHealthy}
        onStop={(messages.turnStatus ?? "").toLowerCase() === "inprogress" ? handleStop : undefined}
        onSubmit={handleSubmit}
        onModelChange={(v) => model = v}
        onReasoningChange={(v) => reasoningEffort = v}
    />
</div>

<style>
    .thread-page {
        --stack-gap: 0;
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

    .streaming-reasoning {
        padding: var(--space-xs) var(--space-md);
    }

    .empty {
        --row-gap: var(--space-sm);
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

    .connection-error {
        --row-gap: var(--space-sm);
        margin: var(--space-sm) var(--space-md);
        padding: var(--space-sm) var(--space-md);
        background: var(--cli-error-bg);
        border: 1px solid var(--cli-error);
        border-radius: var(--radius-md);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
    }

    .error-icon {
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        background: var(--cli-error);
        color: white;
        border-radius: 50%;
        font-size: var(--text-xs);
        font-weight: bold;
        flex-shrink: 0;
        --row-gap: 0;
    }

    .error-text {
        color: var(--cli-error);
        flex: 1;
    }

    .error-hint {
        color: var(--cli-text-muted);
        font-size: var(--text-xs);
    }

    .retry-btn {
        padding: var(--space-xs) var(--space-sm);
        background: transparent;
        border: 1px solid var(--cli-error);
        border-radius: var(--radius-sm);
        color: var(--cli-error);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .retry-btn:hover {
        background: var(--cli-error);
        color: white;
    }

</style>
