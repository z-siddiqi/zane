# Anchor

Local bridge that runs `codex app-server` and relays JSON-RPC over WebSocket.

## Run

```bash
cd services/anchor
bun install
bun run dev
```

Requirements:

- Codex CLI installed and authenticated (`codex login`)
- `codex app-server` available on PATH

Optional env:

- `ANCHOR_ORBIT_URL` (e.g. `wss://orbit.<your-domain>.workers.dev/ws/anchor`)
- `ZANE_ANCHOR_JWT_SECRET` (shared secret for Orbit service-to-service auth)
- `ANCHOR_JWT_TTL_SEC` (default `300`)
- `ANCHOR_APP_CWD` (default `process.cwd()`; sent to app-server during init)
- `ANCHOR_ORBIT_RECONNECT_MS` (default `2000`)
  Env is loaded from the repo root `.env` via the run scripts.

WebSocket endpoint:

- `ws://localhost:8788/ws/anchor`
