# Retry, failure, and escalation

Default: fail closed. Missing evidence is not retried into a later state.

| Class | maxAttempts | backoff | On exhaust |
| --- | --- | --- | --- |
| Transient connector dry-run | 3 | 30–60s | Escalate Alex (`Grok_Alex:`) |
| Classification / commercial update | 2 | 60s | Escalate Alex |
| Payment status read | 5 | 60s | Fail closed; Sam owns payment_clear |
| Founder gates (go-live, refund/credit, publication) | 1 | 0 | Hold for founder; do not auto-retry |
| Consent / Ready / assignment | 1 | 0 | Fail closed |

Stop instead of retry when the event requests: live charge/refund/credit/payment link, paid spend, production deletion, publication, health/safety judgement, first-client go-live, legal/privacy exception, or irreversible security change.

Slack escalation body: `Grok_Alex: TRCoach/TRCoaching — <one bounded task>`.
