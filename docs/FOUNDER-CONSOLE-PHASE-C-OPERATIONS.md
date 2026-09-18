# Phase C operations

- Collect worker results: `POST /api/jobs/refresh` (15s throttle).
- Refresh evidence cards: `POST /api/evidence/refresh` (metadata probes; bodies discarded).
- Slack rehearsal: `POST /api/rehearsal/slack` then ingest matching `Grok_Alex: OPS_STATUS`.
- Cursor rehearsal: `POST /api/rehearsal/cursor` (`autoCreatePR=false`, current branch only).
- OpenAI: disabled. Health reports `openaiDisabled: true`.
- Mode stays TEST. Spoofed `operating_mode` is ignored.
- Single-process local JSON is for localhost only. Hosted state is D1.

Hard stops unchanged: no live Stripe money movement, no publication, no paid spend, no Zone C on this bus, no public/anonymous console.
