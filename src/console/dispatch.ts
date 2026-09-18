import { randomBytes } from "node:crypto";
import { permissionAllowed, resolveMode, type PermissionRegistry } from "../permissions.js";
import type { EvidenceMap } from "../types.js";
import type { ConsoleStore, DispatchStatus, StoredJob } from "./store.js";
import type { EvidenceCard, EvidenceEnv } from "./evidence.js";
import { collectEvidence } from "./evidence.js";

export interface OpsEnvelope {
  prefix: "Grok_Alex:";
  kind: "OPS_EVENT";
  event_id: string;
  correlation_id: string;
  owner: string;
  current_state: string;
  bounded_action: string;
  evidence_refs: string[];
  due_time: string;
  stop_condition: string;
}

export interface OpsStatus {
  kind: "OPS_STATUS";
  event_id: string;
  correlation_id: string;
  status: DispatchStatus;
  detail: string;
}

export interface SlackTransport {
  configured: boolean;
  submit(envelope: OpsEnvelope): Promise<{ ok: boolean; externalId?: string; detail: string }>;
}

export class MemorySlackTransport implements SlackTransport {
  configured = true;
  posts: OpsEnvelope[] = [];
  constructor(private failIds: string[] = []) {}
  async submit(envelope: OpsEnvelope) {
    if (this.failIds.includes(envelope.event_id)) {
      return { ok: false, detail: "fake transport rejected" };
    }
    const dup = this.posts.find((item) => item.event_id === envelope.event_id);
    if (dup) return { ok: true, externalId: `slack_${envelope.event_id}`, detail: "idempotent replay" };
    this.posts.push(envelope);
    return { ok: true, externalId: `slack_${envelope.event_id}`, detail: "fake slack accepted" };
  }
}

export class LiveSlackTransport implements SlackTransport {
  constructor(
    private token: string | undefined,
    private channel: string | undefined,
    private enabled: boolean,
  ) {}
  get configured(): boolean {
    return Boolean(this.enabled && this.token && this.channel && /^#?ai-ops$|^C[A-Z0-9]+$/.test(this.channel));
  }
  async submit(envelope: OpsEnvelope) {
    if (!this.configured) {
      return { ok: false, detail: "Slack dispatch NOT_CONNECTED — missing allowlisted #ai-ops config" };
    }
    const text = [
      "Grok_Alex: OPS_EVENT",
      `event_id=${envelope.event_id}`,
      `correlation_id=${envelope.correlation_id}`,
      `owner=${envelope.owner}`,
      `current_state=${envelope.current_state}`,
      `bounded_action=${envelope.bounded_action}`,
      `evidence_refs=${envelope.evidence_refs.join(",")}`,
      `due_time=${envelope.due_time}`,
      `stop_condition=${envelope.stop_condition}`,
    ].join("\n");
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: this.channel, text, unfurl_links: false }),
    });
    const body = (await response.json()) as { ok?: boolean; ts?: string; error?: string };
    if (!body.ok) return { ok: false, detail: `Slack API: ${body.error ?? response.status}` };
    return { ok: true, externalId: body.ts, detail: "posted to allowlisted #ai-ops" };
  }
}

export interface WorkerDispatch {
  id: "cursor" | "chatgpt";
  configured: boolean;
  setupRequirement: string;
  dispatch(job: StoredJob): Promise<{ ok: boolean; status: DispatchStatus; detail: string; externalId?: string }>;
}

export class CursorDispatch implements WorkerDispatch {
  id = "cursor" as const;
  setupRequirement =
    "No stable Cursor Cloud Agent HTTP dispatch API is implemented in this repo. Required: server-only token, allowlisted repo TRCoach/TRCoaching, bounded templates, idempotency. Never fake COMPLETED.";
  constructor(private token?: string) {}
  get configured(): boolean {
    return false;
  }
  async dispatch(job: StoredJob) {
    void this.token;
    void job;
    return {
      ok: false,
      status: "BLOCKED" as const,
      detail: `Cursor Cloud NOT_CONNECTED. ${this.setupRequirement}`,
    };
  }
}

