import type { DispatchStatus, StoredJob } from "./store.js";
import type { FetchLike } from "./http-probe.js";
import type { WorkerDispatch, WorkerResult } from "./cursor-v1.js";

export const OPENAI_API_BASE = "https://api.openai.com";
export const OPENAI_RETENTION_NOTE =
  "OpenAI Responses may retain inputs/outputs per account data-control settings. Founder must review retention before enabling spend. Default spend remains disabled.";

export interface ChatGptDispatchOptions {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
  apiBase?: string;
}

function mapResponseStatus(status: string | undefined): DispatchStatus {
  switch (status) {
    case "completed":
      return "COMPLETED";
    case "failed":
    case "cancelled":
    case "incomplete":
      return "FAILED";
    case "queued":
    case "in_progress":
      return "AWAITING_EXTERNAL";
    default:
      return "AWAITING_EXTERNAL";
  }
}

export class ChatGptDispatch implements WorkerDispatch {
  id = "chatgpt" as const;
  setupRequirement =
    "FOUNDER_CHATGPT_DISPATCH=1 plus server-only OPENAI_API_KEY and OPENAI_MODEL after founder spend approval. Uses POST /v1/responses background=true and GET /v1/responses/{id}. Bounded non-PII operational metadata only. Spend stays disabled by default.";
  private enabled: boolean;
  private apiKey?: string;
  private model?: string;
  private fetchImpl: FetchLike;
  private apiBase: string;

  constructor(enabledOrOptions?: boolean | ChatGptDispatchOptions, apiKey?: string) {
    const options: ChatGptDispatchOptions =
      typeof enabledOrOptions === "boolean"
        ? { enabled: enabledOrOptions, apiKey }
        : (enabledOrOptions ?? {});
    this.enabled = Boolean(options.enabled);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = options.apiBase ?? OPENAI_API_BASE;
  }

  get configured(): boolean {
    return Boolean(this.enabled && this.apiKey && this.model);
  }

  get spendEnabled(): boolean {
    return this.configured;
  }

  async dispatch(job: StoredJob): Promise<WorkerResult> {
    if (!this.configured) {
      return {
        ok: false,
        status: "BLOCKED",
        detail: `ChatGPT NOT_CONNECTED. ${this.setupRequirement} ${OPENAI_RETENTION_NOTE}`,
        blockers: ["openai_spend_disabled"],
      };
    }
    const input = {
      kind: "independent_qa_review",
      event_id: job.id,
      correlation_id: job.correlationId,
      bounded_action: job.boundedAction,
      evidence_refs: job.evidenceRefs,
      stop_condition: "no PII, no Zone C, no secrets, no money movement",
    };
    const response = await this.request("POST", "/v1/responses", {
      model: this.model,
      background: true,
      input: JSON.stringify(input),
    });
    if (response.status >= 400 || !response.body || typeof response.body !== "object") {
      return {
        ok: false,
        status: "BLOCKED",
        detail: `OpenAI POST /v1/responses failed: ${response.status}`,
        model: this.model,
        blockers: ["openai_create_failed"],
      };
    }
    const body = response.body as { id?: string; status?: string };
    return {
      ok: true,
      status: "AWAITING_EXTERNAL",
      detail: "OpenAI Responses background job accepted. Awaiting GET /v1/responses/{id}.",
      externalId: body.id,
      model: this.model,
      tests: [],
      blockers: [],
    };
  }

  async status(job: StoredJob): Promise<WorkerResult> {
    if (!this.configured) {
      return {
        ok: false,
        status: "BLOCKED",
        detail: `ChatGPT NOT_CONNECTED. ${this.setupRequirement}`,
        blockers: ["openai_spend_disabled"],
      };
    }
    if (!job.externalId) {
      return {
        ok: false,
        status: "AWAITING_EXTERNAL",
        detail: "OpenAI response id missing.",
        model: this.model,
        blockers: ["openai_response_missing"],
      };
    }
    const response = await this.request("GET", `/v1/responses/${job.externalId}`);
    const body = (response.body ?? {}) as { status?: string; error?: { message?: string }; output_text?: string };
    const status = mapResponseStatus(body.status);
    const detail =
      status === "COMPLETED"
        ? (body.output_text ?? "OpenAI response completed (verified read-back).").slice(0, 400)
        : status === "FAILED"
          ? body.error?.message ?? "OpenAI response failed."
          : `OpenAI response ${body.status ?? "pending"}.`;
    return {
      ok: status !== "FAILED" && status !== "BLOCKED",
      status,
      detail,
      externalId: job.externalId,
      model: this.model,
      tests: [],
      blockers: status === "FAILED" ? ["openai_response_failed"] : [],
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
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
