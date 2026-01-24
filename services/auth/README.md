# Auth

Cloudflare Worker that provides passkey authentication for Zane.

## Setup

1. Create a D1 database and update `services/auth/wrangler.toml` with the `database_id`.
2. Apply migrations:

```bash
cd services/auth
bunx wrangler d1 migrations apply zane-auth --remote
```

## Run (local)

```bash
cd services/auth
bunx wrangler dev
```

## Required secrets

Set via `wrangler secret put`:

- `ZANE_WEB_JWT_SECRET` - Secret for signing JWTs
- `PASSKEY_ORIGIN` - Production origin (e.g. `https://zane-7va.pages.dev`)

## How it works

This is a single-user auth system:

1. **First visit**: No passkey exists, so anyone can register (first come, first served)
2. **After setup**: Must sign in with existing passkey to access the app
3. **Adding devices**: Sign in first, then register another passkey from the new device

## Adding a new passkey

To add a passkey on another device, sign in first, then run this in the browser console:

```javascript
const { startRegistration } = await import('@simplewebauthn/browser');

const opts = await fetch('/auth/register/options', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('zane_auth_token')}`
  }
}).then(r => r.json());

const credential = await startRegistration({ optionsJSON: opts });

await fetch('/auth/register/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('zane_auth_token')}`
  },
  body: JSON.stringify({ credential })
}).then(r => r.json());
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/session` | Get auth status |
| POST | `/auth/register/options` | Start passkey registration |
| POST | `/auth/register/verify` | Complete registration |
| POST | `/auth/login/options` | Start passkey login |
| POST | `/auth/login/verify` | Complete login |
