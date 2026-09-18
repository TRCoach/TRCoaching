# Founder Console usage (Phase A)

Requires Node.js 22. Preview is **localhost only**.

```bash
npm ci
npm run build
npm run console:dev
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). The page is labelled **TEST / DEMO**. Do not expose the port.

Production-style local start after build:

```bash
npm run console:start
```

Checks without a browser:

```bash
npm run console:check
```

## What you can do in TEST

- Run **Run Daily Business Cycle** to inspect every lane. The summary is deterministic. Agents are not blindly woken.
- Type a command in the universal box. Known prompts split into bounded actions under one correlation id.
- Open a Founder Decision Inbox item and Approve, Reject, or Request more evidence. There is no approve-all. Approvals in TEST are audit records only.
- Review activity. `requested`, `queued`, `scheduled`, and `pending` never render as completed.

## Exact commands covered by tests

1. `Generate next week's marketing and schedule anything that has the required approvals.`
2. `Progress all active leads as far as current permissions allow.`
3. `Progress every paid client through onboarding and coaching as far as current permissions allow.`
4. `Refund this client.`

Unknown or ambiguous text is routed to Alex (`Grok_Alex:`) and ChatGPT review.

## What TEST will not do

- Promote operating mode
- Call a provider
- Schedule or publish to Metricool
- Charge, refund, credit, or issue a payment link
- Skip consent, Ready, or founder go-live
- Store client personal data or Zone C health detail

Drive document titles stay in `model/current-state.json`. The console does not copy policy bodies.
