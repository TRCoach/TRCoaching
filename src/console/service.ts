import { randomUUID } from "node:crypto";
import { invokeAdapter } from "../adapters/dry-run.js";
import { assertDryRun } from "../adapters/contracts.js";
import { loadLifecycle } from "../engine/state-engine.js";
import { loadPermissions, permissionAllowed, resolveMode, type OperatingMode, type PermissionRegistry } from "../permissions.js";
import { assertNoSensitivePayload } from "../sensitive.js";
import type { EvidenceMap, SystemOfRecord } from "../types.js";
import { getAction, loadFounderActions } from "./actions.js";
import { seedDecisions, seedLaneItems } from "./demo-state.js";
import { classifyCommand } from "./router.js";
import { MemoryStore, type ActionPreference, type ConsoleStore } from "./store.js";
import { collectEvidence, type EvidenceCard } from "./evidence.js";
import { DispatchEngine, MemorySlackTransport, type DispatchSummary } from "./dispatch.js";
import {
  LANE_IDS,
  type ActionResult,
  type ActivityRecord,
  type ActivityStatus,
  type CommandResult,
  type DecisionAct,
  type DecisionItem,
  type ExceptionItem,
  type FounderActionConfig,
  type LaneId,
  type LaneItem,
  type LaneOutcome,
  type LaneSnapshot,
  type MarketingTask,
  type UsageSnapshot,
  type WorkerStatus,
} from "./types.js";

const LANE_TITLES: Record<LaneId, string> = {
  leads: "Leads",
  nurture: "Nurture",
  sales: "Sales",
  offers: "Offers",
  payments: "Payments",
  closed_won: "Closed Won",
  onboarding: "Onboarding",
  screening_ready: "Screening / Ready",
  coaching: "Coaching",
  checkins: "Check-ins",
  adherence: "Adherence",
  renewal_cancellation: "Renewal / Cancellation",
  content: "Content",
  publication_errors: "Publication errors",
  stripe: "Stripe",
  blockers: "Blockers",
  jobs: "Jobs",
  decisions: "Decisions",
};

const LANE_PRIORITY: Record<LaneOutcome, number> = {
  founder_required: 0,
  blocked: 1,
  awaiting_external: 2,
  progressed: 3,
};

const TERMINAL_STATUSES = new Set<ActivityStatus>(["completed", "published"]);

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function inspectAdapter(system: SystemOfRecord, action: string, evidence: EvidenceMap) {
  const result = invokeAdapter(system, action, evidence);
  assertDryRun(result);
  if (result.externalWrite) {
    throw new Error(`${system} attempted a live write`);
  }
  return result;
}

export interface ConsoleServiceOptions {
  store?: ConsoleStore;
  evidence?: EvidenceCard[];
  dispatch?: DispatchEngine;
}

export class ConsoleService {
  readonly permissions: PermissionRegistry;
  readonly store: ConsoleStore;
  readonly dispatch: DispatchEngine;
  readonly evidenceCards: EvidenceCard[];
  readonly startedAt = Date.now();
  items: LaneItem[];
  decisions: DecisionItem[];
  activity: ActivityRecord[] = [];
  jobs = 0;
  retries = 0;
  lastRuntimeMs = 0;
  lastDispatch?: DispatchSummary;

  constructor(
    permissions: PermissionRegistry = loadPermissions(),
    options: ConsoleServiceOptions = {},
  ) {
    this.permissions = permissions;
    this.store = options.store ?? new MemoryStore();
    this.evidenceCards = options.evidence ?? collectEvidence();
    this.dispatch =
      options.dispatch ??
      DispatchEngine.forTests(this.store, permissions, new MemorySlackTransport());
    this.items = seedLaneItems().map((item) => ({
      ...item,
      updatedAt: nowIso(),
      source: "control_plane",
      evidenceRefs: [item.ref],
      nextAction: item.outcome === "founder_required" ? "founder_decision" : "inspect",
    }));
    this.decisions = seedDecisions(nowIso()).map((item) => ({
      ...item,
      owner: "Founder",
      impact: "TEST simulation only — no provider mutation.",
      expiry: "until founder acts",
      nextTrigger: "approve_or_reject_or_request_evidence",
    }));
  }

