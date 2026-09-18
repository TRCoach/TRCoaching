# System-of-record map

| Question | System | Repo may store |
| --- | --- | --- |
| What is policy? | Drive | Title + as-of + `${ENV}` id placeholder |
| Was a post scheduled / how did it perform? | Metricool | Non-PII campaign refs |
| Where is the lead/commercial stage? | CRM | Opaque enquiry/offer refs |
| Did money move? | Stripe | Payment ref, livemode, status |
| Is delivery/coaching in progress? | Superset | Assignment/check-in codes |
| Who is blocked and who should act? | Slack | `Grok_Alex:` + one bounded task |

The control plane is an orchestrator. It does not become a second knowledge base, CRM, or health record.
