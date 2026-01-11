# Orbit

Cloudflare Worker + Durable Object relay between Anchor and the web client.

## Run (local)

```bash
cd services/orbit
bun install
bun run dev
```

## Endpoints

- `GET /health`
- `GET /ws/client`
- `GET /ws/anchor`

## Auth

If `ORBIT_TOKEN` is set, provide it as:
- `Authorization: Bearer <token>` header, or
- `?token=<token>` query param (for browsers)
