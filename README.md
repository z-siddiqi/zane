# Zane

Zane lets you monitor and control [Codex CLI](https://github.com/openai/codex) sessions running on your Mac from your phone, tablet, or any browser. Start tasks, watch real-time output, approve file writes, and review diffs from a handheld web client while your agent runs locally.

<img src="docs/assets/demo.gif" alt="Zane demo" width="320" />

## Features

- **Start tasks remotely** -- kick off Codex sessions from your phone
- **Live streaming** -- watch agent output, reasoning, and diffs in real-time
- **Approve or deny** -- handle permission prompts from anywhere
- **Review diffs** -- inspect code changes per turn before they land
- **Plan mode** -- review and approve plans before the agent writes code
- **Push notifications** -- get notified on your phone for approvals and important session events
- **No port forwarding** -- Anchor connects outbound to Cloudflare; no open ports on your Mac
- **Passkey auth** -- WebAuthn passkeys, no passwords
- **Self-host option** -- deploy the entire stack to your own Cloudflare account

## How it works

```
   Phone / Browser
         |
         | HTTPS + WebSocket
         ↓
   Orbit (Cloudflare Workers)
         ↑
         | WebSocket
         ↓
   Anchor (local daemon)
         |
         | JSON-RPC over stdio
         ↓
   Codex app-server
```

**Anchor** is a lightweight daemon on your Mac that spawns `codex app-server` and relays structured JSON-RPC messages. **Orbit** is a Cloudflare Worker + Durable Object that handles passkey auth, push notification fan-out, and WebSocket relay between your devices and Anchor. The **web client** is a static Svelte app on Cloudflare Pages.

## Deployment modes

- Default: managed Orbit control plane (no Cloudflare setup required).
- Optional: full self-host on your own Cloudflare account via `zane self-host`.

## Quick start

### Requirements

- macOS (Apple Silicon or Intel)
- [Bun](https://bun.sh) runtime
- [Codex CLI](https://github.com/openai/codex) installed and authenticated

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/z-siddiqi/zane/main/install.sh | bash
```

### Run

```bash
zane start
```

On first run:

1. A device code appears in your terminal.
2. A browser window opens for authentication.
3. You sign in with your passkey.
4. Anchor connects to Orbit and is ready for commands from the web client.

By default, this uses the managed Orbit control plane. Use `zane self-host` first if you want your own Cloudflare deployment.

## CLI

| Command | Description |
|---------|-------------|
| `zane start` | Start the Anchor service |
| `zane login` | Re-authenticate |
| `zane doctor` | Check prerequisites and configuration |
| `zane config` | Open `.env` in your editor |
| `zane update` | Pull latest and reinstall |
| `zane self-host` | Deploy to your own Cloudflare account |
| `zane uninstall` | Remove Zane |

## Self-hosting (optional)

Zane can be fully self-hosted on your own Cloudflare account:

```bash
zane self-host
```

The wizard creates a D1 database, deploys Orbit (auth + relay), builds the web client to Cloudflare Pages, and configures your Anchor. See the [self-hosting guide](docs/self-hosting.md) for prerequisites and details.

## Documentation

| Doc | Description |
|-----|-------------|
| [Installation](docs/installation.md) | Detailed install and setup guide |
| [Self-Hosting](docs/self-hosting.md) | Deploy to your own Cloudflare account |
| [Architecture](docs/architecture.md) | System design, components, and data flows |
| [Auth](docs/auth.md) | Passkey authentication and JWT details |
| [Events](docs/events.md) | JSON-RPC protocol reference |
| [Security](docs/security.md) | Threat model and security controls |
| [Repo Structure](docs/repo-structure.md) | Project directory layout |
| [Vision](docs/vision.md) | Product vision and design principles |

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
