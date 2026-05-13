# @soto/site

Marketing site for Soto at https://sotoapp.org.

A Svelte 5 + Vite SPA served by Cloudflare Workers with a single `/api/latest` route that proxies and edge-caches the existing R2 updater manifest at `https://soto-installer.sotoapp.org/latest.json`.

## Develop

```bash
# UI hot reload (no Worker — Download section shows error state)
pnpm --filter @soto/site dev          # http://127.0.0.1:5180

# Run Worker locally against built dist/
pnpm --filter @soto/site build
pnpm --filter @soto/site preview      # wrangler dev — Download section shows real R2 data
```

## Test

```bash
pnpm --filter @soto/site test
```

## Deploy

```bash
pnpm --filter @soto/site deploy
```

First deploy publishes to `sotoapp-site.<account>.workers.dev`. Production routing to `sotoapp.org` requires the zone to live in the same Cloudflare account; `wrangler.toml`'s `routes = [{ pattern = "sotoapp.org", custom_domain = true }]` provisions the cert and binding on first deploy.

## Verification matrix (after each deploy)

| Check | How |
|---|---|
| Page loads | `curl -sI https://sotoapp.org` → 200 |
| /api/latest returns site payload | `curl -s https://sotoapp.org/api/latest \| jq '.version, .platforms."darwin-aarch64".url'` |
| /api/latest is edge-cached | Second `curl -sI` returns `cf-cache-status: HIT` |
| Hero animation runs | Manual browser check |
| Download buttons resolve to real binaries | Click each; binary downloads |
| Mobile layout (< 768px) | Devtools responsive view |
| Reduced-motion respects user pref | Devtools "emulate prefers-reduced-motion: reduce" — capsule freezes |