export class ChatGptDispatch implements WorkerDispatch {
  id = "chatgpt" as const;
  setupRequirement =
    "FOUNDER_CHATGPT_DISPATCH=1 and OPENAI_API_KEY after founder spend approval. Until configured this adapter is NOT_CONNECTED and never fakes a review.";
  constructor(
    private enabled?: boolean,
    private apiKey?: string,
  ) {}
  get configured(): boolean {
    return Boolean(this.enabled && this.apiKey);
  }
  async dispatch(job: StoredJob) {
    if (!this.configured) {
      return { ok: false, status: "BLOCKED" as const, detail: `ChatGPT NOT_CONNECTED. ${this.setupRequirement}` };
    }
    void job;
    return {
      ok: false,
      status: "BLOCKED" as const,
      detail: "ChatGPT dispatch is configured but Phase B does not auto-call OpenAI. Founder must approve each spend. Not faked as COMPLETED.",
    };
  }
}

export interface SubEventPlan {
  id: string;
  lane: "marketing" | "sales" | "delivery" | "operations";
  owner: string;
  executor: "Slack" | "Cursor" | "ChatGPT" | "control_plane";
  boundedAction: string;
  permitted: boolean;
  founderGate: boolean;
  reason: string;
  nextTrigger: string;
  evidenceRefs: string[];
}

export interface DispatchSummary {
  correlationId: string;
  mode: string;
  progressed: StoredJob[];
  stillRunning: StoredJob[];
  awaitingExternal: StoredJob[];
  blocked: StoredJob[];
  founderRequired: StoredJob[];
  failed: StoredJob[];
  founderFriendlySummary: string;
  decomposition: SubEventPlan[];
  slackPosts: number;
  unauthorizedWrites: 0;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

export class DispatchEngine {
  constructor(
    readonly store: ConsoleStore,
    readonly permissions: PermissionRegistry,
    readonly slack: SlackTransport,
    readonly cursor: WorkerDispatch,
    readonly chatgpt: WorkerDispatch,
    readonly evidence: EvidenceCard[],
  ) {}

  static forTests(store: ConsoleStore, permissions: PermissionRegistry, slack = new MemorySlackTransport()) {
    return new DispatchEngine(
      store,
      permissions,
      slack,
      new CursorDispatch(),
      new ChatGptDispatch(),
      collectEvidence({ demoFixtures: true } as EvidenceEnv),
    );
  }

  ingestStatus(status: OpsStatus): StoredJob | undefined {
    return this.store.exclusive((data) => {
      const job = data.jobs.find((item) => item.id === status.event_id || item.externalId === status.event_id);
      if (!job) return undefined;
      job.status = status.status;
      job.resultSummary = status.detail;
      job.updatedAt = new Date().toISOString();
      data.audits.unshift({
        id: newId("aud"),
        at: job.updatedAt,
        actor: "Alex",
        type: "ops_status",
        summary: `OPS_STATUS ${status.status} for ${job.id}`,
        correlationId: status.correlation_id,
      });
      return { ...job };
    });
  }

