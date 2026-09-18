# Founder Console Phase B — completion

Repo: `TRCoach/TRCoaching`  
Base: `78ba1f5f4353a6c51f869835980bdadf87653cc1`  
Branch/PR: `cursor/tr-training-control-plane-fcd0` / https://github.com/TRCoach/TRCoaching/pull/1

## Architecture

- Auth: scrypt password hash, hashed session tokens, CSRF, rate limit, security headers  
- Store: versioned JSON file + memory adapter; atomic rename; fail-closed in production  
- Dispatch: Control Plane decomposes work, checks trusted mode, dispatches only allowed sub-events, collects statuses  
- Adapters: read-only interfaces; VERIFIED never used without a live verified read  

## Connected vs NOT_CONNECTED

| Adapter | Default |
| --- | --- |
| Drive, CRM, Metricool, Stripe, Superset, GitHub | NOT_CONNECTED (or DEMO_FIXTURE in explicit demo) |
| Slack | Fake transport in tests/dev; live NOT_CONNECTED until enabled |
| Cursor Cloud | v1 adapter wired; NOT_CONNECTED without server-only key |
| ChatGPT | Responses adapter wired; spend disabled / NOT_CONNECTED by default |

## Preview

`FOUNDER_CONSOLE_DEV_AUTH=1 FOUNDER_DEV_PASSWORD=… npm run console:dev` → http://127.0.0.1:8787

## Deployment approval

**Do not deploy publicly.** Recommended: private HTTPS on a VPS or Fly/Render machine reachable only via Tailscale/VPN. Storage: persistent volume for `FOUNDER_CONSOLE_DATA_DIR`. Cost: verify current host pricing before any purchase. Founder approval required before spend.

## Safety

Unauthorized writes: 0. Payments: 0. Publication: false. Paid spend: false.

## Tests

`npm test` — 47 passing (Phase A preserved + Phase B auth, CSRF, persistence, dispatch, disconnected adapters).
