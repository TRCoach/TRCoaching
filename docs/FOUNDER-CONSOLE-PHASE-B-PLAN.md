# Founder Console Phase B plan

Phase B extends the Phase A console in `TRCoach/TRCoaching`. It does not replace the 44-state/57-transition control plane or the 17-action catalogue.

## Product

Authenticated founder PWA. Exception-first dark UI. Every tile drills into evidence, owner, state, blockers and next action. Home customization never changes permissions.

## Persistence

JSON file store (`JsonFileStore`) with versioned migrations, exclusive writes, and atomic rename. `MemoryStore` for tests. Production fail-closed without `FOUNDER_CONSOLE_DATA_DIR`. Backup: copy `console-store.json` from that directory. Never persist secrets, PII, Zone C, or Drive bodies.

## Auth

Founder-only sessions, HttpOnly/SameSite cookies, CSRF on mutations, login rate limit, logout/rotation, security headers. No production default password. Dev login only with `FOUNDER_CONSOLE_DEV_AUTH=1` on localhost.

## Dispatch order

1. Authenticated PWA  
2. Read-only evidence adapters (honest NOT_CONNECTED/UNKNOWN/DEMO_FIXTURE)  
3. Slack/Grok `Grok_Alex: OPS_EVENT` (fake in tests; live needs allowlisted #ai-ops)  
4. Cursor contract (NOT_CONNECTED until a stable Cloud Agent API exists)  
5. ChatGPT contract (NOT_CONNECTED until founder spend approval)  
6. Status collection / OPS_STATUS ingestion  
7. Later: individually approved reversible writes only  

## Hard stops

Unchanged. Missing evidence is UNKNOWN, never green.
