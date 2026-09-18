import { createHash } from "node:crypto";
import type { DispatchStatus, StoredJob } from "./store.js";
import type { FetchLike } from "./http-probe.js";

export const CURSOR_API_BASE = "https://api.cursor.com";
export const CURSOR_ALLOW_REPO_EXACT = "TRCoach/TRCoaching";
export const CURSOR_REPO_URL = "https://github.com/TRCoach/TRCoaching";

export interface CursorDispatchOptions {
  token?: string;
  allowRepo?: string;
  startingRef?: string;
  requestedModel?: string;
  autoCreatePR?: boolean;
  fetchImpl?: FetchLike;
  apiBase?: string;
}

export interface WorkerResult {
  ok: boolean;
  status: DispatchStatus;
  detail: string;
  externalId?: string;
  runId?: string;
  model?: string;
  tests?: string[];
  blockers?: string[];
}

export interface WorkerDispatch {
  id: "cursor" | "chatgpt";
  configured: boolean;
  setupRequirement: string;
  dispatch(job: StoredJob): Promise<WorkerResult>;
  status(job: StoredJob): Promise<WorkerResult>;
}

function asUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function cursorAgentId(seed: string): string {
  const hex = createHash("sha256").update(`tr-cursor-v1:${seed}`).digest("hex");
  return `bc-${asUuid(hex)}`;
}

function mapRunStatus(status: string | undefined): DispatchStatus {
  switch (status) {
    case "FINISHED":
      return "COMPLETED";
    case "ERROR":
    case "CANCELLED":
    case "EXPIRED":
      return "FAILED";
    case "CREATING":
    case "RUNNING":
      return "AWAITING_EXTERNAL";
    default:
      return "AWAITING_EXTERNAL";
  }
}

function extractErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const code = (nested as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  if (typeof record.code === "string") return record.code;
  if (typeof record.error === "string") return record.error;
  return "";
}

export class CursorDispatch implements WorkerDispatch {
  id = "cursor" as const;
  setupRequirement =
    "Cursor Cloud Agents API v1 (public beta): server-only CURSOR_CLOUD_AGENT_TOKEN, exact repo TRCoach/TRCoaching, CURSOR_STARTING_REF, optional CURSOR_MODEL from GET /v1/models, autoCreatePR=true, deterministic bc-UUID. Never fake COMPLETED.";
  private token?: string;
  private allowRepo: string;
  private startingRef: string;
  private requestedModel?: string;
  private autoCreatePR: boolean;
  private fetchImpl: FetchLike;
  private apiBase: string;

  constructor(tokenOrOptions?: string | CursorDispatchOptions) {
    const options: CursorDispatchOptions =
      typeof tokenOrOptions === "string" ? { token: tokenOrOptions } : (tokenOrOptions ?? {});
    this.token = options.token;
    this.allowRepo = options.allowRepo ?? CURSOR_ALLOW_REPO_EXACT;
    this.startingRef = options.startingRef ?? "main";
    this.requestedModel = options.requestedModel;
    this.autoCreatePR = options.autoCreatePR !== false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = options.apiBase ?? CURSOR_API_BASE;
  }

  get configured(): boolean {
    return Boolean(this.token) && this.allowRepo === CURSOR_ALLOW_REPO_EXACT;
  }

  async dispatch(job: StoredJob): Promise<WorkerResult> {
    if (!this.configured) {
      return { ok: false, status: "BLOCKED", detail: `Cursor Cloud NOT_CONNECTED. ${this.setupRequirement}` };
    }
    const agentId = cursorAgentId(`${job.id}:${CURSOR_ALLOW_REPO_EXACT}`);
    let model: string | undefined;
    try {
      model = await this.resolveModel();
    } catch (error) {
      return {
        ok: false,
        status: "BLOCKED",
        detail: `Cursor GET /v1/models failed: ${error instanceof Error ? error.message : String(error)}`,
        blockers: ["cursor_models_unreadable"],
      };
    }
    const payload: Record<string, unknown> = {
      agentId,
      name: "TRCoach/TRCoaching bounded QA",
      prompt: {
        text: [
          "Bounded TRCoach/TRCoaching worker task only.",
          `bounded_action=${job.boundedAction}`,
          `event_id=${job.id}`,
          `correlation_id=${job.correlationId}`,
          `evidence_refs=${job.evidenceRefs.join(",")}`,
          "No provider writes. No external business-system mutation. No money movement. No publication.",
          "Produce a QA report. No PII. No Zone C. No secrets. Stop after the report.",
        ].join("\n"),
      },
      repos: [{ url: CURSOR_REPO_URL, startingRef: this.startingRef }],
      autoCreatePR: this.autoCreatePR,
    };
    if (model) payload.model = { id: model };
    const created = await this.request("POST", "/v1/agents", payload);
    if (created.status === 409 && extractErrorCode(created.body) === "agent_id_conflict") {
      return this.reconcileConflict(agentId, model);
    }
    if (created.status >= 400 || !created.body || typeof created.body !== "object") {
      return {
        ok: false,
        status: "BLOCKED",
        detail: `Cursor POST /v1/agents failed: ${created.status}`,
        blockers: ["cursor_create_failed"],
        model,
      };
    }
    const body = created.body as {
      agent?: { id?: string; latestRunId?: string };
      run?: { id?: string; status?: string };
    };
    const resolvedId = body.agent?.id ?? agentId;
    const runId = body.run?.id ?? body.agent?.latestRunId;
    return {
      ok: true,
      status: "AWAITING_EXTERNAL",
      detail: "Cursor v1 agent created. Awaiting verified run read-back.",
      externalId: resolvedId,
      runId,
      model,
      tests: [],
      blockers: [],
    };
  }

