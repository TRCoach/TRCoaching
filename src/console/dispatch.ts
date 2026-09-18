import { permissionAllowed, resolveMode, type PermissionRegistry } from "../permissions.js";
import { newId } from "./ids.js";
import type { EvidenceMap } from "../types.js";
import type { ConsoleStore, DispatchStatus, StoredJob } from "./store.js";
import type { EvidenceCard, EvidenceEnv } from "./evidence.js";
import { collectEvidence } from "./evidence.js";
import { CursorDispatch, type WorkerDispatch, type WorkerResult } from "./cursor-v1.js";
import { ChatGptDispatch } from "./openai-responses.js";
import { parseGrokAlexOpsStatus, validateOpsStatusAgainstJob, type ParsedOpsStatus } from "./ops-status.js";

export { CursorDispatch, type WorkerDispatch, type WorkerResult } from "./cursor-v1.js";
export { ChatGptDispatch } from "./openai-responses.js";

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

export interface SlackCollectResult {
  statuses: ParsedOpsStatus[];
  rejected: Array<{ detail: string; reason: string }>;
}

export interface SlackTransport {
  configured: boolean;
  submit(envelope: OpsEnvelope): Promise<{ ok: boolean; externalId?: string; detail: string }>;
  collect(jobs: StoredJob[]): Promise<SlackCollectResult>;
  authTest(): Promise<{ ok: boolean; detail: string }>;
}

export class MemorySlackTransport implements SlackTransport {
  configured = true;
  posts: OpsEnvelope[] = [];
  inbox: string[] = [];
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
  async authTest() {
    return { ok: true, detail: "memory transport" };
  }
  async collect(jobs: StoredJob[]): Promise<SlackCollectResult> {
    return collectOpsStatusMessages(this.inbox, jobs);
  }
}

function slackErrorDetail(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/xoxb-[A-Za-z0-9-]+/g, "[redacted]").replace(/\s+/g, " ").slice(0, 160);
}

