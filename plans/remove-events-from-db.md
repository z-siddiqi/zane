# Remove Events Table from D1 and Remove Review Page

## Context

The `events` table in Cloudflare D1 stores a filtered subset of JSON-RPC relay
messages (turns, items, diffs, approvals, user input) from the Orbit WebSocket
relay.

Reconnection already uses `thread/resume` via the Codex app-server and local
rollout files, so D1 events are no longer needed for reconnect behavior.

We considered keeping `/thread/:id/review` by switching it to `thread/read`, but
that history is intentionally lossy for audit-style playback (notably diffs and
approval/user-input lifecycle details). Instead, we will remove the Review page
for now and add a stronger git-based review workflow later.

Removing events storage and the Review page eliminates duplicate persistence,
D1 storage costs, and relay-side event logging complexity.

## Changes

### 1. Remove events schema from migration
**File:** `migrations/001_create_tables.sql`
- In `001_create_tables.sql`, remove the `events` table and its indexes
  (`idx_events_thread`, `idx_events_method`, `idx_events_user_thread`) for fresh installs.

### 2. Remove event storage from Orbit relay
**File:** `services/orbit/src/relay/orbit-relay-do.ts`
- Delete `STORED_METHODS`.
- Delete `pendingRequestRpcIds`.
- Delete `logEvent()`.
- Remove `this.logEvent(event.data, direction)` call.
- Remove now-unused `extractTurnId` import.

### 3. Remove events HTTP endpoint
**Files:** `services/orbit/src/http/events.ts`, `services/orbit/src/http/router.ts`
- Delete `services/orbit/src/http/events.ts`.
- Remove `OPTIONS /threads/:id/events` and `GET /threads/:id/events` routes from router.
- Remove now-unused imports (`orbitCorsHeaders`, `fetchThreadEvents`, `isAuthorised`).

### 4. Remove Review page from the web app
**Files:** `src/routes/Review.svelte`, `src/router.ts`, `src/routes/Thread.svelte`
- Delete `src/routes/Review.svelte`.
- Remove `Review` import and `"/thread/:id/review"` route from `src/router.ts`.
- Remove the `review` action link from `Thread.svelte` header actions.

### 5. Update documentation
- `docs/architecture.md`: remove references to D1 event persistence and `GET /threads/:id/events`.
- `docs/events.md`: remove Event Persistence / stored-events section.
- `docs/security.md`: remove references to persisted relay events in D1.
- `docs/auth.md`: remove events-endpoint auth example and WS/events wording.
- `docs/self-hosting.md`: update D1 description (no events storage).
- `services/orbit/README.md`: remove events endpoint and D1 events-storage references.

## What stays unchanged

- Push notifications: `sendPushNotifications()` in `orbit-relay-do.ts` is independent.
- `_replay` flag behavior in Anchor: unchanged.
- Reconnection via `thread/resume`: unchanged.
- Core chat/thread workflow: unchanged.

## Key files

| File | Action |
|------|--------|
| `migrations/001_create_tables.sql` | Edit - remove events table |
| `services/orbit/src/relay/orbit-relay-do.ts` | Edit - remove event storage |
| `services/orbit/src/http/events.ts` | Delete |
| `services/orbit/src/http/router.ts` | Edit - remove events routes |
| `src/routes/Review.svelte` | Delete |
| `src/router.ts` | Edit - remove Review route |
| `src/routes/Thread.svelte` | Edit - remove review link |
| `docs/architecture.md`, `docs/events.md`, `docs/security.md`, `docs/auth.md`, `docs/self-hosting.md`, `services/orbit/README.md` | Edit - update docs |

## Tradeoff

- `/thread/:id/review` is removed for now.
- Historical diff/audit viewing is deferred until a future git-based review mechanism lands.

## Verification

1. `bunx tsc -p services/orbit/tsconfig.json` - Orbit TypeScript compile passes.
2. `bunx tsc -p tsconfig.json` - web app TypeScript compile passes.
3. Verify no references remain to:
   - `/threads/:id/events`
   - `fetchThreadEvents`
   - `services/orbit/src/http/events.ts`
   - `/thread/:id/review` route or `Review.svelte` import
4. Open a thread page and confirm there is no Review link in header actions.
5. Confirm relay messaging/push behavior still works (event logging removed was non-blocking).
