# Architecture

## High-Level Diagram

```
      Web Client (mobile)
              |
              | HTTPS + WebSocket
              v
       Orbit (control plane)
              |
              | WebSocket relay (outbound from Mac)
              v
   Anchor (local bridge, macOS)
              |
              | JSON-RPC over stdio
              v
        codex app-server
```

## Components

### 1) Anchor (local bridge, macOS)
Responsibilities:
- Start and manage a `codex app-server` process.
- Relay JSON-RPC messages between the web client and app-server.
- Accept input/keystrokes from the remote client.
- Handle approvals using app-server request/response flow.
Process model:
- Single `codex app-server` process with multiple threads (one per session).

Tech:
- Bun runtime.
- JSON-RPC line protocol (JSONL over stdio).
- JWT auth to connect to Orbit.

### 2) Orbit (control plane)
Responsibilities:
- Handle passkey authentication and issue JWTs for web clients.
- Authenticate clients (via user JWT) and Anchor (via service JWT).
- Create a Durable Object per user (`idFromName(userId)`). All threads for a user share one DO.
- Relay WebSocket messages between Anchor and client, routed by thread subscription.

Tech:
- Cloudflare Workers + Durable Objects + D1.
- WebAuthn for passkey auth.

### 3) Web Client (Mobile Web)
Responsibilities:
- Authenticate via passkeys.
- Show list of threads and live output.
- Send approvals and input.
- Reconnect on network loss.

Tech:
- Bun + Vite + Svelte.
- WebSocket client with reconnection logic.
Hosting:
- Static build deployed to Cloudflare Pages.

## Data Flows

### A) Authentication
1. Client registers/logs in via passkey at Orbit auth endpoints.
2. Orbit returns a JWT (stored in localStorage).
3. Client uses JWT to connect to Orbit.

### B) Session (from Web Client)
1. Client connects to Orbit WebSocket with JWT.
2. Orbit verifies JWT and routes the socket to the user's Durable Object.
3. Client sends `orbit.subscribe` with a `threadId` to receive events for that thread.
4. Anchor connects to Orbit WebSocket with its own service JWT (same DO, same user).
5. Client sends `thread/start` and `turn/start` JSON-RPC calls.
6. DO forwards JSON-RPC to Anchor; Anchor relays to `codex app-server`.
7. App-server notifications are routed back to clients subscribed to the thread.

### C) Approval Flow
1. `codex app-server` emits `item/*/requestApproval` JSON-RPC request.
2. Anchor forwards to client via WebSocket.
3. Client responds with `{ "decision": "accept" | "decline" }`.
4. Anchor forwards the decision to app-server.

## Message Protocol (JSON over WebSocket)

For MVP, Anchor relays `codex app-server` JSON-RPC messages directly over WebSocket.
This avoids PTY parsing and provides structured events (command output, file diffs,
approvals). The web client can use the generated schema from:

```
codex app-server generate-ts --out DIR
```

Orbit adds its own control messages:
- `orbit.hello` — sent to each socket on connect
- `anchor.hello` — sent by Anchor with hostname/platform metadata
- `orbit.subscribe` / `orbit.unsubscribe` — thread subscription management
- `orbit.list-anchors` / `orbit.anchors` — connected device listing
- `orbit.anchor-connected` / `orbit.anchor-disconnected` — device status notifications
- `ping` / `pong` — WebSocket keepalives

## Orbit Endpoints

### `GET /ws/client`
WebSocket endpoint for the web client. Requires JWT with `zane-web` audience.

### `GET /ws/anchor`
WebSocket endpoint for Anchor. Requires JWT with `zane-orbit-anchor` audience.

## Auth Endpoints (served by Orbit)

### `GET /health`
Health check.

### `GET /auth/session`
Validate current JWT and return session info.

### `POST /auth/register/options`
Start passkey registration (returns WebAuthn options).

### `POST /auth/register/verify`
Complete passkey registration and return JWT.

### `POST /auth/login/options`
Start passkey login (returns WebAuthn challenge).

### `POST /auth/login/verify`
Complete passkey login and return JWT.

### `POST /auth/logout`
Revoke the current session.

### `POST /auth/device/code`
Request a device code for CLI authentication.

### `POST /auth/device/token`
Poll for a JWT after device code authorisation.

### `POST /auth/device/authorise`
Authorise a pending device code from the web client.

## Durable Object State (per user)

The `OrbitRelay` DO manages all sockets for a single user. Internal state:
- `clientSockets` — map of client WebSockets to their subscribed thread IDs
- `anchorSockets` — map of Anchor WebSockets to their subscribed thread IDs
- `anchorMeta` — metadata (hostname, platform, connection time) per Anchor socket
- `threadToClients` / `threadToAnchors` — reverse index for fast thread-scoped routing

## Security
- Passkey auth for users (WebAuthn).
- JWT tokens for session management.
- Separate secrets for user JWTs and Anchor service JWTs.
- All traffic is TLS over Cloudflare.

See `docs/auth.md` and `docs/security.md` for details.