export class LiveSlackTransport implements SlackTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly approvedStatusSenderIds: string;
  constructor(
    token: string | undefined,
    private channel: string | undefined,
    private enabled: boolean,
    approvedStatusSenderIdsOrFetch: string | typeof fetch = "",
    fetchImpl?: typeof fetch,
  ) {
    this.token = token?.trim() || undefined;
    this.approvedStatusSenderIds = typeof approvedStatusSenderIdsOrFetch === "string" ? approvedStatusSenderIdsOrFetch : "";
    this.fetchImpl =
      (typeof approvedStatusSenderIdsOrFetch === "function" ? approvedStatusSenderIdsOrFetch : fetchImpl) ??
      ((input, init) => globalThis.fetch(input, init));
  }
  private token: string | undefined;
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
    try {
      const posted = await this.postMessage(text);
      if (!posted.ok && posted.error === "not_in_channel") {
        const joined = await this.joinChannel();
        if (joined.ok) return this.postMessage(text);
        return { ok: false, detail: `Slack API: not_in_channel (${joined.detail})` };
      }
      return posted;
    } catch (error) {
      return { ok: false, detail: `Slack API: ${slackErrorDetail(error, "request failed")}` };
    }
  }
  private async postMessage(text: string): Promise<{ ok: boolean; externalId?: string; detail: string; error?: string }> {
    const response = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: this.channel, text, unfurl_links: false }),
    });
    const raw = await response.text();
    let body: { ok?: boolean; ts?: string; error?: string };
    try {
      body = JSON.parse(raw) as { ok?: boolean; ts?: string; error?: string };
    } catch {
      return { ok: false, detail: `Slack API: non-JSON ${response.status}` };
    }
    if (!body.ok) return { ok: false, detail: `Slack API: ${body.error ?? response.status}`, error: body.error };
    return { ok: true, externalId: body.ts, detail: "posted to allowlisted #ai-ops" };
  }
  private async joinChannel(): Promise<{ ok: boolean; detail: string }> {
    if (!this.channel || !/^C[A-Z0-9]+$/.test(this.channel)) {
      return { ok: false, detail: "channel id required to join" };
    }
    try {
      const response = await this.fetchImpl("https://slack.com/api/conversations.join", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: this.channel }),
      });
      const raw = await response.text();
      let body: { ok?: boolean; error?: string };
      try {
        body = JSON.parse(raw) as { ok?: boolean; error?: string };
      } catch {
        return { ok: false, detail: `join non-JSON ${response.status}` };
      }
      if (!body.ok) return { ok: false, detail: body.error ?? "join failed" };
      return { ok: true, detail: "joined allowlisted channel" };
    } catch (error) {
      return { ok: false, detail: slackErrorDetail(error, "join request failed") };
    }
  }
  async authTest(): Promise<{ ok: boolean; detail: string }> {
    if (!this.token) return { ok: false, detail: "missing Slack token" };
    try {
      const response = await this.fetchImpl("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      const raw = await response.text();
      let body: { ok?: boolean; error?: string };
      try {
        body = JSON.parse(raw) as { ok?: boolean; error?: string };
      } catch {
        return { ok: false, detail: `auth.test non-JSON ${response.status}` };
      }
      if (!body.ok) return { ok: false, detail: body.error ?? "auth.test failed" };
      return { ok: true, detail: "auth.test ok" };
    } catch (error) {
      return { ok: false, detail: slackErrorDetail(error, "auth.test request failed") };
    }
  }
  async collect(jobs: StoredJob[]): Promise<SlackCollectResult> {
    if (!this.configured) return { statuses: [], rejected: [] };
    const approved = new Set(this.approvedStatusSenderIds.split(",").map((item) => item.trim()).filter(Boolean));
    if (!approved.size) {
      return { statuses: [], rejected: [{ detail: "", reason: "OPS_STATUS ingestion disabled: no approved Slack sender IDs configured" }] };
    }
    try {
      const response = await this.fetchImpl(
        `https://slack.com/api/conversations.history?channel=${encodeURIComponent(this.channel ?? "")}&limit=50`,
        { headers: { authorization: `Bearer ${this.token}` } },
      );
      const raw = await response.text();
      type SlackMessage = { text?: string; user?: string; bot_id?: string; app_id?: string; ts?: string };
      let body: { ok?: boolean; messages?: SlackMessage[]; error?: string };
      try {
        body = JSON.parse(raw) as { ok?: boolean; messages?: SlackMessage[]; error?: string };
      } catch {
        return { statuses: [], rejected: [{ detail: "", reason: `Slack history: non-JSON ${response.status}` }] };
      }
      if (!body.ok) {
        return { statuses: [], rejected: [{ detail: "", reason: `Slack history: ${body.error ?? response.status}` }] };
      }
      const replyParents = jobs
        .filter((job) => job.executor === "Slack" && /^\d+\.\d+$/.test(job.externalId ?? ""))
        .map((job) => job.externalId as string);
      const replyPages = await Promise.all(
        replyParents.map(async (ts) => {
          const replyResponse = await this.fetchImpl(
            `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(this.channel ?? "")}&ts=${encodeURIComponent(ts)}&limit=50`,
            { headers: { authorization: `Bearer ${this.token}` } },
          );
          const replyRaw = await replyResponse.text();
          try {
            const replyBody = JSON.parse(replyRaw) as { ok?: boolean; messages?: SlackMessage[] };
            return replyBody.ok ? replyBody.messages ?? [] : [];
          } catch {
            return [];
          }
        }),
      );
      const messages = [...(body.messages ?? []), ...replyPages.flat()];
      const unique = new Map(messages.map((item) => [item.ts ?? `${item.user}:${item.text}`, item]));
      const accepted: string[] = [];
      const rejected: Array<{ detail: string; reason: string }> = [];
      for (const message of unique.values()) {
        const text = message.text ?? "";
        if (!text.includes("OPS_STATUS")) continue;
        const senderIds = [message.user, message.bot_id, message.app_id].filter(Boolean) as string[];
        if (!senderIds.some((id) => approved.has(id))) {
          rejected.push({ detail: text.slice(0, 80), reason: "OPS_STATUS sender is not allowlisted" });
          continue;
        }
        accepted.push(text);
      }
      const parsed = collectOpsStatusMessages(accepted, jobs);
      return { statuses: parsed.statuses, rejected: [...rejected, ...parsed.rejected] };
    } catch (error) {
      return { statuses: [], rejected: [{ detail: "", reason: `Slack history: ${slackErrorDetail(error, "request failed")}` }] };
    }
  }
}

