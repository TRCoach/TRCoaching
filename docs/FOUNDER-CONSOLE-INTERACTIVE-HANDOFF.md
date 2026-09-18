# Founder Console interactive control-surface handoff

Date: 18 September 2026

Branch/PR: `cursor/tr-training-control-plane-fcd0` / https://github.com/TRCoach/TRCoaching/pull/1

Trusted mode: `TEST`

## Founder-visible result

- Every exception-first lane card opens a keyboard-accessible detail drawer.
- The drawer shows current state, evidence, source, owner, blocker reason, next action and the matching audit history.
- Founder controls are real Control Plane mutations: add instruction/comment, request evidence, retry a permitted step, acknowledge and resolve only when policy permits. Decision cards retain Approve, Reject and Request evidence.
- Audit and lane state survive service restarts through the existing store/D1 payload.
- The Command box creates correlated jobs. Unknown requests are routed to a bounded classification job when Slack is connected; no fake completion is inferred.
- A prominent `Prepare next week's social media` action creates one dependency-aware ten-stage workflow.

## Next-week social workflow

The stages are: Metricool performance/queue read, approved Drive source read, safe CRM/FAQ learning, plan, Cursor production, technical QA, Taylor exact-final review, independent ChatGPT exact-final review, Metricool prepare/schedule and provider read-back.

The workflow enforces:

- no repeated audio, hook or core treatment back-to-back;
- TikTok photo assets must be JPEG or WebP, never PNG;
- accurate AI/AIGC provenance disclosure;
- no text overlap;
- Instagram 08:00/13:00/19:00, Facebook 10:00/12:00/18:00 and TikTok 10:00/12:00/18:00 windows;
- the exact same final asset/copy/config must receive both Taylor PASS and ChatGPT PASS.

A generic connector ping is deliberately insufficient. Planning advances only from purpose-specific evidence refs for Metricool performance/queue, approved Drive marketing/offer/SOP content and safe CRM/FAQ aggregates. In `TEST`, scheduling/publication stops visibly even after reviews.

## Slack/Grok return path

The live exchange in `#ai-ops` proved that `TR Founder Console` (`U0C3S968H96`) can post an allowlisted `Grok_Alex: OPS_EVENT`, and a matching `OPS_STATUS` was returned for the same event/correlation. The return was a thread reply, exposing a collection gap.

The Console now reads the relevant Slack thread replies as well as channel history. It accepts `OPS_STATUS` only from `SLACK_APPROVED_STATUS_SENDER_IDS`, then applies the existing event, correlation, executor, state and idempotency checks. The currently verified approved sender is `U0C1ES07MKK`. Unrelated bot/app messages remain rejected.

## Connection truth

- Slack outbound and the approved return exchange are live-proven. Deployment configuration must keep `SLACK_DISPATCH_ENABLED=1` and the server-only bot token in Cloudflare; repository defaults do not contain the token.
- Cursor Cloud dispatch/result collection is implemented and mocked end-to-end; a server-only `CURSOR_CLOUD_AGENT_TOKEN` is still required for a genuine production run.
- Drive, CRM, Metricool, Stripe and Superset adapters retain `UNKNOWN`/`NOT_CONNECTED` fail-closed behaviour. Metadata probes do not count as source-content reads.
- OpenAI/ChatGPT API dispatch remains disabled, so independent ChatGPT review is a visible blocker rather than simulated work.
- No money movement, health judgement, safety override, paid spend, publication or irreversible action was enabled.

## Verification

- TypeScript application and web builds pass.
- 76/76 non-media tests pass on the latest PR tip, including the existing Worker runtime safeguards, threaded Slack return provenance and persistent lane interaction tests.
- The media/ffmpeg suite is unchanged; it cannot initialise the local fontconfig cache in this sandbox and was previously green in cloud verification.
- Local desktop and 390 px mobile browser checks pass for login, overview, lane drawer, persisted founder instruction and the ten-stage social workflow.