  mode(): OperatingMode {
    return resolveMode(this.permissions);
  }

  private audit(
    correlationId: string,
    title: string,
    status: ActivityStatus,
    owner: string,
    system: string,
    summary: string,
    auditType: string,
    actionId?: string,
  ): ActivityRecord {
    if ((status === "requested" || status === "pending") && TERMINAL_STATUSES.has(status)) {
      throw new Error("requested/pending cannot be recorded as completed");
    }
    const record: ActivityRecord = {
      id: newId("act"),
      correlationId,
      actionId,
      title,
      status,
      requestedAt: nowIso(),
      owner,
      system,
      summary,
      dryRun: true,
      externalWrite: false,
      auditType,
    };
    this.activity.unshift(record);
    this.jobs += 1;
    return record;
  }

  overview(): { mode: OperatingMode; lanes: LaneSnapshot[]; exceptionFirst: LaneSnapshot[] } {
    const lanes = LANE_IDS.map((id) => {
      const items = this.items.filter((item) => item.lane === id);
      const worst = [...items].sort((a, b) => LANE_PRIORITY[a.outcome] - LANE_PRIORITY[b.outcome])[0];
      return {
        id,
        title: LANE_TITLES[id],
        owner: worst?.owner ?? "Alex",
        outcome: worst?.outcome ?? "blocked",
        items,
      };
    });
    const exceptionFirst = [...lanes].sort((a, b) => LANE_PRIORITY[a.outcome] - LANE_PRIORITY[b.outcome]);
    return { mode: this.mode(), lanes, exceptionFirst };
  }

  status(): WorkerStatus[] {
    const cards = this.evidenceCards;
    const card = (id: string) => cards.find((item) => item.id === id);
    const reach = (id: string): WorkerStatus["reachability"] => {
      const freshness = card(id)?.freshness;
      if (freshness === "NOT_CONNECTED") return "not_connected";
      if (freshness === "DEMO_FIXTURE") return "dry-run";
      return "not_connected";
    };
    return [
      { id: "chatgpt", label: "ChatGPT", role: "Operational manager / independent QA", reachability: reach("chatgpt"), credentialsExposed: false, detail: card("chatgpt")?.detail ?? "NOT_CONNECTED" },
      { id: "cursor", label: "Cursor", role: "Repeatable worker", reachability: reach("cursor"), credentialsExposed: false, detail: card("cursor")?.detail ?? "NOT_CONNECTED" },
      { id: "grok_alex", label: "Grok / Alex", role: "Routing and blockers", reachability: reach("slack"), credentialsExposed: false, detail: "Prefix Grok_Alex: OPS_EVENT only. No freeform Slack." },
      { id: "browser_operator", label: "Browser operator", role: "Authenticated clicks when authorised", reachability: "not_connected", credentialsExposed: false, detail: "Grok Bot only when separately authorised." },
      { id: "metricool", label: "Metricool", role: "Social scheduling/analytics", reachability: reach("metricool"), credentialsExposed: false, detail: card("metricool")?.detail ?? inspectAdapter("Metricool", "dry_run.ping", {}).detail },
      { id: "stripe", label: "Stripe", role: "Payment truth", reachability: reach("stripe"), credentialsExposed: false, detail: card("stripe")?.detail ?? inspectAdapter("Stripe", "dry_run.ping", {}).detail },
      { id: "superset", label: "Superset", role: "Coaching/delivery truth", reachability: reach("superset"), credentialsExposed: false, detail: card("superset")?.detail ?? inspectAdapter("Superset", "dry_run.ping", {}).detail },
      { id: "crm", label: "CRM", role: "Lead/commercial state", reachability: reach("crm"), credentialsExposed: false, detail: card("crm")?.detail ?? inspectAdapter("CRM", "dry_run.ping", {}).detail },
      { id: "drive", label: "Drive", role: "Policy/knowledge SoT", reachability: reach("drive"), credentialsExposed: false, detail: card("drive")?.detail ?? inspectAdapter("Drive", "dry_run.ping", {}).detail },
      { id: "slack", label: "Slack", role: "Event/command bus", reachability: reach("slack"), credentialsExposed: false, detail: card("slack")?.detail ?? inspectAdapter("Slack", "dry_run.ping", {}).detail },
    ];
  }

