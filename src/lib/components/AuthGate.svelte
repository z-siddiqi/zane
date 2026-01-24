<script lang="ts">
    import type { Snippet } from "svelte";
    import { auth } from "../auth.svelte";
    import "../styles/tokens.css";

    const { children }: { children: Snippet } = $props();
</script>

{#if auth.status === "loading"}
    <div class="auth-shell">
        <div class="auth-card">
            <div class="auth-title">Checking session</div>
            <div class="auth-subtitle">Waiting for passkey status...</div>
        </div>
    </div>
{:else if auth.status === "signed_in"}
    {@render children()}
{:else}
    <div class="auth-shell">
        <div class="auth-card">
            <div class="auth-title">Passkey required</div>
            <div class="auth-subtitle">Use your passkey to unlock Zane.</div>

            {#if auth.error}
                <div class="auth-error">{auth.error}</div>
            {/if}

            {#if !auth.hasPasskey}
                <div class="auth-note">No passkey is configured yet.</div>
                <button
                    type="button"
                    class="primary"
                    onclick={() => auth.register()}
                    disabled={auth.busy}
                >
                    {auth.busy ? "Working..." : "Create passkey"}
                </button>
            {:else}
                <button type="button" class="primary" onclick={() => auth.signIn()} disabled={auth.busy}>
                    {auth.busy ? "Working..." : "Sign in with passkey"}
                </button>
            {/if}
        </div>
    </div>
{/if}

<style>
    .auth-shell {
        min-height: 100vh;
        background: var(--cli-bg);
        color: var(--cli-text);
        font-family: var(--font-mono);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-xl) var(--space-md);
    }

    .auth-card {
        width: 100%;
        max-width: var(--app-max-width);
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
    }

    .auth-title {
        font-size: var(--text-lg);
        font-weight: 600;
    }

    .auth-subtitle {
        color: var(--cli-text-dim);
        font-size: var(--text-sm);
    }

    .auth-note {
        color: var(--cli-text-dim);
        font-size: var(--text-sm);
    }

    .auth-error {
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        background: var(--color-btn-danger-bg);
        color: var(--color-btn-danger-text);
        font-size: var(--text-sm);
    }

    button.primary {
        align-self: flex-start;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        border: 1px solid var(--cli-border);
        background: var(--color-btn-primary-bg);
        color: var(--color-btn-primary-text);
        font-family: var(--font-mono);
        cursor: pointer;
    }

    button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
