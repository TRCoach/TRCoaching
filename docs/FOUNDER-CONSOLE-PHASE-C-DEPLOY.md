# Phase C deployment (not performed in this task)

## Prerequisites (founder / Cloudflare account)

1. Cloudflare account on the **Free** plan. Do not upgrade to Workers Paid ($5/mo) without a separate founder approval.
2. `npx wrangler login`
3. `npx wrangler d1 create tr-founder-console` and paste the real `database_id` into `wrangler.toml`. A D1 id is already bound (`f393b2f3-161b-4241-9a70-bdb2fbd3b707`); that is a resource id, not proof of migrate/deploy.
4. `npx wrangler d1 migrations apply tr-founder-console --remote`
5. `npm run console:hash-password -- --pbkdf2 '<strong-password>'`
6. `npx wrangler secret put FOUNDER_SESSION_SECRET`
7. `npx wrangler secret put FOUNDER_AUTH_PASSWORD_HASH`
8. Optional read-only secrets only: Drive/CRM/Metricool/`rk_test_` Stripe/Superset/GitHub/Slack/Cursor.
9. Do **not** put `OPENAI_API_KEY` or set `FOUNDER_CHATGPT_DISPATCH=1`.
10. `npx wrangler deploy` → HTTPS `https://tr-founder-console.<account>.workers.dev`

## Rollback

`npx wrangler rollback` or redeploy a previous Worker version. D1 Time Travel restore is in `docs/FOUNDER-CONSOLE-PHASE-C-BACKUP.md`.

## CI

GitHub Actions stays secret-free. It builds and tests only. It does not deploy and does not receive provider credentials.

## Status

**workers.dev deploy was not performed or verified in this change.** Code + local/Worker-unit tests only. A D1 `database_id` in `wrangler.toml` is not a live console.
