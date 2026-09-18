# Founder Console live verification — 18 September 2026

## Verified deployment

- Live URL: `https://tr-founder-console.ptbytom.workers.dev/`
- Cloudflare Worker version: `4b74f299-be0a-4d7f-bf15-6935585fda98`
- Branch: `cursor/tr-training-control-plane-fcd0`
- Draft PR: `https://github.com/TRCoach/TRCoaching/pull/1`
- Verified code commit: `5a53520`
- Trusted operating mode: `TEST`
- GitHub `push` and `pull_request` check suites: PASS on `5a53520`

## Live founder controls

Every exception-first card opens a keyboard-accessible detail drawer containing current state, owner, source, timestamps, evidence, blocker reason, next action and matching audit history. Founder controls create persistent Control Plane events for:

- add instruction/comment;
- request evidence;
- retry a policy-permitted step;
- acknowledge;
- resolve only when the item is already evidence-backed and progressed;
- Approve, Reject or Request evidence on individual founder decision packets.

The live audit contains a persisted founder instruction on `ASSET-CONSOLE-001`. Blocked, awaiting-external and founder-required items cannot be cosmetically marked complete.

## Verified external round trips

### Slack / Grok-Alex

`Founder Console -> #ai-ops OPS_EVENT -> approved Grok/Alex OPS_STATUS -> Founder Console`

- Live connector state: `VERIFIED`.
- Only the known Founder Console event format and approved status sender are accepted.
- Event ID, correlation ID, executor and terminal status are validated.
- Slack thread replies are collected.
- Loop protection and unrelated-bot rejection remain enabled.
- Zero external business-system writes were reported.

### Cursor Cloud

`Founder Console -> Cursor Cloud Agent API -> bounded QA run -> Console result collection`

- Live connector state: `VERIFIED`.
- Correlation: `corr_f10d14ff`.
- Cursor event: `evt_c3f7c86c`.
- Provider run: `bc-84046154-898b-4d81-a9ee-59c4310ca940`.
- Cursor verified HEAD `5a53520`, matching the approved starting ref.
- Cursor reported QA `PASS`, including `npm test` 85/85, builds, model validation, console safety check, Worker check and social QA.
- Verified stop conditions: `external_writes=0`, `provider_writes=0`, `publication_occurred=false`, `publish_eligible=false`, `paid_spend=false`, no client PII, no Zone C, `autoCreatePR=false`.
- The server-generated agent ID is used; uncertain creates are not retried.
- The authorised paid TEST run is complete; no active paid Cursor run remains.

## Founder command and next-week social workflow

The natural-language command box creates linked auditable jobs and returns one founder summary. The exact request `Prepare next week's social media and show me every blocker and owner` routes to the social workflow rather than generic classification.

The one-click social action creates ten dependency-aware jobs for:

1. Metricool performance and current queue read;
2. approved Drive marketing, offer and SOP read;
3. safe CRM sales/FAQ learning read;
4. next-week content plan;
5. bounded Cursor production;
6. technical QA;
7. Taylor exact-final specialist review;
8. independent ChatGPT exact-final review;
9. Metricool prepare/schedule;
10. provider state read-back.

The workflow enforces the current posting windows, no back-to-back repeated audio/hooks/core treatment, TikTok JPEG/WebP photo rules, truthful native AI/AIGC disclosure, no public AI self-reference, no text overlap and exact-final Taylor + ChatGPT dual PASS. In TEST, schedule/publish remains blocked even if upstream work passes.

## Live adapter audit

| Adapter | Live state | Verified blocker / next setup |
| --- | --- | --- |
| Drive | `NOT_CONNECTED` | ChatGPT's Drive OAuth connection cannot be reused by a Cloudflare Worker. A separate least-privilege server-side Drive credential is required. |
| CRM | `NOT_CONNECTED` | CRM v0 is the controlled Google Sheet in Drive. A server-side Google Sheets read credential and bounded sheet/range are required. |
| Metricool | `NOT_CONNECTED` | The signed-in account's API tab states API access requires Advanced or Custom. Current UI access proves the queue and analytics exist, but no server API token is available on the current plan. No plan upgrade was purchased. |
| Stripe | `NOT_CONNECTED` | Stripe TEST has no restricted key. The Worker accepts only an `rk_test_` token. Creating a new key is a security action requiring explicit confirmation. No live-mode key is accepted. |
| Superset | `NOT_CONNECTED` | Drive records state production MCP/API access is unproven. A supported read-only endpoint/token for neutral delivery codes is required; Zone C remains prohibited. |
| Slack | `VERIFIED` | No setup action required; retain allowlist and result validation. |
| Cursor | `VERIFIED` | No setup action required; retain exact repo/ref allowlist and bounded prompt. |
| ChatGPT API | `NOT_CONNECTED` | Deliberately disabled; no OpenAI API spend or simulated independent PASS. |
| GitHub | `NOT_CONNECTED` | Console-side metadata adapter lacks a server token, although browser CI was independently verified green. |

## Safety truth

- Mode remains `TEST` from the trusted registry.
- Unauthorized business writes: 0.
- No live payment, refund, credit, plan purchase, publication, paid media, clinical/health judgement, Ready bypass, privacy/legal exception or irreversible account/security change was performed.
- Missing credentials, unsupported APIs and insufficient plans remain visibly `NOT_CONNECTED`/`BLOCKED`; no connector is green from a UI login alone.