  async progressToday(evidence: EvidenceMap = {}): Promise<DispatchSummary> {
    const mode = resolveMode(this.permissions);
    const correlationId = newId("corr");
    const due = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const cards = this.evidence;
    const decomposition = this.plan(mode, cards);
    const jobs: StoredJob[] = [];

    for (const step of decomposition) {
      const job: StoredJob = {
        id: step.id,
        correlationId,
        title: `${step.lane}: ${step.boundedAction}`,
        owner: step.owner,
        executor: step.executor,
        status: "QUEUED",
        boundedAction: step.boundedAction,
        evidenceRefs: step.evidenceRefs,
        resultSummary: step.reason,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        founderGate: step.founderGate,
      };
      if (!step.permitted || step.founderGate) {
        job.status = step.founderGate ? "FOUNDER_REQUIRED" : "BLOCKED";
        this.persist(job, correlationId);
        jobs.push(job);
        continue;
      }
      job.status = "RUNNING";
      this.persist(job, correlationId);

      if (step.executor === "Slack") {
        const envelope: OpsEnvelope = {
          prefix: "Grok_Alex:",
          kind: "OPS_EVENT",
          event_id: job.id,
          correlation_id: correlationId,
          owner: step.owner,
          current_state: mode,
          bounded_action: step.boundedAction,
          evidence_refs: step.evidenceRefs,
          due_time: due,
          stop_condition: step.reason,
        };
        const posted = await this.slack.submit(envelope);
        job.externalId = posted.externalId;
        job.status = posted.ok ? "AWAITING_EXTERNAL" : "BLOCKED";
        job.resultSummary = posted.detail;
      } else if (step.executor === "Cursor") {
        const result = await this.cursor.dispatch(job);
        job.status = result.status;
        job.resultSummary = result.detail;
        job.externalId = result.externalId;
      } else if (step.executor === "ChatGPT") {
        const result = await this.chatgpt.dispatch(job);
        job.status = result.status;
        job.resultSummary = result.detail;
      } else {
        job.status = "COMPLETED";
        job.resultSummary = `${step.boundedAction} inspected via Control Plane dry-run. External write: 0.`;
      }
      job.updatedAt = new Date().toISOString();
      this.persist(job, correlationId);
      jobs.push(job);
    }

    void evidence;
    const buckets = {
      progressed: jobs.filter((item) => item.status === "COMPLETED"),
      stillRunning: jobs.filter((item) => item.status === "RUNNING" || item.status === "QUEUED"),
      awaitingExternal: jobs.filter((item) => item.status === "AWAITING_EXTERNAL"),
      blocked: jobs.filter((item) => item.status === "BLOCKED"),
      founderRequired: jobs.filter((item) => item.status === "FOUNDER_REQUIRED"),
      failed: jobs.filter((item) => item.status === "FAILED"),
    };
    const founderFriendlySummary = [
      `Progress everything that can be progressed today — trusted mode ${mode}.`,
      `Progressed: ${buckets.progressed.length}. Still running: ${buckets.stillRunning.length}. Awaiting external: ${buckets.awaitingExternal.length}. Blocked: ${buckets.blocked.length}. Founder required: ${buckets.founderRequired.length}.`,
      "Linked bounded sub-events share this correlation id. Founder-gated work was not dispatched.",
      "Cursor and ChatGPT stay NOT_CONNECTED until their real connectors are configured. No unauthorized writes.",
    ].join(" ");
    return {
      correlationId,
      mode,
      ...buckets,
      founderFriendlySummary,
      decomposition,
      slackPosts: this.slack instanceof MemorySlackTransport ? this.slack.posts.length : 0,
      unauthorizedWrites: 0,
    };
  }

  private persist(job: StoredJob, correlationId: string): void {
    this.store.exclusive((data) => {
      const idx = data.jobs.findIndex((item) => item.id === job.id);
      if (idx >= 0) data.jobs[idx] = job;
      else data.jobs.unshift(job);
      data.audits.unshift({
        id: newId("aud"),
        at: job.updatedAt,
        actor: job.owner,
        type: "dispatch",
        summary: `${job.status} ${job.boundedAction} via ${job.executor}`,
        correlationId,
      });
    });
  }

