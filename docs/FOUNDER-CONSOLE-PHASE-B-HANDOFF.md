# Founder Console Phase B handoff

For later Drive continuity log and `#ai-ops` update.

## What is real now

- Authenticated Founder Console on the existing Phase A service  
- Persistence of sessions, preferences, jobs, audits  
- Governed dispatch for “Progress everything that can be progressed today.”  
- Slack envelope + idempotent fake transport; live path implemented but off by default  
- Honest connector freshness (never green without a verified read)

## What stays NOT_CONNECTED

- Drive/CRM/Metricool/Stripe/Superset/GitHub remain NOT_CONNECTED/UNKNOWN without server-only least-privilege tokens. Live probes (when configured) discard response bodies and persist only timestamps plus evidence labels.
- Cursor Cloud Agents API v1 adapter is wired but NOT_CONNECTED without `CURSOR_CLOUD_AGENT_TOKEN`
- ChatGPT/OpenAI Responses adapter is wired but spend stays disabled without `FOUNDER_CHATGPT_DISPATCH=1` + `OPENAI_API_KEY` + `OPENAI_MODEL`
- Slack live posts (requires founder-approved bot + #ai-ops allowlist)

## Do not do next without founder approval

- Buy hosting  
- Enable Slack or OpenAI spend  
- Any provider write beyond the allowlisted Slack OPS_EVENT  
- Public or anonymous deployment
