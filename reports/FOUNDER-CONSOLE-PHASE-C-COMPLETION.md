# Founder Console Phase C — completion report

Repo: `TRCoach/TRCoaching`  
Base: `c2eb9825f3986f31d24b5cea05b0930bed7cb0b7`  
Implementation commit: `520f328720f6052b0bb86f03a876aecc5f532c8b`  
D1 id bind (founder/Codex): `bc67e06ffb23a16d5056b8f8052b0a51b816fd06`  
Branch/PR: `cursor/tr-training-control-plane-fcd0` / https://github.com/TRCoach/TRCoaching/pull/1  
As-of Drive pointer: `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST`.

## Distinction

| Claim | Status |
| --- | --- |
| Implemented | **yes** |
| Locally verified | **yes** — `npm ci` not re-run (node_modules present); `npm run build`, `npm test` **64/64**, `validate`, `console:check`, `worker:check`, `benchmark:social`, `qa:social` all pass |
| Deployed to workers.dev | **no** — not performed and not externally verified |
| D1 `database_id` present in `wrangler.toml` | **yes** (`f393b2f3-161b-4241-9a70-bdb2fbd3b707`) — resource id only; remote migrate/secrets/deploy **not verified** |
| Genuinely connected | **no** |
| Live Slack/Cursor rehearsal | **no** — code-ready; local rehearsals return honest `BLOCKED` / `NOT_CONNECTED` |
| OpenAI used/spent | **no** |

## Commands (this Cloud run)

| Command | Result |
| --- | --- |
| `npm run build` | pass |
| `npm test` | pass **64/64** (52 Phase B preserved + 12 Phase C) |
| `npm run validate` | pass — 44 states, 57 transitions, 17 founder actions, `external_writes: 0` |
| `npm run console:check` | pass — TEST, 17 actions, unauthenticated blocked, sensitive rejected, spoof ignored, writes 0 |
| `npm run worker:check` | pass |
| `npm run benchmark:social` | pass — `publication_occurred=false` |
| `npm run qa:social` | pass — `publish_eligible=false`, `publication_occurred=false` |

CI remains secret-free (build/test/validate/console:check only). It does not deploy.

## D1 / auth / storage design

- Hosting target: Cloudflare Workers Free + D1 Free. Default HTTPS is `*.workers.dev`. D1 Free Time Travel = 7-day restore. Workers Paid ($5/mo) is **not** activated and needs separate founder approval.
- Production store: `D1Store` — `console_meta` JSON payload is the atomic source of truth (store v3 + `revision`). Projection tables: sessions, preferences, decisions, audits, evidence_cards, correlations, jobs, result_envelopes, rate_limits.
- Writes: optimistic revision concurrency + single-active-writer lock (`writer_id` + 15s TTL). Slack rehearsal status ingest is idempotent per job/status.
- Fail-closed without D1 + `FOUNDER_SESSION_SECRET` (>=32) + `scrypt$`/`pbkdf2$` hash. No production default credential.
- Dev/tests retain `MemoryStore` / `JsonFileStore` only.
- Auth: founder-only. Anonymous API blocked except `/api/health`, `/api/login`, `/api/session`. PBKDF2 (Worker) + scrypt (Node). HttpOnly + SameSite=Strict cookies; Secure on workers.dev. CSRF on every mutation. Failed-attempt rate limits persist in the store/D1. Expiry, rotation, logout, security headers, login/logout audit.
- Persist Control Plane metadata only. Never provider secrets, payment details, client PII, or Zone C/health content.
- Export requires an explicit founder approval note first (`docs/FOUNDER-CONSOLE-PHASE-C-BACKUP.md`).

## Genuine connection vs NOT_CONNECTED

| Adapter | Implemented | Locally verified | Deployed | Genuinely connected | Rehearsed | Default |
| --- | --- | --- | --- | --- | --- | --- |
| Drive metadata | yes | mocked GET | no | no | n/a | NOT_CONNECTED |
| CRM Sheet metadata/aggregates | yes | mocked GET | no | no | n/a | NOT_CONNECTED |
| Metricool calendar metadata | yes | mocked GET | no | no | n/a | NOT_CONNECTED |
| Stripe TEST `rk_test_` account | yes | mocked GET; live keys/writes rejected | no | no | n/a | NOT_CONNECTED |
| Superset assignment codes | yes | mocked GET | no | no | n/a | NOT_CONNECTED |
| Slack `#ai-ops` | yes | fake transport + local BLOCKED | no | no | not live | NOT_CONNECTED |
| Cursor Cloud v1 | yes | mocked v1 + local BLOCKED | no | no | not live | NOT_CONNECTED |
| GitHub metadata | yes | evidence schema | no | no | n/a | NOT_CONNECTED |
| OpenAI Responses | **disabled** | proven `NOT_CONNECTED` / `openaiDisabled=true` | n/a | no | n/a | NOT_CONNECTED |

## Deployment prerequisites (remaining)

1. Cloudflare Free account (do not buy Workers Paid).
2. `npx wrangler login`
3. D1 id is already in `wrangler.toml`. Still required: `npx wrangler d1 migrations apply tr-founder-console --remote`
4. `npm run console:hash-password -- --pbkdf2 '<strong-password>'` then `wrangler secret put FOUNDER_SESSION_SECRET` and `FOUNDER_AUTH_PASSWORD_HASH`
5. Optional read-only secrets only (Drive/CRM/Metricool/`rk_test_` Stripe/Superset/GitHub/Slack/Cursor)
6. Do **not** set `OPENAI_API_KEY` or `FOUNDER_CHATGPT_DISPATCH=1`
7. `npx wrangler deploy` → `https://tr-founder-console.<account>.workers.dev`

## Rehearsal prerequisites (not executed)

- Slack first: `SLACK_DISPATCH_ENABLED=1`, `SLACK_BOT_TOKEN`, `SLACK_AI_OPS_CHANNEL=#ai-ops` (or `C…`). One `Grok_Alex: OPS_EVENT` only; ingest matching `OPS_STATUS` only.
- Cursor second: server-only `CURSOR_CLOUD_AGENT_TOKEN`, exact `TRCoach/TRCoaching`, ref `cursor/tr-training-control-plane-fcd0`, `autoCreatePR=false`. No provider writes. No external business-system mutation.

## Browser / HTTP evidence (localhost, not workers.dev)

Verified against `http://127.0.0.1:8787` with `FOUNDER_CONSOLE_DEV_AUTH=1` (no live Cloudflare session):

- Desktop/mobile install copy present (Windows Edge/Chrome, iOS Safari, Android Chrome); CSS uses `minmax` grid; manifest `standalone`; SW `tr-founder-console-test-v3`; offline shell 200
- Login 200 + HttpOnly/SameSite cookies; bad password 401; anonymous overview 401; CSRF-less command 403; logout then overview 401
- Daily cycle command stays `mode=TEST`, `externalWrites=0` even if `operating_mode=LIVE` is spoofed
- Evidence: 9 cards all `NOT_CONNECTED`; zero `VERIFIED`; `openaiDisabled=true`
- Slack/Cursor rehearsal endpoints return honest `BLOCKED` / `NOT_CONNECTED`
- `email` payload rejected; public HTML has no `sk_live`/`rk_live`/OpenAI keys
- Visual browser-tool pass was not run; HTTP/static acceptance covers the required surfaces

## Safety

Unauthorized business writes: **0**. Payments: **0**. Publication: **false**. Paid spend: **false**. No secrets in git. No provider writes from this code work. Mode remains `TEST`.