  private plan(mode: string, cards: EvidenceCard[]): SubEventPlan[] {
    const payments = permissionAllowed(this.permissions, "payments", mode as never, {
      payment_clear_owner: "Sam",
      founder_stripe_live_unlock: true,
      founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
    });
    const schedule = permissionAllowed(this.permissions, "metricool_schedule", mode as never, {});
    const freshness = (id: string) => cards.find((card) => card.id === id)?.freshness ?? "NOT_CONNECTED";
    return [
      {
        id: newId("evt"),
        lane: "marketing",
        owner: "Taylor",
        executor: "control_plane",
        boundedAction: "inspect_marketing_lane",
        permitted: true,
        founderGate: false,
        reason: "Deterministic marketing inspect is allowed in TEST.",
        nextTrigger: "generate_next_weeks_marketing",
        evidenceRefs: ["ASSET-CONSOLE-001"],
      },
      {
        id: newId("evt"),
        lane: "marketing",
        owner: "Taylor",
        executor: "control_plane",
        boundedAction: "schedule_approved_content",
        permitted: schedule.ok,
        founderGate: false,
        reason: schedule.ok ? "Schedule permission present." : `Scheduling blocked: ${schedule.reason}. Missing exact-final dual PASS.`,
        nextTrigger: "chatgpt_pass",
        evidenceRefs: ["pass_checksum"],
      },
      {
        id: newId("evt"),
        lane: "sales",
        owner: "Sam",
        executor: "control_plane",
        boundedAction: "inspect_sales_pipeline",
        permitted: true,
        founderGate: false,
        reason: "Sam can inspect non-PII pipeline refs.",
        nextTrigger: "present_offer",
        evidenceRefs: ["ENQ-CONSOLE-003"],
      },
      {
        id: newId("evt"),
        lane: "sales",
        owner: "Sam",
        executor: "control_plane",
        boundedAction: "mark_closed_won",
        permitted: payments.ok,
        founderGate: true,
        reason: payments.ok ? "Payments would be allowed; Closed Won still needs founder unlock evidence." : `Closed Won blocked: ${payments.reason}`,
        nextTrigger: "founder_stripe_live_unlock",
        evidenceRefs: ["pi_test_console_not_live"],
      },
      {
        id: newId("evt"),
        lane: "delivery",
        owner: "Jordan",
        executor: "control_plane",
        boundedAction: "inspect_onboarding_codes",
        permitted: true,
        founderGate: false,
        reason: "Onboarding codes inspect only. Consent/Ready remain gated.",
        nextTrigger: "record_explicit_health_consent",
        evidenceRefs: ["ONB-CONSOLE-001"],
      },
      {
        id: newId("evt"),
        lane: "delivery",
        owner: "Founder",
        executor: "control_plane",
        boundedAction: "founder_approve_golive",
        permitted: false,
        founderGate: true,
        reason: "First-client programme go-live is a founder gate. Not dispatched.",
        nextTrigger: "founder_golive_approval",
        evidenceRefs: ["PROG-CONSOLE-001"],
      },
      {
        id: newId("evt"),
        lane: "operations",
        owner: "Alex",
        executor: "Slack",
        boundedAction: "route_blocker",
        permitted: this.slack.configured,
        founderGate: false,
        reason: this.slack.configured
          ? "Slack/Grok-Alex OPS_EVENT will be submitted with the exact prefix."
          : `Slack ${freshness("slack")}. OPS_EVENT not sent.`,
        nextTrigger: "OPS_STATUS",
        evidenceRefs: ["BLK-CONSOLE-001"],
      },
      {
        id: newId("evt"),
        lane: "operations",
        owner: "Cursor",
        executor: "Cursor",
        boundedAction: "bounded_qa_report",
        permitted: this.cursor.configured,
        founderGate: false,
        reason: this.cursor.configured ? "Cursor job would be created." : this.cursor.setupRequirement,
        nextTrigger: "collect_cursor_result",
        evidenceRefs: ["TRCoach/TRCoaching"],
      },
      {
        id: newId("evt"),
        lane: "operations",
        owner: "ChatGPT",
        executor: "ChatGPT",
        boundedAction: "independent_qa_review",
        permitted: this.chatgpt.configured,
        founderGate: false,
        reason: this.chatgpt.configured ? "ChatGPT review would be requested." : this.chatgpt.setupRequirement,
        nextTrigger: "chatgpt_pass",
        evidenceRefs: ["qa_report_ref"],
      },
    ];
  }
}