export function collectOpsStatusMessages(messages: string[], jobs: StoredJob[]): SlackCollectResult {
  const statuses: ParsedOpsStatus[] = [];
  const rejected: Array<{ detail: string; reason: string }> = [];
  for (const text of messages) {
    if (!text.includes("OPS_STATUS") && !text.startsWith("Grok_Alex:")) continue;
    const parsed = parseGrokAlexOpsStatus(text);
    if (!parsed.status) {
      rejected.push({ detail: text.slice(0, 80), reason: parsed.reason ?? "invalid OPS_STATUS" });
      continue;
    }
    const job = jobs.find((item) => item.id === parsed.status!.event_id || item.externalId === parsed.status!.event_id);
    if (!job) {
      rejected.push({ detail: parsed.status.event_id, reason: "unknown event" });
      continue;
    }
    const invalid = validateOpsStatusAgainstJob(parsed.status, job);
    if (invalid) {
      rejected.push({ detail: parsed.status.event_id, reason: invalid });
      continue;
    }
    statuses.push(parsed.status);
  }
  return { statuses, rejected };
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
  authorisedGovernedDispatchCount: number;
}

export interface RefreshResult {
  collected: number;
  rejected: Array<{ detail: string; reason: string }>;
  jobs: StoredJob[];
  unauthorizedBusinessWrites: 0;
  authorisedGovernedDispatchCount: number;
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

