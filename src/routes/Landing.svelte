<script lang="ts">
  import { theme } from "../lib/theme.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  let waitlistEmail = $state("");
  let waitlistBusy = $state(false);
  let waitlistMessage = $state<string | null>(null);
  let waitlistError = $state<string | null>(null);

  async function joinWaitlist() {
    if (waitlistBusy || !waitlistEmail.trim()) return;
    waitlistBusy = true;
    waitlistError = null;
    waitlistMessage = null;

    try {
      const res = await fetch("/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: waitlistEmail.trim() }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (data.ok) {
        waitlistMessage = data.message ?? "You're on the list.";
        waitlistEmail = "";
      } else {
        waitlistError = data.error ?? "Something went wrong.";
      }
    } catch {
      waitlistError = "Unable to reach server.";
    } finally {
      waitlistBusy = false;
    }
  }
</script>

<svelte:head>
  <title>Zane</title>
</svelte:head>

<div class="landing stack">
  <header class="landing-header">
    <div class="brand">zane</div>
    <button type="button" class="icon-btn" onclick={() => theme.cycle()} title="Theme: {theme.current}">
      <span class="icon-glyph">{themeIcons[theme.current]}</span>
    </button>
  </header>

  <main class="hero stack">
    <div class="hero-copy stack">
      <h1>Remote control for your local Codex.</h1>
      <p>
        Zane lets you start and supervise Codex CLI sessions running on your Mac from a handheld web client.
      </p>
      <a class="primary-btn hero-cta" href="https://github.com/z-siddiqi/zane" target="_blank" rel="noopener">Self host</a>
      <div class="waitlist stack">
        {#if waitlistMessage}
          <p class="waitlist-message">{waitlistMessage}</p>
        {:else}
          <span class="waitlist-label">or join the waitlist</span>
          <div class="waitlist-row">
            <input
              type="email"
              class="waitlist-input"
              placeholder="you@example.com"
              bind:value={waitlistEmail}
              onkeydown={(e) => { if (e.key === "Enter") joinWaitlist(); }}
            />
            <button
              class="waitlist-submit"
              type="button"
              onclick={joinWaitlist}
              disabled={waitlistBusy || !waitlistEmail.trim()}
            >
              {waitlistBusy ? "..." : "Join"}
            </button>
          </div>
          {#if waitlistError}
            <p class="waitlist-error">{waitlistError}</p>
          {/if}
        {/if}
      </div>
    </div>
  </main>

  <section class="features">
    <div class="feature">
      <span class="feature-label">Anchor</span>
      <p>A lightweight daemon on your Mac that spawns and manages Codex CLI sessions. Your code never leaves the machine.</p>
    </div>
    <div class="feature">
      <span class="feature-label">Orbit</span>
      <p>A Cloudflare relay that connects your devices to Anchor over a secure tunnel. No port-forwarding, no VPN.</p>
    </div>
    <div class="feature">
      <span class="feature-label">Handheld</span>
      <p>Approve file writes, review diffs, and steer tasks from your phone or any browser — wherever you are.</p>
    </div>
  </section>

  <footer class="landing-footer">
    <a class="footer-link" href="https://github.com/z-siddiqi/zane" target="_blank" rel="noopener">GitHub</a>
  </footer>
</div>

<style>
  .landing {
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    padding: var(--space-lg) var(--space-md);
  }

  .landing-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .brand {
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cli-prefix-agent);
  }

  .icon-btn {
    background: transparent;
    border: 1px solid var(--cli-border);
    color: var(--cli-text);
    border-radius: var(--radius-sm);
    padding: var(--space-xs) var(--space-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .icon-glyph {
    display: block;
    font-size: var(--text-sm);
    line-height: 1;
    font-family: var(--font-mono);
  }

  .hero {
    align-items: center;
    text-align: center;
    padding-top: clamp(2rem, 8vh, 5rem);
  }

  .hero-copy {
    max-width: 720px;
    --stack-gap: var(--space-lg);
  }

  .hero h1 {
    margin: 0;
    font-size: clamp(2rem, 4vw, 3.5rem);
  }

  .hero p {
    margin: 0;
    color: var(--cli-text-dim);
    line-height: 1.6;
  }

  .primary-btn {
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: pointer;
    border: 1px solid var(--cli-border);
    background: var(--color-btn-primary-bg, var(--cli-prefix-agent));
    color: var(--color-btn-primary-text, var(--cli-bg));
    text-decoration: none;
  }

  .primary-btn:hover {
    opacity: 0.9;
  }

  /* Features */
  .features {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-lg);
    max-width: 720px;
    margin: 0 auto;
    padding-top: clamp(2rem, 6vh, 4rem);
  }

  @media (min-width: 640px) {
    .features {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .feature {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .feature-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--cli-prefix-agent);
    font-weight: 600;
  }

  .feature p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--cli-text-dim);
    line-height: 1.5;
  }

  /* Footer */
  .landing-footer {
    margin-top: auto;
    padding-top: clamp(2rem, 6vh, 4rem);
    padding-bottom: var(--space-lg);
    text-align: center;
  }

  .footer-link {
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
    text-decoration: none;
    letter-spacing: 0.04em;
  }

  .footer-link:hover {
    color: var(--cli-text-dim);
  }

  /* Waitlist */
  .hero-cta {
    align-self: center;
  }

  .waitlist {
    --stack-gap: var(--space-sm);
    align-items: center;
    margin-top: calc(-1 * var(--space-xs));
  }

  .waitlist-label {
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
    letter-spacing: 0.04em;
  }

  .waitlist-row {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    max-width: 320px;
    width: 100%;
  }

  .waitlist-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-sm) var(--space-md);
    border: none;
    background: transparent;
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    outline: none;
  }

  .waitlist-input::placeholder {
    color: var(--cli-text-muted);
  }

  .waitlist-submit {
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-left: 1px solid var(--cli-border);
    background: var(--cli-bg-hover);
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .waitlist-submit:hover:not(:disabled) {
    background: var(--cli-selection);
    color: var(--cli-text);
  }

  .waitlist-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .waitlist-message {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--cli-prefix-agent);
  }

  .waitlist-error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--cli-error);
  }
</style>
