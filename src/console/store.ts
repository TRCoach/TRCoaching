import { assertNoSensitivePayload } from "../sensitive.js";
import type { DecisionItem } from "./types.js";
import type { EvidenceCard } from "./evidence.js";

export const STORE_VERSION = 3;

export interface ActionPreference {
  id: string;
  visible: boolean;
  order: number;
  displayName: string;
  icon: string;
  description: string;
  confirm: boolean;
}

export interface StoredSession {
  id: string;
  tokenHash: string;
  csrf: string;
  createdAt: string;
  expiresAt: string;
  rotatedFrom?: string;
}

export interface StoredJob {
  id: string;
  correlationId: string;
  parentId?: string;
  title: string;
  owner: string;
  executor: string;
  status: DispatchStatus;
  boundedAction: string;
  evidenceRefs: string[];
  resultSummary: string;
  createdAt: string;
  updatedAt: string;
  externalId?: string;
  runId?: string;
  model?: string;
  tests?: string[];
  blockers?: string[];
  founderGate: boolean;
  handoff?: ChatGptSocialHandoff;
}

export interface StoredProbe {
  id: string;
  lastAttempted: string;
  evidenceLabel: string;
  bodyDiscarded: true;
}

export interface StoredCorrelation {
  id: string;
  createdAt: string;
  parentAction: string;
  eventIds: string[];
}

export interface StoredResultEnvelope {
  id: string;
  jobId: string;
  correlationId: string;
  status: DispatchStatus;
  detail: string;
  collectedAt: string;
}

export type DispatchStatus =
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_EXTERNAL"
  | "DISPATCHED_TO_GROK"
  | "CURSOR_PRODUCTION"
  | "AWAITING_TAYLOR_PASS"
  | "READY_FOR_CHATGPT"
  | "AWAITING_CHATGPT"
  | "CHATGPT_QA_PASSED"
  | "METRICOOL_SCHEDULED"
  | "PROVIDER_VERIFIED"
  | "BLOCKED"
  | "FOUNDER_REQUIRED"
  | "COMPLETED"
  | "FAILED";

export const SOCIAL_VISIBLE_STATUSES = [
  "DISPATCHED_TO_GROK",
  "CURSOR_PRODUCTION",
  "AWAITING_TAYLOR_PASS",
  "READY_FOR_CHATGPT",
  "AWAITING_CHATGPT",
  "CHATGPT_QA_PASSED",
  "METRICOOL_SCHEDULED",
  "PROVIDER_VERIFIED",
  "BLOCKED",
] as const;

export const SOCIAL_AWAITING_STATUSES = new Set<DispatchStatus>([
  "AWAITING_EXTERNAL",
  "DISPATCHED_TO_GROK",
  "CURSOR_PRODUCTION",
  "AWAITING_TAYLOR_PASS",
  "READY_FOR_CHATGPT",
  "AWAITING_CHATGPT",
]);

export const SOCIAL_PROGRESSED_STATUSES = new Set<DispatchStatus>([
  "COMPLETED",
  "CHATGPT_QA_PASSED",
  "METRICOOL_SCHEDULED",
  "PROVIDER_VERIFIED",
]);

export interface ChatGptSocialHandoff {
  kind: "CHATGPT_SOCIAL_ACTION";
  correlationId: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  sopEvidenceRefs: string[];
  taylorGrokOutput: string;
  finalCaptions: string[];
  finalMediaAssetRefs: string[];
  targetNetworks: string[];
  targetPostingTimes: {
    instagram: string[];
    facebook: string[];
    tiktok: string[];
  };
  technicalQa: string;
  taylorPassState: "pending" | "PASS" | "FAIL";
  duplicationAudioContentChecks: string[];
  aiPublicCopyControl: string;
  metricoolExecutionOwner: "personal_chatgpt";
  consoleMetricoolApi: "not_used";
  independentExactFinalQaOwner: "personal_chatgpt";
  nativeAiDisclosureOwner: "personal_chatgpt";
  providerReadbackOwner: "personal_chatgpt";
  returnFields: string[];
}

export interface StoredAudit {
  id: string;
  at: string;
  actor: string;
  type: string;
  summary: string;
  correlationId?: string;
}

export interface StoredLaneState {
  ref: string;
  lane: string;
  outcome?: "progressed" | "blocked" | "awaiting_external" | "founder_required";
  reason?: string;
  nextAction?: string;
  updatedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface StoreData {
  version: number;
  revision: number;
  writerId?: string;
  writerExpiresAt?: string;
  lastRefreshAt?: string;
  sessions: StoredSession[];
  preferences: ActionPreference[];
  jobs: StoredJob[];
  audits: StoredAudit[];
  laneStates: StoredLaneState[];
  probes: StoredProbe[];
  decisions: DecisionItem[];
  evidenceCards: EvidenceCard[];
  correlations: StoredCorrelation[];
  resultEnvelopes: StoredResultEnvelope[];
  rateLimits: Record<string, number[]>;
}

export interface ConsoleStore {
  load(): StoreData;
  save(data: StoreData): void;
  exclusive<T>(fn: (data: StoreData) => T): T;
}

export function emptyData(): StoreData {
  return {
    version: STORE_VERSION,
    revision: 0,
    sessions: [],
    preferences: [],
    jobs: [],
    audits: [],
    laneStates: [],
    probes: [],
    decisions: [],
    evidenceCards: [],
    correlations: [],
    resultEnvelopes: [],
    rateLimits: {},
  };
}

export function migrate(raw: StoreData): StoreData {
  const data = { ...emptyData(), ...(raw ?? emptyData()) };
  data.sessions ??= [];
  data.preferences ??= [];
  data.jobs ??= [];
  data.audits ??= [];
  data.laneStates ??= [];
  data.probes ??= [];
  data.decisions ??= [];
  data.evidenceCards ??= [];
  data.correlations ??= [];
  data.resultEnvelopes ??= [];
  data.rateLimits ??= {};
  data.revision ??= 0;
  if (!data.version || data.version < 1) data.version = 1;
  if (data.version === 1) {
    data.version = 2;
    for (const job of data.jobs) {
      job.tests ??= [];
      job.blockers ??= [];
    }
  }
  if (data.version === 2) {
    data.version = 3;
    data.revision ??= 0;
    data.decisions ??= [];
    data.evidenceCards ??= [];
    data.correlations ??= [];
    data.resultEnvelopes ??= [];
  }
  for (const job of data.jobs) {
    job.tests ??= [];
    job.blockers ??= [];
  }
  if (data.version !== STORE_VERSION) {
    throw new Error(`unsupported store version ${data.version}`);
  }
  assertNoSensitivePayload(data, "store");
  return data;
}

export class MemoryStore implements ConsoleStore {
  private data = emptyData();

  load(): StoreData {
    return structuredClone(this.data);
  }

  save(data: StoreData): void {
    assertNoSensitivePayload(data, "store");
    this.data = migrate(structuredClone(data));
  }

  exclusive<T>(fn: (data: StoreData) => T): T {
    const data = this.load();
    const result = fn(data);
    this.save(data);
    return result;
  }
}
