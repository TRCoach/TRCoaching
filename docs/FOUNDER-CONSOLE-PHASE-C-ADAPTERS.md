# Phase C adapter setup

| Adapter | Implemented | Locally verified | Deployed | Genuinely connected | Rehearsed | Default |
| --- | --- | --- | --- | --- | --- | --- |
| Drive metadata | yes | unit/mocked | no | no | n/a | NOT_CONNECTED |
| CRM Sheet metadata | yes | unit/mocked | no | no | n/a | NOT_CONNECTED |
| Metricool read API | yes | unit/mocked | no | no | n/a | NOT_CONNECTED |
| Stripe TEST `rk_test_` | yes | unit/mocked | no | no | n/a | NOT_CONNECTED |
| Superset codes | yes | unit/mocked | no | no | n/a | NOT_CONNECTED |
| Slack `#ai-ops` | yes | live + automated | yes | outbound proven | OPS_EVENT + matching threaded OPS_STATUS proven | configured deployment / fail closed otherwise |
| Cursor Cloud v1 | yes | mocked v1 | no | no | code-ready, not live | NOT_CONNECTED |
| GitHub metadata | yes | Phase B probes | no | no | n/a | NOT_CONNECTED |
| OpenAI Responses | disabled | proven off | n/a | no | n/a | NOT_CONNECTED |

Exact setup (server-only secrets, never in git):

- Drive: `TR_DRIVE_READONLY_TOKEN` metadata-only. File IDs stay env placeholders.
- CRM: `TR_CRM_READONLY_TOKEN` + `TR_CRM_READONLY_URL` (spreadsheet metadata; no lead names).
- Metricool: `TR_METRICOOL_READONLY_TOKEN` + `TR_METRICOOL_READONLY_URL` documented read/analytics URL. No publish.
- Stripe: `TR_STRIPE_READONLY_TOKEN=rk_test_…` only. `sk_live_` / `rk_live_` rejected. Writes rejected.
- Superset: `TR_SUPERSET_READONLY_TOKEN` + `TR_SUPERSET_READONLY_URL` or honest NOT_CONNECTED.
- Slack rehearsal: `SLACK_DISPATCH_ENABLED=1`, `SLACK_BOT_TOKEN`, `SLACK_AI_OPS_CHANNEL=#ai-ops` or `C…`, plus comma-separated `SLACK_APPROVED_STATUS_SENDER_IDS`. Thread replies are collected; all other senders are rejected.
- Cursor rehearsal: `CURSOR_CLOUD_AGENT_TOKEN`, `CURSOR_ALLOW_REPO=TRCoach/TRCoaching`, `CURSOR_STARTING_REF=cursor/tr-training-control-plane-fcd0`.
