<script lang="ts">
    import { route } from "../router";
    import { socket } from "../lib/socket.svelte";
    import { threads } from "../lib/threads.svelte";
    import { messages } from "../lib/messages.svelte";
    import SessionHeader from "../lib/components/SessionHeader.svelte";
    import MessageBlock from "../lib/components/MessageBlock.svelte";
    import ApprovalPrompt from "../lib/components/ApprovalPrompt.svelte";
    import WorkingStatus from "../lib/components/WorkingStatus.svelte";
    import "../lib/styles/tokens.css";

    let input = $state("");
    let container: HTMLDivElement | undefined;
    let turnStartTime = $state<number | undefined>(undefined);

    const threadId = $derived(route.params.id);

    $effect(() => {
        if (threadId && socket.status === "connected" && threads.currentId !== threadId) {
            threads.open(threadId);
        }
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

    function handleSubmit(e: Event) {
        e.preventDefault();
        if (!input.trim() || !threadId) return;

        socket.send({
            method: "turn/start",
            id: Date.now(),
            params: {
                threadId,
                input: [{ type: "text", text: input.trim() }],
            },
        });

        input = "";
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    }
</script>

<div class="thread-page">
    <SessionHeader
        status={socket.status}
        threadId={threadId}
        model={threads.current?.modelProvider}
    />

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

            {#if messages.turnStatus === "InProgress"}
                <WorkingStatus
                    detail={messages.statusDetail ?? messages.planExplanation}
                    plan={messages.plan}
                    startTime={turnStartTime}
                />
            {/if}
        {/if}
    </div>

    <form class="input-area" onsubmit={handleSubmit}>
        <span class="prompt">&gt;</span>
        <textarea
            bind:value={input}
            onkeydown={handleKeydown}
            placeholder="Type a message..."
            rows="1"
        ></textarea>
        <button type="submit" class="send-btn" disabled={!input.trim()}>
            Send
        </button>
    </form>
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

    /* Input area */
    .input-area {
        display: flex;
        align-items: flex-start;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border-top: 1px solid var(--cli-border);
        background: var(--cli-bg-elevated);
    }

    .prompt {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        color: var(--cli-prefix-agent);
        padding-top: var(--space-sm);
        font-weight: 600;
    }

    textarea {
        flex: 1;
        padding: var(--space-sm);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        line-height: 1.5;
        color: var(--cli-text);
        background: transparent;
        border: none;
        resize: none;
        min-height: 1.5em;
        max-height: 10em;
        field-sizing: content;
    }

    textarea:focus {
        outline: none;
    }

    textarea::placeholder {
        color: var(--cli-text-muted);
    }

    .send-btn {
        padding: var(--space-sm) var(--space-md);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        color: var(--cli-bg);
        background: var(--cli-prefix-agent);
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: opacity var(--transition-fast);
    }

    .send-btn:hover:not(:disabled) {
        opacity: 0.9;
    }

    .send-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
</style>
