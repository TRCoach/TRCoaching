# TR Training Business Control Plane

Whole-business orchestration for TR Training: marketing → enquiry → qualification → offer → payment verification → Closed Won → onboarding → consent → screening → human Ready → programme draft → founder go-live → assignment → active coaching → check-ins → escalation → retention → renewal → cancellation → offboarding.

This is not a social-content product. Social rendering exists only as a bounded, unpublished benchmark of deterministic creative QA.

## Quick start

Requires Node.js 22. The saved Cloud Agent environment runs `npm ci` and starts no services.

```bash
npm ci
npm run build
npm test
npm run validate
npm run benchmark:social
npm run qa:social
```

CLI:

```bash
npx tsx src/cli.ts validate
npx tsx src/cli.ts apply-event fixtures/events/social-enquiry.valid.json
npx tsx src/cli.ts next
```

## Source-of-truth boundary

Google Drive remains the policy/knowledge source of truth. This repo stores:

- symbolic pointers and **expected document titles**
- as-of timestamps
- environment-variable placeholders for private file IDs (`model/current-state.json`, `.env.example`)

It does **not** store the business knowledge base, private Drive IDs, client personal data, or Zone C health detail.

Authoritative continuity title: `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST`.

Systems of record: Drive (policy), Metricool (social), CRM (commercial), Stripe (payment), Superset (delivery), Slack (event/command bus).

## Safety

All connectors are dry-run. The state engine never mutates an external system and fails closed without evidence. Hard stops include live Stripe money movement, paid spend, production deletion, publication, health/safety judgement, first-client go-live, legal/privacy exceptions, and irreversible security changes.

Publication requires TAYLOR PASS and CHATGPT PASS on the exact final checksum and config. Benchmark assets are not production-approved.

## Current limitations

- Live Drive/Metricool/CRM/Stripe/Superset/Slack integrations are not wired
- Stripe evidence is fixture/dry-run only; no live activation
- Ready, founder go-live, refund/credit, and publication stay human-gated
- Slack command bus is specified, not connected
- Social output is benchmark-only: `Busy week? Make the next step obvious.`

See `AGENTS.md` and `docs/` for ownership, gates, Slack convention (`Grok_Alex:`), and the phased beta plan.
