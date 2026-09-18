import type { PermissionRegistry } from "../permissions.js";
import { resolveMode } from "../permissions.js";
import { CursorDispatch, CURSOR_ALLOW_REPO_EXACT } from "./cursor-v1.js";
import type { SlackTransport, OpsEnvelope } from "./dispatch.js";
import { newId } from "./ids.js";
import { parseGrokAlexOpsStatus, validateOpsStatusAgainstJob } from "./ops-status.js";
import type { ConsoleStore, StoredJob } from "./store.js";

export const SLACK_REHEARSAL_ACTION = "slack_grok_rehearsal";
export const CURSOR_REHEARSAL_ACTION = "cursor_bounded_rehearsal";
export const CURSOR_REHEARSAL_REF = "cursor/tr-training-control-plane-fcd0";

function id(prefix: string): string {
  return newId(prefix);
}

export async function runSlackRehearsal(
  store: ConsoleStore,
  permissions: PermissionRegistry,
  slack: SlackTransport,
): Promise<{ ok: boolean; job: StoredJob; envelope?: OpsEnvelope; reason?: string }> {
  if (!slack.configured) {
    const job = persistBlocked(store, "Slack", SLACK_REHEARSAL_ACTION, "Slack rehearsal NOT_CONNECTED — allowlisted #ai-ops not configured.");
    return { ok: false, job, reason: job.resultSummary };
  }
  const correlationId = id("corr");
  const eventId = id("evt");
  const mode = resolveMode(permissions);
  const envelope: OpsEnvelope = {
    prefix: "Grok_Alex:",
    kind: "OPS_EVENT",
    event_id: eventId,
    correlation_id: correlationId,
    owner: "Alex",
    current_state: mode,
    bounded_action: SLACK_REHEARSAL_ACTION,
    evidence_refs: ["TRCoach/TRCoaching"],
    due_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    stop_condition: "Ingest one matching Grok_Alex: OPS_STATUS only. No arbitrary Slack posts. No business-system writes.",
  };
  const job: StoredJob = {
    id: eventId,
    correlationId,
    title: "Slack/Grok first controlled rehearsal",
    owner: "Alex",
    executor: "Slack",
    status: "RUNNING",
    boundedAction: SLACK_REHEARSAL_ACTION,
    evidenceRefs: envelope.evidence_refs,
    resultSummary: "Rehearsal OPS_EVENT queued.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    founderGate: false,
  };
  store.exclusive((data) => {
    data.jobs.unshift(job);
    data.correlations.unshift({
      id: correlationId,
      createdAt: job.createdAt,
      parentAction: SLACK_REHEARSAL_ACTION,
      eventIds: [eventId],
    });
  });
  const posted = await slack.submit(envelope);
  job.externalId = posted.externalId;
  job.status = posted.ok ? "AWAITING_EXTERNAL" : "BLOCKED";
  job.resultSummary = posted.ok ? "One allowlisted Grok_Alex: OPS_EVENT posted. Awaiting matching OPS_STATUS." : posted.detail;
  job.updatedAt = new Date().toISOString();
  store.exclusive((data) => {
    const idx = data.jobs.findIndex((item) => item.id === job.id);
    if (idx >= 0) data.jobs[idx] = job;
  });
  return { ok: posted.ok, job, envelope };
}

export function ingestRehearsalStatus(
  store: ConsoleStore,
  text: string,
): { ok: boolean; job?: StoredJob; reason?: string } {
  const parsed = parseGrokAlexOpsStatus(text);
  if (!parsed.status) return { ok: false, reason: parsed.reason ?? "invalid OPS_STATUS" };
  const data = store.load();
  const job = data.jobs.find((item) => item.id === parsed.status!.event_id);
  if (!job) return { ok: false, reason: "unknown event" };
  if (job.boundedAction !== SLACK_REHEARSAL_ACTION) return { ok: false, reason: "not a rehearsal job" };
  const invalid = validateOpsStatusAgainstJob(parsed.status, job);
  if (invalid) return { ok: false, reason: invalid };
  const existing = data.resultEnvelopes.find((item) => item.jobId === job.id && item.status === parsed.status!.status);
  if (existing) return { ok: true, job, reason: "idempotent replay" };
  job.status = parsed.status.status;
  job.resultSummary = parsed.status.detail;
  job.updatedAt = new Date().toISOString();
  store.exclusive((state) => {
    const idx = state.jobs.findIndex((item) => item.id === job.id);
    if (idx >= 0) state.jobs[idx] = job;
    state.resultEnvelopes.unshift({
      id: id("env"),
      jobId: job.id,
      correlationId: job.correlationId,
      status: job.status,
      detail: job.resultSummary,
      collectedAt: job.updatedAt,
    });
  });
  return { ok: true, job };
}