  usage(): UsageSnapshot {
    return {
      jobs: this.jobs,
      model: "deterministic-control-plane",
      runtimeMs: Date.now() - this.startedAt + this.lastRuntimeMs,
      retries: this.retries,
      estimatedCostUsd: null,
      costStatus: "unknown",
      note: "Cost is unknown-safe. Missing provider usage never renders as $0.00.",
    };
  }

  inbox(): DecisionItem[] {
    return this.decisions;
  }

  catalog() {
    return loadFounderActions();
  }

  snapshot() {
    const { lanes, exceptionFirst } = this.overview();
    return {
      mode: this.mode(),
      trustedModeSource: "permission_registry" as const,
      demo: true,
      testLabel: "TEST / DEMO",
      lifecycle: { id: loadLifecycle().id, states: loadLifecycle().states.length },
      exceptionFirst,
      lanes,
      actions: this.visibleActions(),
      inbox: this.inbox(),
      activity: this.activity,
      status: this.status(),
      usage: this.usage(),
      evidence: this.evidenceCards,
      jobs: this.store.load().jobs,
      preferences: this.preferences(),
      lastDispatch: this.lastDispatch,
      approveAllAvailable: false,
      externalWrites: 0,
    };
  }

  decide(id: string, act: DecisionAct): { ok: boolean; item?: DecisionItem; reason?: string; providerCalled: false; externalWrites: 0 } {
    if (act !== "approve" && act !== "reject" && act !== "request_evidence") {
      return { ok: false, reason: "unknown decision act", providerCalled: false, externalWrites: 0 };
    }
    const item = this.decisions.find((row) => row.id === id);
    if (!item) return { ok: false, reason: `decision ${id} not found`, providerCalled: false, externalWrites: 0 };
    if (item.status !== "pending" && item.status !== "more_evidence_requested") {
      return { ok: false, reason: "decision already resolved", providerCalled: false, externalWrites: 0 };
    }
    if (act === "approve" && this.mode() === "TEST") {
      item.status = "approved";
      item.notes = `${item.notes} TEST recorded founder approval only; no provider call.`;
      this.audit(newId("corr"), `Decision ${item.kind}`, "pending", "Founder", "control_plane", `Approved on paper only. ${item.kind} did not call a provider.`, "founder_decision", "show_founder_decisions");
      return { ok: true, item, providerCalled: false, externalWrites: 0 };
    }
    if (act === "approve") {
      item.status = "approved";
    } else if (act === "reject") {
      item.status = "rejected";
    } else {
      item.status = "more_evidence_requested";
    }
    this.audit(newId("corr"), `Decision ${item.kind}`, "pending", "Founder", "control_plane", `Founder ${act} for ${item.subjectRef}. No provider mutation.`, "founder_decision", "show_founder_decisions");
    return { ok: true, item, providerCalled: false, externalWrites: 0 };
  }

