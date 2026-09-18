export const OWNERS = [
  "Taylor",
  "Sam",
  "Jordan",
  "Alex",
  "ChatGPT",
  "Cursor",
  "Grok",
  "Founder",
] as const;
export type Owner = (typeof OWNERS)[number];

export const SYSTEMS = ["Drive", "Metricool", "CRM", "Stripe", "Superset", "Slack"] as const;
export type SystemOfRecord = (typeof SYSTEMS)[number];

export interface RetryPolicy {
  maxAttempts: number;
  backoffSeconds: number;
  escalateTo: Owner | "Alex";
  onExhausted: "fail_closed" | "hold_for_founder";
}

export type LifecycleTrack = "commercial" | "marketing_cycle" | "learning";

export interface LifecycleTransition {
  id: string;
  from: string;
  to: string;
  event: string;
  owner: Owner;
  requiredEvidence: string[];
  systemOfRecord: SystemOfRecord;
  automatedAction: string;
  guard: string;
  stopCondition: string;
  retryPolicy: RetryPolicy;
  nextTrigger: string;
  founderGate: boolean;
  idempotencyKey: string;
  track?: LifecycleTrack;
  requiredPermission?: string;
  learningDomain?: "sales" | "coaching" | "marketing";
}

export interface LifecycleModel {
  id: string;
  version: string;
  title: string;
  initialState: string;
  systemsOfRecord: Record<string, string>;
  owners: string[];
  states: string[];
  transitions: LifecycleTransition[];
}

export type EvidenceValue = string | number | boolean | null;
export type EvidenceMap = Record<string, EvidenceValue>;

export interface BusinessEvent {
  event_id: string;
  type: string;
  occurred_at: string;
  actor: Owner;
  source: SystemOfRecord | "control_plane";
  subject_ref?: string;
  evidence: EvidenceMap;
  idempotency_key: string;
  trace?: {
    repo?: string;
    task?: string;
    slack_prefix?: string;
  };
}

export type ApplyStatus = "applied" | "ignored_duplicate" | "rejected";

export interface ApplyResult {
  status: ApplyStatus;
  reason?: string;
  event_id: string;
  transition_id?: string;
  from?: string;
  to?: string;
  nextOwner?: Owner;
  nextAction?: string;
  nextTrigger?: string;
  founderGate?: boolean;
  automatedAction?: string;
  guard?: string;
  dryRun: true;
  externalWrite: false;
}

export interface ControlState {
  current: string;
  tracks: Record<LifecycleTrack, string>;
  seenEventIds: string[];
  seenIdempotencyKeys: string[];
  evidence: EvidenceMap;
  history: ApplyResult[];
}

export interface DryRunResult {
  adapter: SystemOfRecord;
  action: string;
  dryRun: true;
  externalWrite: false;
  accepted: boolean;
  detail: string;
}

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSpec {
  width: number;
  height: number;
  safe: { top: number; right: number; bottom: number; left: number };
  boxes: Rect[];
}

export interface SocialRenderConfig {
  id: string;
  copy: {
    headline: string;
    body: string;
    disclaimer: string;
  };
  palette: {
    background: string;
    ink: string;
    accent: string;
    muted: string;
  };
}
