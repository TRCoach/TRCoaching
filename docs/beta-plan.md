# Phased beta-to-automation plan

1. **Control plane (this repo)** — lifecycle, schemas, dry-run adapters, fail-closed engine, benchmark QA, learning proposals, TEST permission registry.
2. **Read-only pointers** — resolve Drive titles via env placeholders; Slack command parsing without writes.
3. **CRM / Metricool reads** — stage and campaign refs only; still no publication and no paid spend.
4. **Stripe test-mode reads** — payment_clear stays Sam; live Closed Won remains blocked.
5. **Superset delivery codes** — check-in/assignment refs; no Zone C on the bus.
6. **Founder-gated first paying client in CONTROLLED_BETA** — named Stripe-live/payment unlock (separate from whole-business LIVE), Sam owns payment_clear, assignment/go-live stay founder-gated, refund/credit stay per-case human decisions.

Automation never absorbs Ready, publication dual PASS, live money movement, or first-client go-live.
