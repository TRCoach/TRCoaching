import type { EvidenceMap, Owner, SystemOfRecord } from "../types.js";
import type { OperatingMode } from "../permissions.js";

export const FOUNDER_ACTION_TITLES = [
  "Run Daily Business Cycle",
  "Review New Leads",
  "Progress Sales Pipeline",
  "Check Payments",
  "Progress Paid Clients",
  "Review Onboarding",
  "Review Coaching Clients",
  "Process Weekly Check-ins",
  "Review Adherence Risks",
  "Generate Next Week’s Marketing",
  "Review Marketing Performance",
  "Schedule Approved Content",
  "Check Publication Errors",
  "Run Controlled-Beta Readiness Audit",
  "Show Founder Decisions",
  "Generate Weekly CEO Brief",
  "Run Full Business Health Check",
] as const;

export const LANE_IDS = [
  "leads",
  "nurture",
  "sales",
  "offers",
  "payments",
  "closed_won",
  "onboarding",
  "screening_ready",
  "coaching",
  "checkins",
  "adherence",
  "renewal_cancellation",
  "content",
  "publication_errors",
  "stripe",
  "blockers",
  "jobs",
  "decisions",
] as const;

export type LaneId = (typeof LANE_IDS)[number];
export type LaneOutcome = "progressed" | "blocked" | "awaiting_external" | "founder_required";
export type ActivityStatus = "requested" | "queued" | "scheduled" | "pending" | "published" | "completed";
export type DecisionKind =
  | "stripe_unlock"
  | "refund_credit"
  | "first_client_programme_golive"
  | "health_safety"
  | "privacy_legal"
  | "paid_spend"
  | "irreversible_security";
export type DecisionStatus = "pending" | "approved" | "rejected" | "more_evidence_requested";
export type DecisionAct = "approve" | "reject" | "request_evidence";

export interface FounderActionConfig {
  id: string;
  title: string;
  workflowId: string;
  stateRequirements: string[];
  evidenceRequirements: string[];
  owner: Owner | "Founder";
  system: SystemOfRecord | "control_plane";
  allowedActions: string[];
  forbiddenActions: string[];
  founderGate: boolean;
  success: string;
  failureEscalation: string;
  auditType: string;
}

export interface FounderActionCatalog {
  id: string;
  version: string;
  actions: FounderActionConfig[];
}

export interface LaneItem {
  ref: string;
  lane: LaneId;
  state: string;
  owner: Owner;
  outcome: LaneOutcome;
  reason: string;
}

export interface LaneSnapshot {
  id: LaneId;
  title: string;
  owner: string;
  outcome: LaneOutcome;
  items: LaneItem[];
}

export interface ActivityRecord {
  id: string;
  correlationId: string;
  actionId?: string;
  title: string;
  status: ActivityStatus;
  requestedAt: string;
  owner: string;
  system: string;
  summary: string;
  dryRun: true;
  externalWrite: false;
  auditType: string;
}

export interface DecisionItem {
  id: string;
  kind: DecisionKind;
  title: string;
  subjectRef: string;
  status: DecisionStatus;
  founderGate: true;
  createdAt: string;
  evidence: EvidenceMap;
  notes: string;
}

export interface MarketingTask {
  id: string;
  step: "plan" | "production" | "qa" | "taylor_pass" | "chatgpt_pass" | "scheduling_check";
  title: string;
  status: ActivityStatus;
  blockedReason?: string;
}

export interface ExceptionItem {
  ref: string;
  owner: string;
  reason: string;
  outcome: LaneOutcome;
}

export interface UsageSnapshot {
  jobs: number;
  model: string;
  runtimeMs: number;
  retries: number;
  estimatedCostUsd: null;
  costStatus: "unknown";
  note: string;
}

export interface WorkerStatus {
  id: string;
  label: string;
  role: string;
  reachability: "dry-run" | "not_connected" | "localhost_only";
  credentialsExposed: false;
  detail: string;
}

export interface CommandClassification {
  raw: string;
  normalized: string;
  confidence: "exact" | "keyword" | "ambiguous" | "unknown";
  actionIds: string[];
  escalateTo?: "Alex" | "ChatGPT";
}

export interface ActionResult {
  ok: boolean;
  actionId: string;
  title: string;
  correlationId: string;
  mode: OperatingMode;
  trustedModeSource: "permission_registry";
  founderFriendlySummary: string;
  lanes?: LaneSnapshot[];
  tasks?: MarketingTask[];
  exceptions?: ExceptionItem[];
  decisions?: DecisionItem[];
  inboxItem?: DecisionItem;
  activity: ActivityRecord[];
  externalWrites: 0;
  dryRun: true;
  providerCalled: false;
  reason?: string;
}

export interface CommandResult {
  ok: boolean;
  correlationId: string;
  classification: CommandClassification;
  mode: OperatingMode;
  results: ActionResult[];
  founderFriendlySummary: string;
  externalWrites: 0;
  dryRun: true;
  providerCalled: false;
}

export const REQUIRED_ACTION_FIELDS = [
  "id",
  "title",
  "workflowId",
  "stateRequirements",
  "evidenceRequirements",
  "owner",
  "system",
  "allowedActions",
  "forbiddenActions",
  "founderGate",
  "success",
  "failureEscalation",
  "auditType",
] as const;