  runCommand(text: string, evidence: EvidenceMap = {}): CommandResult {
    const started = Date.now();
    assertNoSensitivePayload(evidence, "command");
    assertNoSensitivePayload({ text }, "command");
    const classification = classifyCommand(text);
    const correlationId = newId("corr");
    const mode = this.mode();
    if (classification.confidence === "unknown" || classification.confidence === "ambiguous" || classification.actionIds.length === 0) {
      const summary = `Unknown or ambiguous command. Routed to Alex (Grok_Alex:) and ChatGPT review. Trusted mode ${mode}. No provider write.`;
      this.audit(correlationId, "Unrouted command", "requested", "Alex", "Slack", summary, "unrouted_command");
      this.lastRuntimeMs += Date.now() - started;
      return {
        ok: false,
        correlationId,
        classification: { ...classification, escalateTo: classification.escalateTo ?? "Alex" },
        mode,
        results: [],
        founderFriendlySummary: summary,
        externalWrites: 0,
        dryRun: true,
        providerCalled: false,
      };
    }
    const results = classification.actionIds.map((actionId) => this.runAction(actionId, correlationId, evidence));
    const founderFriendlySummary = results.map((item) => item.founderFriendlySummary).join("\n\n");
    this.lastRuntimeMs += Date.now() - started;
    return {
      ok: results.every((item) => item.ok),
      correlationId,
      classification,
      mode,
      results,
      founderFriendlySummary,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  runAction(actionId: string, correlationId = newId("corr"), evidence: EvidenceMap = {}): ActionResult {
    const started = Date.now();
    assertNoSensitivePayload(evidence, "action");
    const mode = this.mode();
    if (actionId === "refund_this_client") {
      const result = this.refundPacket(correlationId, evidence);
      this.lastRuntimeMs += Date.now() - started;
      return result;
    }
    if (actionId === "progress_everything_today") {
      const result = this.progressEverything(correlationId);
      this.lastRuntimeMs += Date.now() - started;
      return result;
    }
    const config = getAction(actionId);
    if (!config) {
      return this.fail(actionId, "Unknown action", correlationId, mode, "unknown action fails closed");
    }
    const result = this.dispatchAction(config, correlationId, evidence, mode);
    this.lastRuntimeMs += Date.now() - started;
    return result;
  }

  private fail(actionId: string, title: string, correlationId: string, mode: OperatingMode, reason: string): ActionResult {
    const activity = [this.audit(correlationId, title, "requested", "Alex", "control_plane", reason, "failure", actionId)];
    return {
      ok: false,
      actionId,
      title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary: reason,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
      reason,
    };
  }

  private dispatchAction(config: FounderActionConfig, correlationId: string, evidence: EvidenceMap, mode: OperatingMode): ActionResult {
    switch (config.id) {
      case "run_daily_business_cycle":
        return this.dailyCycle(config, correlationId, mode);
      case "review_new_leads":
      case "progress_sales_pipeline":
        return this.progressLeads(config, correlationId, mode);
      case "check_payments":
        return this.checkPayments(config, correlationId, mode);
      case "progress_paid_clients":
      case "review_onboarding":
      case "review_coaching_clients":
        return this.progressPaid(config, correlationId, mode);
      case "process_weekly_checkins":
        return this.inspectLane(config, correlationId, mode, ["checkins"], "Weekly check-in codes inspected. Cursor may only plan dry-run open/close records.");
      case "review_adherence_risks":
        return this.inspectLane(config, correlationId, mode, ["adherence", "blockers"], "Adherence risks routed to Alex. No health judgement.");
      case "generate_next_weeks_marketing":
        return this.generateMarketing(config, correlationId, mode);
      case "review_marketing_performance":
        return this.inspectLane(config, correlationId, mode, ["content"], "Marketing performance pointers reviewed. Learning stays a versioned proposal.");
      case "schedule_approved_content":
        return this.scheduleCheck(config, correlationId, mode);
      case "check_publication_errors":
        return this.inspectLane(config, correlationId, mode, ["publication_errors", "content"], "Publication errors remain blocked without exact-final dual PASS.");
      case "run_controlled_beta_readiness_audit":
        return this.betaAudit(config, correlationId, mode, evidence);
      case "show_founder_decisions":
        return this.showDecisions(config, correlationId, mode);
      case "generate_weekly_ceo_brief":
        return this.ceoBrief(config, correlationId, mode);
      case "run_full_business_health_check":
        return this.healthCheck(config, correlationId, mode);
      default:
        return this.fail(config.id, config.title, correlationId, mode, "unhandled action fails closed");
    }
  }

  private dailyCycle(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const { lanes, exceptionFirst } = this.overview();
    const counts = { progressed: 0, blocked: 0, awaiting_external: 0, founder_required: 0 };
    for (const lane of lanes) counts[lane.outcome] += 1;
    const founderFriendlySummary = [
      `Daily Business Cycle — ${mode} dry-run. No agents were blindly woken.`,
      `Progressed: ${counts.progressed} lanes. Blocked: ${counts.blocked}. Awaiting external: ${counts.awaiting_external}. Founder required: ${counts.founder_required}.`,
      "Deterministic inspect only. External writes: 0.",
    ].join(" ");
    const activity = [
      this.audit(correlationId, config.title, "completed", config.owner, config.system, founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      lanes: exceptionFirst,
      exceptions: this.exceptionsFrom(exceptionFirst.filter((lane) => lane.outcome !== "progressed")),
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private progressLeads(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const leadLanes = this.overview().lanes.filter((lane) => ["leads", "nurture", "sales", "offers", "payments", "closed_won"].includes(lane.id));
    const taylorSam = this.items.filter((item) => (item.owner === "Taylor" || item.owner === "Sam") && ["leads", "nurture", "sales", "offers"].includes(item.lane));
    const exceptions = this.items.filter((item) => item.lane === "closed_won" || item.lane === "payments" || item.outcome === "blocked" || item.outcome === "founder_required");
    const founderFriendlySummary = [
      `${config.title} — trusted mode ${mode}.`,
      `Taylor/Sam work planned for ${taylorSam.map((item) => item.ref).join(", ") || "no open lead refs"}.`,
      `Exceptions: ${exceptions.map((item) => `${item.ref} (${item.reason})`).join(" ") || "none"}.`,
      "CRM inspect is dry-run. No provider write.",
    ].join(" ");
    inspectAdapter("CRM", "dry_run.inspect_pipeline", { lane: config.id });
    const activity = [
      this.audit(correlationId, config.title, "completed", config.owner, config.system, founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      lanes: leadLanes,
      exceptions: exceptions.map((item) => ({ ref: item.ref, owner: item.owner, reason: item.reason, outcome: item.outcome })),
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private checkPayments(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const paymentsAllowed = permissionAllowed(this.permissions, "payments", mode, {
      founder_stripe_live_unlock: true,
      founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
      payment_clear_owner: "Sam",
    });
    inspectAdapter("Stripe", "dry_run.inspect_payment", { stripe_payment_ref: "pi_test_console_not_live", payment_clear_owner: "Sam" });
    const founderFriendlySummary = [
      `Check Payments — trusted mode ${mode}. Sam owns payment_clear.`,
      paymentsAllowed.ok
        ? "Named unlock would allow CONTROLLED_BETA payments; this registry is not TEST-blocked."
        : `Live payments blocked: ${paymentsAllowed.reason}.`,
      "Stripe was inspected through the dry-run adapter only. No charge, refund, credit, or payment link.",
    ].join(" ");
    const exceptions: ExceptionItem[] = this.items
      .filter((item) => item.lane === "payments" || item.lane === "stripe" || item.lane === "closed_won")
      .map((item) => ({ ref: item.ref, owner: item.owner, reason: item.reason, outcome: item.outcome }));
    const activity = [
      this.audit(correlationId, config.title, "completed", "Sam", "Stripe", founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      exceptions,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private progressPaid(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const gates = this.items.filter((item) =>
      ["payments", "closed_won", "onboarding", "screening_ready", "coaching"].includes(item.lane),
    );
    const founderFriendlySummary = [
      `${config.title} — trusted mode ${mode}.`,
      "Payment truth: TEST Stripe refs only; live Closed Won is blocked.",
      "Onboarding/screening stay blocked without explicit health consent.",
      "Ready stays blocked without Jordan human evidence.",
      "Programme assignment stays founder-gated.",
      "No provider write. No Zone C payload.",
    ].join(" ");
    inspectAdapter("Superset", "dry_run.inspect_delivery_codes", { assignment_ref: "ASG-CONSOLE-001" });
    const activity = [
      this.audit(correlationId, config.title, "completed", config.owner, config.system, founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      exceptions: gates.map((item) => ({ ref: item.ref, owner: item.owner, reason: item.reason, outcome: item.outcome })),
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private inspectLane(
    config: FounderActionConfig,
    correlationId: string,
    mode: OperatingMode,
    lanes: LaneId[],
    summary: string,
  ): ActionResult {
    const selected = this.overview().lanes.filter((lane) => lanes.includes(lane.id));
    const founderFriendlySummary = `${config.title} — trusted mode ${mode}. ${summary} External writes: 0.`;
    const activity = [
      this.audit(correlationId, config.title, "completed", config.owner, config.system, founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      lanes: selected,
      exceptions: this.exceptionsFrom(selected),
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private generateMarketing(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const checksum = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const missingPasses = ["TAYLOR PASS", "CHATGPT PASS"];
    const tasks: MarketingTask[] = [
      { id: "mkt_plan", step: "plan", title: "Plan next week's marketing", status: "completed" },
      { id: "mkt_prod", step: "production", title: "Produce dry-run assets", status: "completed" },
      { id: "mkt_qa", step: "qa", title: "Automated QA", status: "completed" },
      { id: "mkt_taylor", step: "taylor_pass", title: "TAYLOR PASS", status: "pending", blockedReason: "Exact-final TAYLOR PASS missing" },
      { id: "mkt_chatgpt", step: "chatgpt_pass", title: "CHATGPT PASS", status: "pending", blockedReason: "Exact-final CHATGPT PASS missing" },
      {
        id: "mkt_sched",
        step: "scheduling_check",
        title: "Scheduling check",
        status: "requested",
        blockedReason: `${mode} blocks Metricool scheduling/publication. Missing: ${missingPasses.join(", ")}.`,
      },
    ];
    for (const task of tasks) {
      this.audit(correlationId, task.title, task.status, "Taylor", "Metricool", task.blockedReason ?? task.title, config.auditType, config.id);
    }
    inspectAdapter("Metricool", "dry_run.record_asset_pointer", { asset_checksum: checksum, asset_config_id: "scene-benchmark-v1" });
    const founderFriendlySummary = [
      `Generate Next Week’s Marketing — trusted mode ${mode}.`,
      "Linked dry-run tasks: plan → production → QA → Taylor PASS → ChatGPT PASS → scheduling check.",
      `Stopped before Metricool scheduling/publication. Missing exact-final passes: ${missingPasses.join(" and ")}.`,
      "No publication. External writes: 0.",
    ].join(" ");
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      tasks,
      activity: this.activity.filter((item) => item.correlationId === correlationId),
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private scheduleCheck(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const schedule = permissionAllowed(this.permissions, "metricool_schedule", mode, {});
    const missing = ["exact-final TAYLOR PASS", "exact-final CHATGPT PASS"];
    const founderFriendlySummary = [
      `Schedule Approved Content — trusted mode ${mode}.`,
      schedule.ok ? "Schedule permission would be allowed, but exact-final passes are still missing." : `Scheduling blocked: ${schedule.reason}.`,
      `Missing: ${missing.join(" and ")}. TEST never publishes or calls Metricool schedule.`,
    ].join(" ");
    const tasks: MarketingTask[] = [
      {
        id: "sched_check",
        step: "scheduling_check",
        title: "Scheduling check",
        status: "requested",
        blockedReason: founderFriendlySummary,
      },
    ];
    const activity = [
      this.audit(correlationId, config.title, "requested", "Taylor", "Metricool", founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      tasks,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private betaAudit(config: FounderActionConfig, correlationId: string, mode: OperatingMode, evidence: EvidenceMap): ActionResult {
    void evidence.operating_mode;
    const payments = permissionAllowed(this.permissions, "payments", mode, {
      founder_stripe_live_unlock: true,
      founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
      payment_clear_owner: "Sam",
    });
    const founderFriendlySummary = [
      `Controlled-Beta Readiness Audit — trusted mode ${mode} from the permission registry.`,
      `Event operating_mode was ignored. Repo currentMode stays ${this.permissions.currentMode}.`,
      payments.ok ? "Named payment unlock would pass in this mode." : `Payments still blocked: ${payments.reason}.`,
      "Consent, Ready, founder go-live, dual PASS, and refunds remain human gates.",
    ].join(" ");
    const activity = [
      this.audit(correlationId, config.title, "completed", "ChatGPT", "Drive", founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private showDecisions(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const founderFriendlySummary = [
      `Founder Decision Inbox — trusted mode ${mode}.`,
      `${this.decisions.filter((item) => item.status === "pending").length} pending packets.`,
      "Per-item Approve / Reject / Request more evidence only. Approve-all does not exist.",
      "TEST records decisions and never calls a provider.",
    ].join(" ");
    const activity = [
      this.audit(correlationId, config.title, "completed", "Founder", "Drive", founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      decisions: this.decisions,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private ceoBrief(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const { exceptionFirst } = this.overview();
    const lines = exceptionFirst
      .filter((lane) => lane.outcome !== "progressed")
      .map((lane) => `${lane.title}: ${lane.outcome} (${lane.items.map((item) => item.ref).join(", ")})`);
    const founderFriendlySummary = [
      `Weekly CEO Brief — trusted mode ${mode}. Demo/TEST labels apply.`,
      ...lines,
      "No client personal data or Zone C. External writes: 0.",
    ].join(" ");
    const activity = [
      this.audit(correlationId, config.title, "completed", "ChatGPT", "control_plane", founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      lanes: exceptionFirst,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private healthCheck(config: FounderActionConfig, correlationId: string, mode: OperatingMode): ActionResult {
    const adapters = (["Drive", "Metricool", "CRM", "Stripe", "Superset", "Slack"] as const).map((system) =>
      inspectAdapter(system, "dry_run.ping", {}),
    );
    const founderFriendlySummary = [
      `Full Business Health Check — trusted mode ${mode}.`,
      `Adapters dry-run: ${adapters.map((item) => item.adapter).join(", ")}.`,
      "This is operational health, not a clinical judgement.",
      "External writes: 0. Credentials exposed: none.",
    ].join(" ");
    const activity = [
      this.audit(correlationId, config.title, "completed", "ChatGPT", "control_plane", founderFriendlySummary, config.auditType, config.id),
    ];
    return {
      ok: true,
      actionId: config.id,
      title: config.title,
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      lanes: this.overview().exceptionFirst,
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private refundPacket(correlationId: string, evidence: EvidenceMap): ActionResult {
    const mode = this.mode();
    const item: DecisionItem = {
      id: newId("dec"),
      kind: "refund_credit",
      title: "Per-case refund/credit decision",
      subjectRef: String(evidence.closed_won_commercial_ref ?? "CAN-CONSOLE-001"),
      status: "pending",
      founderGate: true,
      createdAt: nowIso(),
      evidence: {
        founder_refund_credit_decision: "",
        automatic_refund: false,
      },
      notes: "No refund or credit was executed. Founder must decide per case.",
    };
    this.decisions.unshift(item);
    const refunds = permissionAllowed(this.permissions, "refunds_credits", mode, {
      founder_refund_credit_decision: "refund_approved",
      founder_decision_ref: "FD-REF-PACKET",
    });
    const founderFriendlySummary = [
      `Refund this client — trusted mode ${mode}.`,
      "A per-case Founder decision packet was created. No refund, credit, or Stripe call occurred.",
      refunds.ok ? "Refunds would be allowed in this trusted mode after a human decision." : `Money movement blocked: ${refunds.reason}.`,
      "Never automatic. Never approve-all.",
    ].join(" ");
    const activity = [
      this.audit(correlationId, "Refund this client", "requested", "Founder", "Stripe", founderFriendlySummary, "refund_packet", "refund_this_client"),
    ];
    return {
      ok: true,
      actionId: "refund_this_client",
      title: "Refund this client",
      correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary,
      inboxItem: item,
      decisions: [item],
      activity,
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }

  private exceptionsFrom(lanes: LaneSnapshot[]): ExceptionItem[] {
    return lanes.flatMap((lane) =>
      lane.items
        .filter((item) => item.outcome !== "progressed")
        .map((item) => ({ ref: item.ref, owner: item.owner, reason: item.reason, outcome: item.outcome })),
    );
  }

  preferences(): ActionPreference[] {
    const stored = this.store.load().preferences;
    return this.catalog().actions.map((action, index) => {
      const pref = stored.find((item) => item.id === action.id);
      return {
        id: action.id,
        visible: pref?.visible ?? true,
        order: pref?.order ?? index,
        displayName: pref?.displayName ?? action.title,
        icon: pref?.icon ?? "◆",
        description: pref?.description ?? action.success,
        confirm: pref?.confirm ?? action.founderGate,
      };
    });
  }

  savePreferences(next: ActionPreference[]): ActionPreference[] {
    const catalogIds = new Set(this.catalog().actions.map((item) => item.id));
    const clean = next.filter((item) => catalogIds.has(item.id)).map((item) => ({
      id: item.id,
      visible: item.visible,
      order: item.order,
      displayName: item.displayName,
      icon: item.icon,
      description: item.description,
      confirm: item.confirm,
    }));
    this.store.exclusive((data) => {
      data.preferences = clean;
    });
    return this.preferences();
  }

  visibleActions() {
    const prefs = this.preferences();
    return this.catalog()
      .actions.map((action) => {
        const pref = prefs.find((item) => item.id === action.id)!;
        return { ...action, title: pref.displayName, _pref: pref };
      })
      .filter((action) => action._pref.visible)
      .sort((a, b) => a._pref.order - b._pref.order);
  }

  detail(kind: string, id: string) {
    if (kind === "lane") {
      const lane = this.overview().lanes.find((item) => item.id === id);
      return {
        kind,
        id,
        title: lane?.title,
        owner: lane?.owner,
        state: lane?.outcome,
        blockers: lane?.items.filter((item) => item.outcome !== "progressed"),
        evidence: lane?.items,
        source: "control_plane",
        timestamps: { updatedAt: nowIso() },
        related: this.activity.filter((item) => item.summary.includes(id)).slice(0, 5),
        nextAction: lane?.outcome === "founder_required" ? "open_decision" : "run_related_action",
      };
    }
    if (kind === "decision") {
      const item = this.decisions.find((row) => row.id === id);
      return {
        kind,
        id,
        title: item?.title,
        owner: item?.owner ?? "Founder",
        state: item?.status,
        request: item?.notes,
        evidence: item?.evidence,
        impact: item?.impact,
        expiry: item?.expiry,
        nextTrigger: item?.nextTrigger,
        audit: this.activity.filter((row) => row.summary.includes(item?.subjectRef ?? id)),
        nextAction: "approve_or_reject_or_request_evidence",
      };
    }
    if (kind === "activity") {
      const item = this.activity.find((row) => row.id === id);
      return {
        kind,
        id,
        title: item?.title,
        owner: item?.owner,
        state: item?.status,
        evidence: { correlationId: item?.correlationId, auditType: item?.auditType },
        source: item?.system,
        timestamps: { requestedAt: item?.requestedAt },
        nextAction: item?.status === "requested" || item?.status === "pending" ? "wait" : "inspect",
      };
    }
    if (kind === "job") {
      const job = this.store.load().jobs.find((row) => row.id === id);
      return {
        kind,
        id,
        title: job?.title,
        owner: job?.owner,
        state: job?.status,
        evidence: job,
        source: job?.executor,
        nextAction: job?.founderGate ? "founder_decision" : "collect_status",
      };
    }
    if (kind === "action") {
      const action = this.catalog().actions.find((row) => row.id === id);
      return {
        kind,
        id,
        title: action?.title,
        owner: action?.owner,
        state: action?.workflowId,
        evidence: action,
        nextAction: action?.id,
        note: "Customization never changes permissions or gates.",
      };
    }
    return { kind, id, state: "UNKNOWN", nextAction: "none" };
  }

  progressEverything(correlationId = newId("corr")): ActionResult {
    const summary = this.lastDispatch;
    return this.wrapProgress(correlationId, summary);
  }

  async progressEverythingAsync(): Promise<ActionResult> {
    const dispatched = await this.dispatch.progressToday();
    this.lastDispatch = dispatched;
    this.jobs += dispatched.decomposition.length;
    this.audit(
      dispatched.correlationId,
      "Progress everything that can be progressed today",
      "completed",
      "Founder",
      "control_plane",
      dispatched.founderFriendlySummary,
      "progress_today",
      "progress_everything_today",
    );
    return this.wrapProgress(dispatched.correlationId, dispatched);
  }

  private wrapProgress(correlationId: string, dispatched?: DispatchSummary): ActionResult {
    const mode = this.mode();
    const summary =
      dispatched?.founderFriendlySummary ??
      "Dispatch not yet collected. Run progressEverythingAsync from the HTTP layer.";
    return {
      ok: true,
      actionId: "progress_everything_today",
      title: "Progress everything that can be progressed today",
      correlationId: dispatched?.correlationId ?? correlationId,
      mode,
      trustedModeSource: "permission_registry",
      founderFriendlySummary: summary,
      activity: this.activity.filter((item) => item.correlationId === (dispatched?.correlationId ?? correlationId)),
      externalWrites: 0,
      dryRun: true,
      providerCalled: false,
    };
  }
}
