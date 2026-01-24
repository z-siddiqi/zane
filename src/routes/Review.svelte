<script lang="ts">
    import { route } from "../router";
    import { config } from "../lib/config.svelte";
    import { auth } from "../lib/auth.svelte";
    import { socket } from "../lib/socket.svelte";
    import ShimmerDot from "../lib/components/ShimmerDot.svelte";
    import "../lib/styles/tokens.css";
    import PierreDiff from "../lib/components/PierreDiff.svelte";

    const statusConfig = {
        connected: { icon: "●", color: "var(--cli-success)", label: "connected" },
        connecting: { icon: "○", color: "var(--cli-text-dim)", label: "connecting" },
        disconnected: { icon: "○", color: "var(--cli-text-dim)", label: "disconnected" },
        error: { icon: "✗", color: "var(--cli-error)", label: "error" },
    } as const;

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

    interface CodeBlock {
        id: string;
        kind: "command" | "file";
        title: string;
        body: string;
        files?: string[];
        exitCode?: number | null;
        ts: string;
        turnKey: string;
        cause?: string | null;
    }

    interface TurnGroup {
        id: string;
        blocks: CodeBlock[];
    }

    const threadId = $derived(route.params.id);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let blocks = $state<CodeBlock[]>([]);

    const turnGroups = $derived(groupByTurn(blocks));
    const statusMeta = $derived(statusConfig[socket.status]);

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

    function isDiffText(text: string): boolean {
        return text.includes("diff --git") || text.includes("@@") || text.startsWith("--- ");
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

    function toPatch(path: string, diff: string): string {
        const trimmed = diff.trim();
        if (!trimmed) return "";
        if (trimmed.includes("diff --git")) return diff;
        const normalized = path.replace(/^\/+/, "");
        return [`diff --git a/${normalized} b/${normalized}`, `--- a/${normalized}`, `+++ b/${normalized}`, diff].join(
            "\n",
        );
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

    function buildBlocks(events: EventEntry[]): CodeBlock[] {
        const nextBlocks: CodeBlock[] = [];
        const fileOutputByItem = new Map<string, string>();
        const commandOutputByItem = new Map<string, string>();
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

            if (message?.method === "item/fileChange/outputDelta") {
                const params = message.params as Record<string, unknown> | undefined;
                const itemId = (params?.itemId as string | undefined) ?? (params?.item_id as string | undefined);
                const delta = (params?.delta as string | undefined) ?? "";
                if (itemId && delta) {
                    fileOutputByItem.set(itemId, (fileOutputByItem.get(itemId) ?? "") + delta);
                }
                continue;
            }

            if (message?.method === "item/commandExecution/outputDelta") {
                const params = message.params as Record<string, unknown> | undefined;
                const itemId = (params?.itemId as string | undefined) ?? (params?.item_id as string | undefined);
                const delta = (params?.delta as string | undefined) ?? "";
                if (itemId && delta) {
                    commandOutputByItem.set(itemId, (commandOutputByItem.get(itemId) ?? "") + delta);
                }
                continue;
            }

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
                continue;
            }

            if (message?.method !== "item/completed") continue;

            const params = message.params as Record<string, unknown> | undefined;
            if (!params) continue;
            const item = params.item as Record<string, unknown> | undefined;
            if (!item) continue;

            const itemType = item.type as string | undefined;
            if (itemType !== "commandExecution" && itemType !== "fileChange") continue;

            const serverTurnId = (params.turnId as string | undefined) ?? (params.turn_id as string | undefined);
            const turnKey = serverTurnId ? (turnKeyByServerId.get(serverTurnId) ?? activeTurnKey) : activeTurnKey;
            const cause = turnCauseByKey.get(turnKey) ?? null;

            if (itemType === "commandExecution") {
                const itemId = (item.id as string) || `command-${entry.ts}`;
                const command = (item.command as string) || "";
                const output = (item.aggregatedOutput as string) || commandOutputByItem.get(itemId) || "";
                const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
                const title = command ? `$ ${command}` : "Command execution";
                nextBlocks.push({
                    id: itemId,
                    kind: "command",
                    title,
                    body: output,
                    exitCode,
                    ts: entry.ts,
                    turnKey,
                    cause,
                });
            }

            if (itemType === "fileChange") {
                const itemId = (item.id as string) || `file-${entry.ts}`;
                const changes = (item.changes as Array<{ path?: string; diff?: string }>) || [];
                const files = changes.map((change) => change.path || "unknown");
                let body = changes
                    .map((change) => {
                        const path = change.path || "unknown";
                        const diff = change.diff || "";
                        return toPatch(path, diff);
                    })
                    .filter(Boolean)
                    .join("\n\n");
                if (!body.trim()) {
                    body = fileOutputByItem.get(itemId) || "";
                }
                const title = files.length ? files.join(", ") : "File change";
                nextBlocks.push({
                    id: itemId,
                    kind: "file",
                    title,
                    body,
                    files,
                    ts: entry.ts,
                    turnKey,
                    cause,
                });
            }
        }

        if (turnDiffByKey.size > 0) {
            for (const [turnKey, payload] of turnDiffByKey.entries()) {
                const cause = turnCauseByKey.get(turnKey) ?? null;
                const files = filesFromPatch(payload.diff);
                nextBlocks.push({
                    id: `turn-diff-${turnKey}`,
                    kind: "file",
                    title: "Turn diff",
                    body: payload.diff,
                    files: files.length > 0 ? files : undefined,
                    ts: payload.ts,
                    turnKey,
                    cause,
                });
            }
        }

        return nextBlocks;
    }

    function groupByTurn(items: CodeBlock[]): TurnGroup[] {
        const groups: TurnGroup[] = [];
        const index = new Map<string, TurnGroup>();

        for (const block of items) {
            let group = index.get(block.turnKey);
            if (!group) {
                group = { id: block.turnKey, blocks: [] };
                index.set(block.turnKey, group);
                groups.push(group);
            }
            group.blocks.push(block);
        }

        return groups;
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

<div class="review-page">
    <header class="review-header">
        <div class="review-header-inner">
            <a class="brand" href="/">zane</a>
            <span class="separator">·</span>
            {#if socket.status === "connecting"}
                <ShimmerDot color={statusMeta.color} />
            {:else}
                <span class="status-icon" style:color={statusMeta.color} title={statusMeta.label} aria-label={statusMeta.label}>
                    {statusMeta.icon}
                </span>
            {/if}
            {#if threadId}
                <span class="separator">·</span>
                <span class="thread-id">{threadId.slice(0, 8)}</span>
                <a class="back-link" href={`/thread/${threadId}`}>back to thread</a>
            {/if}
        </div>
    </header>

    <div class="review-body">
        {#if loading}
            <div class="state">Loading events…</div>
        {:else if error}
            <div class="state error">{error}</div>
        {:else if blocks.length === 0}
            <div class="state">No code changes found for this thread yet.</div>
        {:else}
            {#each turnGroups as turn}
                <section class="turn">
                    <div class="turn-header">Turn {turn.id}</div>
                    <div class="turn-blocks">
                        {#each turn.blocks as block}
                            <div class="block">
                                <div class="block-header">
                                    <span class="block-kind">{block.kind === "file" ? "File change" : "Command"}</span>
                                    <span class="block-title">{block.title}</span>
                                    {#if isDiffText(block.body)}
                                        <span class="diff-stats"
                                            >+{diffStats(block.body).added} −{diffStats(block.body).removed}</span
                                        >
                                    {/if}
                                    {#if block.kind === "command" && block.exitCode !== null && block.exitCode !== undefined}
                                        <span class="exit-code">exit {block.exitCode}</span>
                                    {/if}
                                </div>
                                {#if block.cause}
                                    <div class="block-cause">caused by: {truncate(block.cause)}</div>
                                {/if}
                                {#if block.body}
                                    {#if block.kind === "file"}
                                        <PierreDiff diff={block.body} />
                                    {:else}
                                        <pre class="block-body">{block.body}</pre>
                                    {/if}
                                {/if}
                            </div>
                        {/each}
                    </div>
                </section>
            {/each}
        {/if}
    </div>
</div>

<style>
    .review-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--cli-bg);
        color: var(--cli-text);
        overflow: hidden;
    }

    .review-header {
        width: 100vw;
        margin-left: calc(50% - 50vw);
        background: var(--cli-bg-elevated);
        border-bottom: 1px solid var(--cli-border);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
    }


    .review-header-inner {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        max-width: var(--app-max-width);
        margin: 0 auto;
    }

    .brand {
        font-weight: 600;
        color: var(--cli-prefix-agent);
        text-decoration: none;
    }

    .separator {
        color: var(--cli-text-muted);
    }

    .status-icon {
        line-height: 1;
    }

    .thread-id {
        color: var(--cli-text-dim);
        font-size: var(--text-xs);
    }

    .back-link {
        margin-left: auto;
        font-size: var(--text-xs);
        color: var(--cli-text-dim);
        text-decoration: none;
        border: 1px solid var(--cli-border);
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-sm);
    }

    .back-link:hover {
        color: var(--cli-text);
        border-color: var(--cli-text-muted);
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
        margin-bottom: var(--space-xl);
    }

    .turn-header {
        font-size: var(--text-xs);
        color: var(--cli-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: var(--space-sm);
    }

    .turn-blocks {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
    }

    .block {
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-sm);
        background: var(--cli-bg-elevated);
    }

    .block-header {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border-bottom: 1px solid var(--cli-border);
    }

    .block-kind {
        font-size: var(--text-xs);
        text-transform: uppercase;
        color: var(--cli-text-muted);
        letter-spacing: 0.08em;
    }

    .block-title {
        color: var(--cli-text);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .exit-code {
        font-size: var(--text-xs);
        color: var(--cli-text-muted);
    }

    .diff-stats {
        font-size: var(--text-xs);
        color: var(--cli-text-dim);
    }

    .block-cause {
        padding: var(--space-xs) var(--space-md);
        font-size: var(--text-xs);
        color: var(--cli-text-muted);
        border-bottom: 1px solid var(--cli-border);
        background: var(--cli-bg);
    }

    .block-body {
        margin: 0;
        padding: var(--space-md);
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--cli-text);
        background: var(--cli-bg);
    }

    @media (max-width: 900px) {
        .review-body {
            padding: var(--space-lg) var(--space-md);
        }
    }
</style>
