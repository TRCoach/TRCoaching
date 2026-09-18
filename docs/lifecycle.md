# Lifecycle

Machine-readable source: `model/lifecycle.json`. Every transition includes `id`, `from`, `to`, `event`, `owner`, `requiredEvidence`, `systemOfRecord`, `automatedAction`, `guard`, `stopCondition`, `retryPolicy`, `nextTrigger`, `founderGate`, and `idempotencyKey`.

## End-to-end

```mermaid
flowchart TD
  U[uninitialized] --> M[marketing_active]
  M --> SE[social_enquiry_received]
  M --> SD[social_asset_drafted]
  SD --> SQ[social_qa_recorded]
  SQ -->|dual PASS only| PE[publish_eligible]
  SE --> CL[enquiry_classified]
  CL --> NU[nurture]
  CL --> Q[qualification]
  NU --> Q
  Q --> OF[offer_presented]
  Q --> LOST[closed_lost]
  LOST --> NU
  OF --> PP[payment_pending]
  PP --> PV[payment_verified]
  PP --> OF
  PV -->|live succeeded only| CW[closed_won]
  CW --> ON[onboarding_started]
  ON --> PN[privacy_notice_issued]
  PN --> HC[health_consent_recorded]
  HC --> SC[screening]
  SC --> RY[ready]
  RY --> PD[programme_draft]
  PD -->|founder| FG[founder_golive_approved]
  FG --> AW[assigned_welcomed]
  AW --> AC[active_coaching]
  AC --> WK[weekly_checkin_open]
  WK --> AC
  WK --> AE[adherence_escalation]
  AC --> AE
  AE --> AC
  AC --> RR[retention_review]
  RR --> RO[renewal_offered]
  RO --> AC
  AC --> CR[cancellation_requested]
  RR --> CR
  RO --> CR
  ON --> CR
  CR -->|refund or credit| RH[refund_credit_hold]
  RH --> OB[offboarding]
  CR -->|money_movement none| OB
```

Social publication is not a commercial-state shortcut. First-client go-live stays on the founder gate.

Parallel tracks (do not consume commercial state):

```mermaid
flowchart LR
  idle[marketing_cycle_idle] --> analyse
  analyse --> generate
  generate --> produce
  produce --> qa
  qa --> taylorPass[Taylor PASS]
  taylorPass --> chatgptPass[ChatGPT PASS]
  chatgptPass --> scheduled[Metricool schedule]
  scheduled --> monitor
  monitor --> idle
  monitor --> learnM[propose_marketing_learning]
  learnIdle[learning_idle] --> sales[propose_sales_learning]
  learnIdle --> coach[propose_coaching_learning]
  learnIdle --> learnM
  sales --> review[ChatGPT review]
  coach --> review
  learnM --> review
  review --> founder[founder SOP approval]
  founder --> learnIdle
```
