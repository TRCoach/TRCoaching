# Slack command workflow and handoff convention

## Rules

- Slack is the event/command bus, not a client record.
- No client personal data or Zone C health detail in Slack.
- Cursor messages name `TRCoach/TRCoaching` and contain one bounded task.
- Actionable requests to Alex use the exact prefix `Grok_Alex:`.

## Command pattern

```
/tr event <type> ref=<opaque> evidence.<key>=<value>
```

The control plane validates, deduplicates, and returns next owner / action / trigger. It does not write to Stripe, Metricool, CRM, Drive, or Superset.

## Handoff payload

See `schemas/handoff.schema.json`. Required: `repo=TRCoach/TRCoaching`, `bounded_task`, `contains_client_pii=false`, `contains_zone_c=false`.

## Example Alex route

```
Grok_Alex: TRCoach/TRCoaching — route blocker publishEligible=false until exact-final dual PASS on scene-benchmark-v1.
```
