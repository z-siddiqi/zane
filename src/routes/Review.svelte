<script lang="ts">
    import { route } from "../router";
    import { config } from "../lib/config.svelte";
    import { auth } from "../lib/auth.svelte";
    import { socket } from "../lib/socket.svelte";
    import { theme } from "../lib/theme.svelte";
    import AppHeader from "../lib/components/AppHeader.svelte";
    import PierreDiff from "../lib/components/PierreDiff.svelte";

    const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

    interface RpcMessage {
        id?: string | number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: unknown;
    }

    interface EventEntry {
        ts: string;
        direction: "client" | "server";
        message: RpcMessage;
    }

    interface FileBlock {
        id: string;
        title: string;
        body: string;
        files?: string[];
        ts: string;
        turnKey: string;
        cause?: string | null;
    }

    const threadId = $derived(route.params.id);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let blocks = $state<FileBlock[]>([]);

    function baseUrlFromWs(wsUrl: string): string | null {
        try {
            const url = new URL(wsUrl);
            url.protocol = url.protocol === "wss:" ? "https:" : "http:";
            url.pathname = "/";
            url.search = "";
            url.hash = "";
            return url.toString().replace(/\/$/, "");
        } catch {
            return null;
        }
    }

    function parseEvents(text: string): EventEntry[] {
        const events: EventEntry[] = [];
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as EventEntry;
                if (entry?.message && entry.ts) {
                    events.push(entry);
                }
            } catch {
                // ignore malformed lines
            }
        }
        return events;
    }

    function filesFromPatch(patch: string): string[] {
        const files = new Set<string>();
        const lines = patch.split(/\r?\n/);

        for (const line of lines) {
            const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            if (gitMatch) {
                const name = (gitMatch[2] || gitMatch[1]).replace(/^\"|\"$/g, "");
                if (name !== "/dev/null") files.add(name);
                continue;
            }
            const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
            if (plusMatch) {
                const name = plusMatch[1].replace(/^\"|\"$/g, "");
                if (name !== "/dev/null") files.add(name);
                continue;
            }
            const minusMatch = line.match(/^--- a\/(.+)$/);
            if (minusMatch) {
                const name = minusMatch[1].replace(/^\"|\"$/g, "");
                if (name !== "/dev/null") files.add(name);
            }
        }

        return Array.from(files);
    }

    function diffStats(text: string): { added: number; removed: number } {
        let added = 0;
        let removed = 0;
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
            if (line.startsWith("+")) added += 1;
            if (line.startsWith("-")) removed += 1;
        }
        return { added, removed };
    }

    function truncate(text: string, max = 140): string {
        const trimmed = text.trim();
        if (trimmed.length <= max) return trimmed;
        return `${trimmed.slice(0, max - 1)}…`;
    }

    function extractTurnInputText(params: Record<string, unknown> | undefined): string | null {
        const input = params?.input as Array<{ type?: string; text?: string }> | undefined;
        const text = input?.find((chunk) => chunk.type === "text")?.text;
        return text?.trim() ? text : null;
    }

    function buildBlocks(events: EventEntry[]): FileBlock[] {
        const blocks: FileBlock[] = [];
        const turnCauseByKey = new Map<string, string>();
        const turnDiffByKey = new Map<string, { diff: string; ts: string }>();
        const turnKeyByServerId = new Map<string, string>();
        let turnCounter = -1;
        let activeTurnKey = "0";

        for (const entry of events) {
            const message = entry.message;

            if (message?.method === "turn/start") {
                const params = message.params as Record<string, unknown> | undefined;
                const text = extractTurnInputText(params);
                turnCounter += 1;
                activeTurnKey = String(turnCounter);
                if (text) {
                    turnCauseByKey.set(activeTurnKey, text);
                }
                continue;
            }

            if (message?.method === "turn/started") {
                const params = message.params as Record<string, unknown> | undefined;
                const turn = params?.turn as Record<string, unknown> | undefined;
                const serverTurnId =
                    (turn?.id as string | number | undefined)?.toString() ??
                    (params?.turnId as string | undefined) ??
                    (params?.turn_id as string | undefined);
                if (serverTurnId) {
                    if (turnCounter < 0) {
                        activeTurnKey = serverTurnId;
                        const numericId = Number(serverTurnId);
                        turnCounter = Number.isFinite(numericId) ? numericId : 0;
                    }
                    turnKeyByServerId.set(serverTurnId, activeTurnKey);
                }
                continue;
            }

            if (entry.direction !== "server") continue;

            if (message?.method === "turn/diff/updated") {
                const params = message.params as Record<string, unknown> | undefined;
                const diff = (params?.diff as string | undefined) ?? "";
                if (diff) {
                    const serverTurnId =
                        (params?.turnId as string | undefined) ?? (params?.turn_id as string | undefined);
                    const turnKey = serverTurnId
                        ? (turnKeyByServerId.get(serverTurnId) ?? activeTurnKey)
                        : activeTurnKey;
                    turnDiffByKey.set(turnKey, { diff, ts: entry.ts });
                }
                continue;
            }

            if (message?.method === "item/started") {
                const params = message.params as Record<string, unknown> | undefined;
                const item = params?.item as Record<string, unknown> | undefined;
                const itemType = item?.type as string | undefined;
                if (itemType === "userMessage") {
                    const content = item?.content as Array<{ type: string; text?: string }> | undefined;
                    const text = content?.find((chunk) => chunk.type === "text")?.text;
                    const serverTurnId =
                        (params?.turnId as string | undefined) ?? (params?.turn_id as string | undefined);
                    const turnKey = serverTurnId
                        ? (turnKeyByServerId.get(serverTurnId) ?? activeTurnKey)
                        : activeTurnKey;
                    if (text && !turnCauseByKey.has(turnKey)) {
                        turnCauseByKey.set(turnKey, text);
                    }
                }
            }
        }

        for (const [turnKey, payload] of turnDiffByKey.entries()) {
            const cause = turnCauseByKey.get(turnKey) ?? null;
            const files = filesFromPatch(payload.diff);
            blocks.push({
                id: `turn-${turnKey}`,
                title: files.length > 0 ? `${files.length} files` : "Changes",
                body: payload.diff,
                files: files.length > 0 ? files : undefined,
                ts: payload.ts,
                turnKey,
                cause,
            });
        }

        return blocks;
    }

    async function loadEvents() {
        if (!threadId) return;
        const base = baseUrlFromWs(config.url);
        if (!base) {
            error = "Invalid server URL.";
            return;
        }

        loading = true;
        error = null;
        blocks = [];

        try {
            const headers: Record<string, string> = {};
            if (auth.token) {
                headers.authorization = `Bearer ${auth.token}`;
            }
            const response = await fetch(`${base}/threads/${threadId}/events`, { headers });
            if (!response.ok) {
                error = `Failed to load events (${response.status}).`;
                return;
            }
            const text = await response.text();
            const events = parseEvents(text);
            blocks = buildBlocks(events);
        } catch (err) {
            error = err instanceof Error ? err.message : "Failed to load events.";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        if (threadId) {
            loadEvents();
        }
    });
</script>

<div class="review-page stack">
    <AppHeader status={socket.status} threadId={threadId}>
        {#snippet actions()}
            <a href={`/thread/${threadId}`}>back</a>
            <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
                {themeIcons[theme.current]}
            </button>
        {/snippet}
    </AppHeader>

    <div class="review-body">
        {#if loading}
            <div class="state">Loading events…</div>
        {:else if error}
            <div class="state error">{error}</div>
        {:else if blocks.length === 0}
            <div class="state">No code changes found for this thread yet.</div>
        {:else}
            {#each blocks as block (block.id)}
                {@const stats = diffStats(block.body)}
                <details class="turn">
                    <summary class="turn-header split">
                        <span class="turn-label">{block.cause ? truncate(block.cause, 80) : `Turn ${block.turnKey}`}</span>
                        <span class="turn-meta row">
                            <span class="turn-stats">
                                <span class="diff-added">+{stats.added}</span>
                                <span class="diff-removed">-{stats.removed}</span>
                            </span>
                            <span class="turn-toggle"></span>
                        </span>
                    </summary>
                    <div class="turn-content">
                        <PierreDiff diff={block.body} />
                    </div>
                </details>
            {/each}
        {/if}
    </div>
</div>

<style>
    .review-page {
        --stack-gap: 0;
        height: 100%;
        background: var(--cli-bg);
        color: var(--cli-text);
    }

    .review-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: var(--space-lg) var(--space-xl);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
    }

    .state {
        color: var(--cli-text-muted);
        padding: var(--space-md);
    }

    .state.error {
        color: var(--cli-error);
    }

    .turn {
        margin-bottom: var(--space-lg);
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-md);
        background: var(--cli-bg-elevated);
    }

    .turn-header {
        --split-gap: var(--space-sm);
        list-style: none;
        cursor: pointer;
        padding: var(--space-sm) var(--space-md);
        font-size: var(--text-xs);
        color: var(--cli-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: all var(--transition-fast);
    }

    .turn-header::-webkit-details-marker {
        display: none;
    }

    .turn-header:hover {
        background: var(--cli-bg-hover);
        color: var(--cli-text);
    }

    .turn[open] .turn-header {
        border-bottom: 1px solid var(--cli-border);
    }

    .turn-label {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        text-transform: none;
        letter-spacing: 0;
    }

    .turn-meta {
        --row-gap: var(--space-sm);
        flex-shrink: 0;
    }

    .turn-stats {
        font-size: var(--text-xs);
        text-transform: none;
        letter-spacing: 0;
    }

    .turn-toggle {
        width: 1rem;
        text-align: center;
        color: var(--cli-text-muted);
    }

    .turn-toggle::before {
        content: "+";
    }

    .turn[open] .turn-toggle::before {
        content: "−";
    }

    .turn-content {
        background: var(--cli-bg);
    }

    .diff-added {
        color: var(--cli-success);
    }

    .diff-removed {
        color: var(--cli-error);
    }

    @media (max-width: 900px) {
        .review-body {
            padding: var(--space-lg) var(--space-md);
        }
    }
</style>
