# D1 Time Travel and export runbook

D1 Free Time Travel retains **7 days** of point-in-time restore.

## Restore (manual)

```bash
npx wrangler d1 time-travel info tr-founder-console --remote
npx wrangler d1 time-travel restore tr-founder-console --remote --bookmark <BOOKMARK>
```

Confirm the bookmark before restore. This overwrites the live D1. Founder approval required.

## Periodic export (explicit approval required)

Exports may contain session hashes and operational metadata. They must **not** include provider secrets, payment details, client PII, or Zone C.

1. Founder writes an approval note (Drive decision log).
2. Only then:

```bash
npx wrangler d1 export tr-founder-console --remote --output /secure/path/console-export.sql
```

3. Store the file in a private, access-controlled location — not git, not Slack.

Until that approval exists, do not create or retain exports.
