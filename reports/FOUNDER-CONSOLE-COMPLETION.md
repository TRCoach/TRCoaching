# Founder Console Phase A/B/C — completion report

Repo: `TRCoach/TRCoaching`  
Bounded task: TEST-mode Founder Console PWA + Control Plane service + Phase B QA delta + Phase C Workers/D1.  
As-of Drive pointer: `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST`.  
Verified on branch `cursor/tr-training-control-plane-fcd0` (draft PR #1).

## Commands (Cloud-reproduced, Phase C)

| Command | Result |
| --- | --- |
| `npm run build` | pass |
| `npm test` | pass **64/64** (52 Phase B preserved + 12 Phase C) |
| `npm run validate` | pass — 44 states, 57 transitions, 17 founder actions |
| `npm run console:check` | pass — TEST, 17 actions, sensitive rejected, spoof ignored, zero writes |
| `npm run worker:check` | pass |
| `npm run benchmark:social` | pass — local files only, `publication_occurred=false` |
| `npm run qa:social` | pass — `publish_eligible=false`, `publication_occurred=false` |

## Phase B QA delta

- Cursor Cloud Agents API v1 (public beta) adapter: `POST /v1/agents`, `GET /v1/agents/{agentId}/runs/{runId}`, server-minted agent ID, exact `TRCoach/TRCoaching` allowlist, starting ref, optional `GET /v1/models`, and `autoCreatePR=false` for the controlled TEST rehearsal. An uncertain create is never auto-retried. Default NOT_CONNECTED without a server-only key.
- OpenAI Responses worker: `POST /v1/responses` `background=true`, `GET /v1/responses/{id}`. Requires `FOUNDER_CHATGPT_DISPATCH=1` + `OPENAI_API_KEY` + `OPENAI_MODEL`. Spend disabled by default. Retention/data-control review documented.
- Slack collect of correlated `Grok_Alex: OPS_STATUS`; `POST /api/jobs/refresh`.
- Live metadata/auth probes discard/cancel bodies; persist timestamp + evidence labels only.
- Logout and session rotation require auth+CSRF. Store v2 tracks model/tests/blockers (single-process atomic JSON only).
- UI: connector/action drill-down, Collect worker results, unauthorized vs authorised governed dispatch counts.

## Files

- `model/founder-actions.json` — 17 action cards (semantics unchanged)
- `src/console/*` — service, dispatch, Cursor v1, OpenAI Responses, probes, HTTP, PWA
- `console/public/*` — HTML/CSS/PWA shell (`tr-founder-console-test-v3`)
- `src/worker/*`, `wrangler.toml`, `migrations/0001_console.sql`
- `docs/FOUNDER-CONSOLE-*.md` including Phase C deploy/backup/adapters/install
- `test/console.test.ts`, `test/console-phase-b.test.ts`, `test/console-phase-c.test.ts`

## Preview

`FOUNDER_CONSOLE_DEV_AUTH=1 FOUNDER_DEV_PASSWORD=… npm run console:dev` → [http://127.0.0.1:8787](http://127.0.0.1:8787) (localhost only)

## Safety

- Mode source: `model/permissions.json` `currentMode=TEST`
- Event payloads cannot promote mode
- Unauthorized business writes: **0**
- Provider credentials connected: **none**
- Secrets committed: **none**
- Client PII / Zone C: **none**
- Approve-all: **absent**
- Public deployment: **no**
- Hard stops unchanged: no live Stripe money movement, no paid spend, no publication, no health judgement/Ready bypass, no first-client go-live, no privacy/legal exception, no irreversible security/account change

## Live-integration gaps

- Cursor/OpenAI/Slack remain NOT_CONNECTED until server-only keys and founder spend/dispatch flags are set
- Drive/CRM/Metricool/Stripe/Superset/GitHub probes stay UNKNOWN/NOT_CONNECTED without config
- Console localhost bind remains for Node preview; hosted target is private workers.dev (not deployed in this verification)
- CONTROLLED_BETA payment unlock is modelled, not executed
- `JsonFileStore` remains for dev/tests; production Worker uses D1 and fail-closes without it
- Phase C: OpenAI forced `NOT_CONNECTED`; no workers.dev session was verified; no live Slack/Cursor rehearsal
