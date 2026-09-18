# Next-week social technical QA

Repo: `TRCoach/TRCoaching`
Bounded action: `produce_and_technical_qa_next_week_social_assets`
Event: `evt_b3ab3c98` · Correlation: `corr_a80de922`
Week: `week:2026-09-21/2026-09-27` (Europe/London)

Policy pointers (titles only):
- `CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST`
- `AI Coaching Company — Operating System (Master)`

## Outcome

- Technical QA: **PASS**
- Exact-final Taylor + ChatGPT PASS: **not granted**
- publish_eligible: **false**
- publication_occurred: **false**
- external_writes: **0**
- paid_spend: **false**
- PII / Zone C / secrets: **none**

Worker stop: technical QA complete. No specialist review dispatch, no Metricool write, no publication.

## Locked rule checks

| Rule | Gate | Result | Detail |
| --- | --- | --- | --- |
| `no_back_to_back_audio_hooks_or_core_treatment` | technical | PASS | All slots silent; consecutive same-platform treatments never repeat. |
| `tiktok_photo_jpeg_or_webp_not_png` | technical | PASS | TikTok photo slots reference JPEG/WebP only. |
| `accurate_ai_aigc_disclosure` | technical | PASS | AIGC used=false; code-render rationale recorded; on-image copy has no public AI self-reference. |
| `no_text_overlap` | technical | PASS | Declared layout boxes stay inside safe margins with no overlap. |
| `instagram_0800_1300_1900` | technical | PASS | Instagram local slots are 08:00 / 13:00 / 19:00 Europe/London each day. |
| `facebook_1000_1200_1800` | technical | PASS | Facebook local slots are 10:00 / 12:00 / 18:00 Europe/London each day. |
| `tiktok_1000_1200_1800` | technical | PASS | TikTok local slots are 10:00 / 12:00 / 18:00 Europe/London each day. |
| `exact_final_taylor_and_chatgpt_pass` | publication | FAIL | Technical QA only. Taylor PASS and ChatGPT PASS are not granted on these checksums/configs. |

## Assets

Locked copy only: `Busy week? Make the next step obvious.` Footer: `TEST DRY-RUN — not specialist-approved`.

| Asset | MIME / codec | Size | SHA-256 | AIGC | Audio |
| --- | --- | --- | --- | --- | --- |
| `t1_static_feed_jpg` | image/jpeg | 1080×1350 | `ae5afa66ee4c23bebe968ad62f85d7364c4e80b40f3d353558d8131671d8b7b2` | none | none |
| `t1_static_feed_webp` | image/webp | 1080×1350 | `cea71e3f9d1fa8a523e5b3d8878b6d2f1f38f4bf023083a3ad3e0ab2ce9f2e33` | none | none |
| `t2_reel_mp4` | video/mp4 / h264 | 1080×1920 | `94a1fef0a1cb85493571d3df095d8ab58afc609d6dc73562e6f21741c174b731` | none | none |
| `t3_alt_feed_jpg` | image/jpeg | 1080×1350 | `e072fee9297051ccaa51054b3d80883046188a7a79c4e661f0a3155b89b033e9` | none | none |
| `t3_alt_feed_webp` | image/webp | 1080×1350 | `6c3921e3db716839014763242ac71305674651a0f24b09c9492c4fe0d485f2e1` | none | none |

Calendar: `assets/week-2026-09-21/calendar.json` — 7 days × Instagram 08:00/13:00/19:00, Facebook 10:00/12:00/18:00, TikTok 10:00/12:00/18:00.
Treatments rotate `t1_static` → `t2_reel` → `t3_alt` on each platform so consecutive slots never share a core treatment. All slots are silent.
TikTok photo slots use JPEG/WebP only. No PNG files were produced.

## Stop

Next human/agent owners remain Taylor (specialist exact-final) then ChatGPT (independent exact-final). This worker does not continue.

