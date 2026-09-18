# Founder Console Phase C architecture

Hosting: Cloudflare Workers Free + D1 Free. Default HTTPS URL is `*.workers.dev`. D1 Free Time Travel is a 7-day point-in-time restore. A later Workers Paid upgrade starts at $5/month and needs separate founder approval. This repo does not activate a paid plan.

## Boundaries

- Existing 44-state / 57-transition model, 17 founder actions, trusted-mode registry, and Phase B dispatch are unchanged.
- Founder command → Control Plane → decomposition → permission/evidence → dispatch → execution → verified read-back → Console.
- Drive remains policy SoT. No private Drive IDs, KB, secrets, client PII, or Zone C in git or D1 bodies.
- No browser/frontend provider calls. All providers use server-side adapters.
- Persist only Control Plane metadata. Never persist provider secrets, payment details, client PII, or health content.
- `currentMode=TEST`. Event evidence cannot promote mode.
- OpenAI Responses stays disabled and NOT_CONNECTED. No OpenAI key is used or spent.

## Storage

- Production Worker: D1 (`console_meta` JSON payload is the atomic source of truth; projection tables hold sessions, preferences, decisions, audits, evidence cards, correlations, jobs, and result envelopes).
- Writes use optimistic `revision` concurrency plus a single-active-writer lock (`writer_id` + TTL).
- Idempotent Slack rehearsal status ingest stores one result envelope per job/status pair.
- Dev/tests: `MemoryStore` / `JsonFileStore` only. Production Worker fail-closes without the D1 binding, session secret, and password hash.
- D1 Free Time Travel = 7-day restore. Periodic SQL export requires an explicit founder approval note first.

## Auth

Founder-only. No anonymous console or API access except `/api/health`, `/api/login`, and `/api/session`. scrypt (Node) or PBKDF2 (Worker-compatible) password hashes. HttpOnly+Secure+SameSite cookies on workers.dev. CSRF on every mutation. Failed-attempt rate limiting. Session expiry, rotation, and logout. No paid identity provider. No production default credential.

## Evidence cards

Every adapter card carries `source`, `lastAttemptedAt`, `lastVerifiedAt`, `currentState` (`VERIFIED` / `STALE` / `UNKNOWN` / `NOT_CONNECTED`), a safe evidence reference, `reason`, and `nextSetupRequirement`. Missing evidence never renders GREEN/VERIFIED.

## Rehearsals

1. Slack/Grok: exactly one allowlisted `Grok_Alex: OPS_EVENT` to `#ai-ops`. Ingest only a matching `Grok_Alex: OPS_STATUS`.
2. Cursor Cloud: one bounded no-provider-write task on `TRCoach/TRCoaching` at `cursor/tr-training-control-plane-fcd0`, `autoCreatePR=false`.

Job views show parent correlation and sub-events. `requested`/`pending` never render completed. Collection is founder-triggered or 45s overview poll with a 15s refresh throttle.
