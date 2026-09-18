# Control-plane completion report

Repo: `TRCoach/TRCoaching`  
Bounded task: initial control plane + one social benchmark (asset production, automated QA, this report).  
As-of Drive pointer: `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST`.

## Commands

| Command | Result |
| --- | --- |
| `npm ci` | pass |
| `npm run build` | pass |
| `npm test` | pass (47/47), including Phase A A–E and Phase B auth/dispatch/persistence proofs |
| `npm run validate` | pass — 44 states, 57 transitions, all required fields present |
| `npm run benchmark:social` | pass — local files only |
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
- Parallel tracks: commercial, marketing_cycle, learning (learning does not consume commercial state)
- Permission registry `model/permissions.json`: mode `TEST`, beta target 25 Sep 2026
- Payments `allowedIn` CONTROLLED_BETA and LIVE only with named founder Stripe-live unlock; TEST blocked; Sam owns payment_clear; whole-business LIVE not required
- Operating mode is trusted-registry only; `evidence.operating_mode` cannot bypass TEST
- Refunds/credits `allowedIn` CONTROLLED_BETA and LIVE as per-case human founder decisions; never automatic; same trusted-mode rule
- Happy path + fail-closed negatives + learning/self-modify + TEST schedule block + CONTROLLED_BETA payment unlock + trusted-mode (no event promotion) tests in `test/`

## Live-integration gaps

- Drive: titles and env placeholders only; no live document sync
- Metricool: dry-run; no schedule or publish
- CRM: dry-run stubs
- Stripe: dry-run/read evidence only; no live charges/refunds/credits/payment links in this task. CONTROLLED_BETA paying-client path is permission-modelled only.
- Superset: dry-run delivery codes; no Zone C on the bus
- Slack: convention only (`Grok_Alex:` + one bounded task); no live write
- Mode promotion to CONTROLLED_BETA/LIVE is a founder unlock, not an agent action
- Learning cannot apply policy; Drive remains the SOP/policy source of truth

## Zero live side effects

- External writes: **0**
- Publication: **false**
- Paid spend: **false**
- Secrets committed: **none**
- Client PII / Zone C in repo or report: **none**
