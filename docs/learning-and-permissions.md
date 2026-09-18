# Continuous learning, weekly cycle, and wake routing

Routine events should wake the named owner (and a Cursor worker only when the action is a bounded dry-run). Founder is not in the hot path.

| Signal | Wake | Founder? |
| --- | --- | --- |
| Social enquiry / classify / nurture | Taylor | No |
| Qualify / offer / payment_clear | Sam | No |
| Check-in / adherence codes | Jordan; Cursor may open/close dry-run records | No |
| Blocker | Alex via `Grok_Alex:` | Only if the blocker is a founder gate |
| Weekly cycle analyse → generate → produce → QA | Taylor, then Cursor produce, then ChatGPT QA | No |
| TAYLOR PASS / CHATGPT PASS | Taylor then ChatGPT | Dual PASS is the human gate |
| Metricool schedule | Taylor | Yes until CONTROLLED_BETA/LIVE unlock |
| Sales/coaching/marketing learning proposal | Sam / Jordan / Taylor | No — proposal only |
| Learning review | ChatGPT | No |
| SOP/rule change | Founder | Yes — Drive remains policy SoT |
| Ready / programme go-live | Jordan then Founder | Yes |
| Paying founding client (Closed Won) | Sam (`payment_clear`) | Named founder Stripe-live unlock; CONTROLLED_BETA is enough — do not promote the whole business to LIVE |
| Refund / credit | Founder per case | Yes in CONTROLLED_BETA or LIVE; never automatic |

Agents never self-modify policy. Learning writes a versioned proposal (`proposal_version` + `learning_domain`). ChatGPT reviews. Founder may record an SOP change pointer on Drive. The engine does not rewrite Drive policy documents.

## Weekly marketing cycle

`analyse → generate → produce → QA → Taylor PASS → ChatGPT PASS → Metricool schedule → delivery/performance monitor → next-cycle learning`

In current mode `TEST` (beta target **25 Sep 2026**), schedule stays dry-run and is permission-blocked. Publication still requires exact-final dual PASS.

## Maturity

`assisted → approval-gated → autonomous-within-boundaries → managed-by-exception`

TEST is assisted/approval-gated and **blocks payments**. Operating mode is taken only from the trusted registry (`model/permissions.json` `currentMode`, or an explicitly injected registry in isolated tests). Event `evidence.operating_mode` is ignored and cannot promote mode. CONTROLLED_BETA may accept paying founding clients after an **explicit separate** founder Stripe-live/payment unlock (`founder_stripe_live_unlock` + `founder_payment_unlock_ref`); that unlock does not promote the whole business to LIVE. Sam still owns `payment_clear`. Founder-authorised refund/credit is allowed in CONTROLLED_BETA and LIVE only as a per-case human decision — never automatic. LIVE still never self-modifies policy and never bypasses Ready or founder go-live. This repo stays `TEST` and dry-run.
