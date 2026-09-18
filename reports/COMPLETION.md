# Control-plane completion report

Repo: `TRCoach/TRCoaching`  
Bounded task: initial control plane + social benchmark + Founder Console Phase A/B + Phase B QA delta.  
As-of Drive pointer: `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST`.  
Verified commit: Cloud-reproduced on `cursor/tr-training-control-plane-fcd0`.

## Commands (Cloud-reproduced)

| Command | Result |
| --- | --- |
| `npm run build` | pass |
| `npm test` | pass **52/52** (49/49 non-media + 3/3 ffmpeg social) |
| `npm run validate` | pass — 44 states, 57 transitions, 17 founder actions |
| `npm run console:check` | pass — TEST, 17 actions, unauthenticated blocked, zero writes |
| `npm run benchmark:social` | pass — local files only, `publication_occurred=false` |
| `npm run qa:social` | pass — `publishEligible=false`, `publication_occurred=false` |

## Benchmark assets

Copy (benchmark only, not production-approved): `Busy week? Make the next step obvious.`  
Config: `scene-benchmark-v1`. No external media, music, paid assets, or platform upload.

| Asset | Size | MIME / codec | SHA-256 |
| --- | --- | --- | --- |
| `assets/benchmark/busy-week-feed.jpg` | 1080×1350 | `image/jpeg` | `67ee6b181c261f2e5ac3fcd37fc678be9481f07bf31f07685cde9267673b02dc` |
| `assets/benchmark/busy-week-feed.webp` | 1080×1350 | `image/webp` | `c064ec8ce39f70e88195eea28ed7e265c78b0a0d89c57ccdf73826fbc7a45502` |
| `assets/benchmark/busy-week-reel.mp4` | 1080×1920 | `video/mp4` / `h264` | `1a46932117389e855f50813e9f1c444031e8a7a7663dd2cfb2a0b9cdaa3e24b3` |

Storyboard JSON + three scene JPEGs are the deterministic video-equivalent if H.264 checksums differ across ffmpeg builds. Audio = none. AIGC = none (code-rendered SVG). Safe margins and declared layout geometry passed with no overlap. `taylor_pass=false`, `chatgpt_pass=false`, so `publish_eligible=false`.

## State-model coverage

- 44 states from `uninitialized` through offboarding, plus weekly marketing-cycle and learning tracks
- 57 transitions, each with the 13 required fields
- 17 founder actions (semantics unchanged)
- Parallel tracks: commercial, marketing_cycle, learning (learning does not consume commercial state)
- Permission registry `model/permissions.json`: mode `TEST`, beta target 25 Sep 2026
- Payments `allowedIn` CONTROLLED_BETA and LIVE only with named founder Stripe-live unlock; TEST blocked; Sam owns payment_clear; whole-business LIVE not required
- Operating mode is trusted-registry only; `evidence.operating_mode` cannot bypass TEST
- Refunds/credits `allowedIn` CONTROLLED_BETA and LIVE as per-case human founder decisions; never automatic; same trusted-mode rule
- Happy path + fail-closed negatives + learning/self-modify + TEST schedule block + CONTROLLED_BETA payment unlock + trusted-mode (no event promotion) + Phase B QA delta (Cursor v1 / OpenAI Responses / Slack OPS_STATUS / probes / CSRF rotation) tests in `test/`

## Live-integration gaps

- Drive: titles and env placeholders only; live probes discard bodies
- Metricool: dry-run; no schedule or publish
- CRM: dry-run stubs
- Stripe: dry-run/read evidence only; no live charges/refunds/credits/payment links
- Superset: dry-run delivery codes; no Zone C on the bus
- Slack: `Grok_Alex:` OPS_EVENT/OPS_STATUS contract; live posts off by default
- Cursor Cloud Agents API v1 is wired and remains NOT_CONNECTED without a server-only key
- OpenAI Responses is wired; spend disabled without `FOUNDER_CHATGPT_DISPATCH=1` + key + model
- Mode promotion to CONTROLLED_BETA/LIVE is a founder unlock, not an agent action
- Learning cannot apply policy; Drive remains the SOP/policy source of truth
- Store is single-process atomic JSON only; no public deployment; no provider credentials connected

## Zero live side effects

- Unauthorized business writes: **0**
- Publication: **false**
- Paid spend: **false**
- Secrets committed: **none**
- Client PII / Zone C in repo or report: **none**