  ingestStatus(status: OpsStatus | ParsedOpsStatus): StoredJob | undefined {
    return this.store.exclusive((data) => {
      const job = data.jobs.find((item) => item.id === status.event_id || item.externalId === status.event_id);
      if (!job) return undefined;
      const parsed: ParsedOpsStatus = {
        kind: "OPS_STATUS",
        event_id: status.event_id,
        correlation_id: status.correlation_id,
        status: status.status,
        detail: status.detail,
        executor: "executor" in status ? status.executor : undefined,
      };
      const invalid = validateOpsStatusAgainstJob(parsed, job);
      if (invalid) return undefined;
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

  ingestStatusResult(status: OpsStatus | ParsedOpsStatus): { job?: StoredJob; rejected?: string } {
    const data = this.store.load();
    const job = data.jobs.find((item) => item.id === status.event_id || item.externalId === status.event_id);
    if (!job) return { rejected: "unknown event" };
    const parsed: ParsedOpsStatus = {
      kind: "OPS_STATUS",
      event_id: status.event_id,
      correlation_id: status.correlation_id,
      status: status.status,
      detail: status.detail,
      executor: "executor" in status ? status.executor : undefined,
    };
    const invalid = validateOpsStatusAgainstJob(parsed, job);
    if (invalid) return { rejected: invalid };
    return { job: this.ingestStatus(status) };
  }

  async progressToday(evidence: EvidenceMap = {}): Promise<DispatchSummary> {
    const mode = resolveMode(this.permissions);
    const decomposition = this.plan(mode, this.evidence);
    void evidence;
    return this.dispatchPlans(decomposition, "progress_everything_today", newId("corr"));
  }

  async dispatchPlans(
    decomposition: SubEventPlan[],
    parentAction: string,
    correlationId = newId("corr"),
  ): Promise<DispatchSummary> {
    const mode = resolveMode(this.permissions);
    const due = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const jobs: StoredJob[] = [];

    this.store.exclusive((data) => {
      if (!data.correlations.some((item) => item.id === correlationId)) {
        data.correlations.unshift({
          id: correlationId,
          createdAt: new Date().toISOString(),
          parentAction,
          eventIds: decomposition.map((item) => item.id),
        });
      }
    });

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
        this.applyWorker(job, await this.cursor.dispatch(job));
      } else if (step.executor === "ChatGPT") {
        this.applyWorker(job, await this.chatgpt.dispatch(job));
      } else {
        job.status = "COMPLETED";
        job.resultSummary = `${step.boundedAction} inspected via Control Plane dry-run. External write: 0.`;
      }
      job.updatedAt = new Date().toISOString();
      this.persist(job, correlationId);
      jobs.push(job);
    }

    const buckets = {
      progressed: jobs.filter((item) => item.status === "COMPLETED"),
      stillRunning: jobs.filter((item) => item.status === "RUNNING" || item.status === "QUEUED"),
      awaitingExternal: jobs.filter((item) => item.status === "AWAITING_EXTERNAL"),
      blocked: jobs.filter((item) => item.status === "BLOCKED"),
      founderRequired: jobs.filter((item) => item.status === "FOUNDER_REQUIRED"),
      failed: jobs.filter((item) => item.status === "FAILED"),
    };
    const actionLabel = parentAction.replaceAll("_", " ");
    const founderFriendlySummary = [
      `${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} — trusted mode ${mode}.`,
      `Progressed: ${buckets.progressed.length}. Still running: ${buckets.stillRunning.length}. Awaiting external: ${buckets.awaitingExternal.length}. Blocked: ${buckets.blocked.length}. Founder required: ${buckets.founderRequired.length}.`,
      "Linked bounded sub-events share this correlation id. Founder-gated work was not dispatched.",
      "Unavailable executors remain NOT_CONNECTED/BLOCKED; no completion is inferred. Unauthorized business writes: 0.",
    ].join(" ");
    const authorisedGovernedDispatchCount = jobs.filter((item) => Boolean(item.externalId)).length;
    return {
      correlationId,
      mode,
      ...buckets,
      founderFriendlySummary,
      decomposition,
      slackPosts: this.slack instanceof MemorySlackTransport ? this.slack.posts.length : 0,
      unauthorizedWrites: 0,
      authorisedGovernedDispatchCount,
    };
  }

  async refresh(): Promise<RefreshResult> {
    const current = this.store.load().jobs;
    const slack = await this.slack.collect(current);
    const rejected = [...slack.rejected];
    for (const status of slack.statuses) {
      const result = this.ingestStatusResult(status);
      if (result.rejected) rejected.push({ detail: status.event_id, reason: result.rejected });
    }
    for (const job of this.store.load().jobs.filter((item) => item.status === "AWAITING_EXTERNAL")) {
      if (job.executor === "Cursor") this.applyPersisted(job, await this.cursor.status(job));
      if (job.executor === "ChatGPT") this.applyPersisted(job, await this.chatgpt.status(job));
    }
    const jobs = this.store.load().jobs;
    return {
      collected: slack.statuses.length,
      rejected,
      jobs,
      unauthorizedBusinessWrites: 0,
      authorisedGovernedDispatchCount: jobs.filter((item) => Boolean(item.externalId)).length,
    };
  }

  writeScope(): "none" | "governed_dispatch_only" {
    const live =
      (this.slack instanceof LiveSlackTransport && this.slack.configured) ||
      this.cursor.configured ||
      this.chatgpt.configured;
    return live ? "governed_dispatch_only" : "none";
  }

  authorisedGovernedDispatchCount(): number {
    return this.store.load().jobs.filter((item) => Boolean(item.externalId)).length;
  }

  private applyWorker(job: StoredJob, result: WorkerResult): void {
    job.status = result.status;
    job.resultSummary = result.detail;
    job.externalId = result.externalId;
    job.runId = result.runId;
    job.model = result.model;
    job.tests = result.tests ?? [];
    job.blockers = result.blockers ?? [];
  }

  private applyPersisted(job: StoredJob, result: WorkerResult): void {
    this.applyWorker(job, result);
    job.updatedAt = new Date().toISOString();
    this.persist(job, job.correlationId);
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