export async function runCursorRehearsal(
  store: ConsoleStore,
  cursor = new CursorDispatch({
    startingRef: CURSOR_REHEARSAL_REF,
    allowRepo: CURSOR_ALLOW_REPO_EXACT,
    autoCreatePR: false,
  }),
): Promise<{ ok: boolean; job: StoredJob; reason?: string }> {
  if (!cursor.configured) {
    const job = persistBlocked(
      store,
      "Cursor",
      CURSOR_REHEARSAL_ACTION,
      "Cursor rehearsal NOT_CONNECTED — server-only token and exact TRCoach/TRCoaching allowlist required.",
    );
    return { ok: false, job, reason: job.resultSummary };
  }
  const correlationId = id("corr");
  const eventId = id("evt");
  const job: StoredJob = {
    id: eventId,
    correlationId,
    title: "Cursor Cloud second rehearsal",
    owner: "Cursor",
    executor: "Cursor",
    status: "RUNNING",
    boundedAction: CURSOR_REHEARSAL_ACTION,
    evidenceRefs: [CURSOR_ALLOW_REPO_EXACT, CURSOR_REHEARSAL_REF],
    resultSummary: "Bounded no-provider-write rehearsal on current branch only.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    founderGate: false,
  };
  store.exclusive((data) => {
    data.jobs.unshift(job);
    data.correlations.unshift({
      id: correlationId,
      createdAt: job.createdAt,
      parentAction: CURSOR_REHEARSAL_ACTION,
      eventIds: [eventId],
    });
  });
  let result;
  try {
    result = await cursor.dispatch(job);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 240) : "unknown Cursor dispatch error";
    job.status = "BLOCKED";
    job.resultSummary = `Cursor dispatch failed before verified provider acceptance: ${detail}. No external business-system mutation.`;
    job.blockers = ["cursor_dispatch_exception"];
    job.updatedAt = new Date().toISOString();
    store.exclusive((data) => {
      const idx = data.jobs.findIndex((item) => item.id === job.id);
      if (idx >= 0) data.jobs[idx] = job;
    });
    return { ok: false, job, reason: job.resultSummary };
  }
  job.status = result.status;
  job.resultSummary = `${result.detail} Stop: no external business-system mutation. autoCreatePR=false. Ref ${CURSOR_REHEARSAL_REF}.`;
  job.externalId = result.externalId;
  job.runId = result.runId;
  job.model = result.model;
  job.tests = result.tests ?? [];
  job.blockers = result.blockers ?? [];
  job.updatedAt = new Date().toISOString();
  store.exclusive((data) => {
    const idx = data.jobs.findIndex((item) => item.id === job.id);
    if (idx >= 0) data.jobs[idx] = job;
  });
  return { ok: result.ok, job };
}

function persistBlocked(store: ConsoleStore, executor: string, action: string, reason: string): StoredJob {
  const job: StoredJob = {
    id: id("evt"),
    correlationId: id("corr"),
    title: `${executor} rehearsal`,
    owner: executor,
    executor,
    status: "BLOCKED",
    boundedAction: action,
    evidenceRefs: [CURSOR_ALLOW_REPO_EXACT],
    resultSummary: reason,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    founderGate: false,
    blockers: ["NOT_CONNECTED"],
  };
  store.exclusive((data) => {
    data.jobs.unshift(job);
  });
  return job;
}