  async status(job: StoredJob): Promise<WorkerResult> {
    if (!this.configured) {
      return { ok: false, status: "BLOCKED", detail: `Cursor Cloud NOT_CONNECTED. ${this.setupRequirement}` };
    }
    const agentId = job.externalId ?? cursorAgentId(`${job.id}:${CURSOR_ALLOW_REPO_EXACT}`);
    let runId = job.runId;
    if (!runId) {
      const agent = await this.getAgent(agentId);
      runId = agent.latestRunId;
    }
    if (!runId) {
      return {
        ok: false,
        status: "AWAITING_EXTERNAL",
        detail: "Cursor agent has no latestRunId yet.",
        externalId: agentId,
        blockers: ["cursor_run_missing"],
      };
    }
    return this.readRun(agentId, runId, job.model);
  }

  private async reconcileConflict(agentId: string, model?: string): Promise<WorkerResult> {
    const agent = await this.getAgent(agentId);
    if (!agent.latestRunId) {
      return {
        ok: true,
        status: "AWAITING_EXTERNAL",
        detail: "Cursor 409 agent_id_conflict reconciled; latestRunId not yet present.",
        externalId: agentId,
        model,
        blockers: ["cursor_run_missing"],
      };
    }
    const run = await this.readRun(agentId, agent.latestRunId, model);
    if (run.status === "COMPLETED" || run.status === "FAILED") return run;
    return {
      ...run,
      ok: true,
      status: "AWAITING_EXTERNAL",
      detail: "Cursor 409 agent_id_conflict reconciled. Continue polling latestRunId.",
      externalId: agentId,
      runId: agent.latestRunId,
      model: run.model ?? model,
    };
  }

  private async getAgent(agentId: string): Promise<{ id: string; latestRunId?: string }> {
    const response = await this.request("GET", `/v1/agents/${agentId}`);
    const body = (response.body ?? {}) as { id?: string; latestRunId?: string; agent?: { latestRunId?: string } };
    return {
      id: body.id ?? agentId,
      latestRunId: body.latestRunId ?? body.agent?.latestRunId,
    };
  }

  private async readRun(agentId: string, runId: string, model?: string): Promise<WorkerResult> {
    const response = await this.request("GET", `/v1/agents/${agentId}/runs/${runId}`);
    const body = (response.body ?? {}) as {
      status?: string;
      result?: string;
      tests?: string[];
      blockers?: string[];
    };
    const status = mapRunStatus(body.status);
    const result = typeof body.result === "string" ? body.result.slice(0, 400) : "";
    const tests = Array.isArray(body.tests) ? body.tests.map(String).slice(0, 12) : [];
    const blockers = Array.isArray(body.blockers) ? body.blockers.map(String).slice(0, 12) : [];
    if (status === "FAILED" && blockers.length === 0) blockers.push("cursor_run_error");
    return {
      ok: status !== "FAILED" && status !== "BLOCKED",
      status,
      detail:
        status === "COMPLETED"
          ? result || "Cursor run FINISHED (verified read-back)."
          : status === "FAILED"
            ? result || "Cursor run failed."
            : `Cursor run ${body.status ?? "pending"}.`,
      externalId: agentId,
      runId,
      model,
      tests,
      blockers,
    };
  }

  private async resolveModel(): Promise<string | undefined> {
    if (!this.requestedModel) return undefined;
    const response = await this.request("GET", "/v1/models");
    const body = (response.body ?? {}) as { items?: Array<{ id?: string; aliases?: string[] }> };
    const items = body.items ?? [];
    const match = items.find(
      (item) => item.id === this.requestedModel || item.aliases?.includes(this.requestedModel!),
    );
    return match?.id;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 80) };
      }
    }
    return { status: response.status, body: parsed };
  }
}
