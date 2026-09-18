# TR Training control plane

This repository is the **whole-business orchestration layer** for TR Training. It is not a social-content tool. Cursor Cloud Agents are repeatable workers. ChatGPT is the operational manager and independent QA. Google Drive remains the policy/knowledge source of truth.

## Ownership

| Owner | Scope |
| --- | --- |
| Taylor | Marketing, platform, creative, **TAYLOR PASS** |
| Sam | Sales, commercial, CRM, **payment_clear** |
| Jordan | Onboarding, coaching, weekly check-ins, offboarding |
| Alex | Routing and blockers |
| ChatGPT | Operational manager, policy interpretation, independent QA, **CHATGPT PASS** |
| Cursor Cloud Agents | Repeatable bounded workers in `TRCoach/TRCoaching` |
| Grok Bot | Authenticated browser/operator only when separately authorised |

## Drive source priority

1. Drive document titled `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST` (as-of 12:36 BST / `2026-09-18T11:36:00Z`).
2. `AI Coaching Company — Operating System (Master)`.
3. Approved policy titles listed in `model/current-state.json`.

The repo may store **titles, as-of times, and `${ENV}` placeholders only**. Never copy the business knowledge base, private file IDs, client personal data, or Zone C health detail into git, Slack envelopes, fixtures, or reports.

## Systems of record

- Drive = policy
- Metricool = social scheduling/analytics
- CRM = lead/commercial state
- Stripe = payment truth
- Superset = coaching/delivery truth
- Slack = event/command bus

Connectors are interfaces with **dry-run/mock** implementations. The engine never mutates an external system.

## Hard stops

- No live Stripe activation, charges, refunds, credits, or payment links
- No paid spend
- No production deletion
- No publication
- No health/safety judgement
- No first-client programme go-live
- No material legal/privacy exception
- No irreversible account/security changes

State transitions **fail closed** without required evidence.

## Exact safety gates

- Test-mode payment cannot become live Closed Won
- Missing explicit health consent blocks screening and Ready
- Ready cannot bypass human evidence
- Programme assignment is blocked without founder approval
- Publication is blocked unless **TAYLOR PASS** and **CHATGPT PASS** apply to the **exact** final checksum and config
- Duplicate `event_id` / idempotency key is ignored
- Cancellation refund/credit routes to founder

## Slack and handoffs

- Actionable requests to Alex use the exact prefix `Grok_Alex:`
- Cursor Slack work names `TRCoach/TRCoaching` and contains **one bounded task**
- No client PII or Zone C detail in envelopes

## Test commands

```bash
npm ci
npm run build
npm test
npm run validate
npm run benchmark:social
npm run qa:social
```

CI runs `build`, `test`, and `validate` with no secrets.

## Cursor Cloud instructions

- Work on a feature branch. Do not commit secrets or Drive file IDs.
- One bounded task per run. Name the repo `TRCoach/TRCoaching`.
- Use `.cursor/environment.json` (`npm ci` only; no long-running service).
- Prefer dry-run adapters. If a write would be live, stop.
- After a bounded change: run the test commands above and attach the completion/benchmark report.
- Do not upload assets to platforms. `publishEligible` stays false unless both PASSes match the exact checksum/config.
- Social benchmark copy only: `Busy week? Make the next step obvious.`
