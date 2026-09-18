import type { DispatchStatus, StoredJob } from "./store.js";

export const OPS_STATUS_PREFIX = "Grok_Alex:";
export const MAX_OPS_DETAIL = 400;
export const ALLOWED_DISPATCH_STATUSES = new Set<DispatchStatus>([
  "QUEUED",
  "RUNNING",
  "AWAITING_EXTERNAL",
  "BLOCKED",
  "FOUNDER_REQUIRED",
  "COMPLETED",
  "FAILED",
]);

export interface ParsedOpsStatus {
  kind: "OPS_STATUS";
  event_id: string;
  correlation_id: string;
  status: DispatchStatus;
  detail: string;
  executor?: string;
}

export function parseGrokAlexOpsStatus(text: string): { status?: ParsedOpsStatus; reason?: string } {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  const lines = trimmed.split("\n");
  const prefixIndex = lines.findIndex((line) => line.trim().startsWith(OPS_STATUS_PREFIX) && /\bOPS_STATUS\b/.test(line));
  if (prefixIndex < 0) {
    return { reason: "missing Grok_Alex prefix" };
  }
  const preamble = lines.slice(0, prefixIndex).map((line) => line.trim()).filter(Boolean);
  if (preamble.some((line) => !ALLOWED_DISPATCH_STATUSES.has(line as DispatchStatus))) {
    return { reason: "invalid OPS_STATUS preamble" };
  }
  const protocolText = lines.slice(prefixIndex).join("\n");
  const fields: Record<string, string> = {};
  for (const match of protocolText.matchAll(/^(event_id|correlation_id|status|executor|detail|verified_evidence)=(.+)$/gm)) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) fields[key] = value.trim();
  }
  if (!fields.event_id) {
    const inline = protocolText.match(/\bevent_id=(\S+)/);
    if (inline?.[1]) fields.event_id = inline[1];
  }
  if (!fields.correlation_id) {
    const inline = protocolText.match(/\bcorrelation_id=(\S+)/);
    if (inline?.[1]) fields.correlation_id = inline[1];
  }
  if (!fields.status) {
    const inline = protocolText.match(/\bstatus=([A-Z_]+)/);
    if (inline?.[1]) fields.status = inline[1];
  }
  if (!fields.executor) {
    const inline = protocolText.match(/\bexecutor=(\S+)/);
    if (inline?.[1]) fields.executor = inline[1];
  }
  if (!fields.detail) {
    const inline = protocolText.match(/\bdetail=([^\n]+)/);
    if (inline?.[1]) fields.detail = inline[1].trim();
  }
  if (!fields.detail && fields.verified_evidence) fields.detail = fields.verified_evidence;
  if (!fields.event_id || !fields.correlation_id || !fields.status) {
    return { reason: "OPS_STATUS missing required fields" };
  }
  if (!ALLOWED_DISPATCH_STATUSES.has(fields.status as DispatchStatus)) {
    return { reason: "unknown status" };
  }
  const detail = fields.detail ?? "";
  if (detail.length > MAX_OPS_DETAIL) {
    return { reason: "oversized detail" };
  }
  return {
    status: {
      kind: "OPS_STATUS",
      event_id: fields.event_id,
      correlation_id: fields.correlation_id,
      status: fields.status as DispatchStatus,
      detail,
      executor: fields.executor,
    },
  };
}

export function validateOpsStatusAgainstJob(status: ParsedOpsStatus, job: StoredJob): string | undefined {
  if (job.correlationId !== status.correlation_id) return "wrong correlation";
  if (!ALLOWED_DISPATCH_STATUSES.has(status.status)) return "unknown status";
  if (status.detail.length > MAX_OPS_DETAIL) return "oversized detail";
  if (status.executor) {
    const expected = job.executor.toLowerCase();
    const got = status.executor.toLowerCase();
    const slackFamily = expected === "slack" && (got === "slack" || got === "grok" || got === "alex" || got === "grok_alex");
    if (!slackFamily && expected !== got) return "wrong executor";
  }
  return undefined;
}
