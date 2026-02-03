# Security

## Threat Model
- Unauthorized remote control of the local machine.
- Session hijacking or replay via leaked JWT.
- Exposure of sensitive data in logs or prompts.
- Abuse of the Anchor local API (if reachable beyond localhost).

## Baseline Controls

### Authentication
- Users authenticate via WebAuthn passkeys.
- Auth service issues JWTs signed with `ZANE_WEB_JWT_SECRET` (issuer `zane-auth`, audience `zane-web`).
- Anchor mints short-lived JWTs signed with `ZANE_ANCHOR_JWT_SECRET` (issuer `zane-anchor`, audience `zane-orbit-anchor`).
- Orbit validates both token types based on audience and issuer.
- Multiple users can register via passkeys.

### Transport
- HTTPS/WSS via Cloudflare (TLS).
- Anchor only opens outbound connections to Cloudflare.

### Anchor Hardening
- Local HTTP API bound to `127.0.0.1` only.
- Reject all non-local connections.

### Session Safety
- Default to Codex approval prompts for risky actions.
- Anchor does not auto-approve anything.
- Expose session state and approval requests to the client.

### Logging Hygiene
- Do not persist full logs by default.
- Redact known secrets where possible.
- Avoid sending environment variables or local file contents unless requested.

## Known Limitations
- JWT leakage on the client device (stored in `localStorage`).
- JWTs sent in WebSocket query params may appear in server logs.
- Logs may contain sensitive info if the user requests it.
- No E2E encryption between client and Anchor (Cloudflare terminates TLS).

## Planned Improvements
- Short-lived signed session tokens.
- Optional E2E encryption using per-session keys.
- Cloudflare Access policy for extra protection.
- Allowlist of commands or sandbox enforcement options.

## Operational Guidance
- Rotate JWT secrets if any device is compromised.
- Call `/auth/logout` to revoke sessions server-side.
- Each user's Anchor connects with their own credentials. Do not share Anchor credentials across users.
