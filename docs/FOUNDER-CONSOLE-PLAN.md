# Founder Console plan (Phase A)

Phase A is a **TEST-mode** Founder Console inside `TRCoach/TRCoaching`. It is one bounded task: a localhost PWA plus Control Plane service. Drive remains the business source of truth. Existing state-model, ownership, permission, trusted-mode, and hard-stop rules are unchanged.

## Why this phase

The lifecycle engine is machine-readable. Founders still need an exception-first surface that can inspect the whole company, run the 17 named actions, and capture per-case decisions without promoting mode or calling providers.

## Architecture

```
PWA (console/public) → HTTP API (127.0.0.1) → ConsoleService → StateEngine / permissions / dry-run adapters
```

- Frontend never calls Stripe, Metricool, CRM, Drive, Superset, or Slack APIs.
- Operating mode is read only from `model/permissions.json` `currentMode` (or an injected trusted registry in isolated tests).
- Event / request `operating_mode` is ignored.
- TEST actions write audit records only.

## Phase A scope

- Exception-first overview of all business lanes
- 17 programmable action cards
- Universal command box with deterministic routing
- Founder Decision Inbox (no approve-all)
- Activity statuses that do not collapse requested/pending into completed
- Worker/system status without credentials
- Usage/cost with unknown-safe cost fields
- PWA shell, responsive layout, keyboard/accessibility basics
- Localhost-only preview

## Later phases (not this task)

- Read-only live pointers (Drive titles via env, Stripe test reads)
- CONTROLLED_BETA founder unlocks executed outside this TEST console
- Authenticated multi-user access
- Paid hosting

## Hard stops retained

No secrets, client PII, Zone C, live writes, payments, publication, paid spend, or provider mutation.
