export interface WorkerBindings {
  DB?: import("../console/d1-store.js").D1Like;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  FOUNDER_SESSION_SECRET?: string;
  FOUNDER_AUTH_PASSWORD_HASH?: string;
  FOUNDER_AUTH_USER?: string;
  FOUNDER_OPENAI_DISABLED?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_AI_OPS_CHANNEL?: string;
  SLACK_DISPATCH_ENABLED?: string;
  CURSOR_CLOUD_AGENT_TOKEN?: string;
  CURSOR_ALLOW_REPO?: string;
  CURSOR_STARTING_REF?: string;
  CURSOR_MODEL?: string;
  TR_DRIVE_READONLY_TOKEN?: string;
  TR_CRM_READONLY_TOKEN?: string;
  TR_CRM_READONLY_URL?: string;
  TR_METRICOOL_READONLY_TOKEN?: string;
  TR_METRICOOL_READONLY_URL?: string;
  TR_STRIPE_READONLY_TOKEN?: string;
  TR_SUPERSET_READONLY_TOKEN?: string;
  TR_SUPERSET_READONLY_URL?: string;
  GITHUB_READONLY_TOKEN?: string;
  FOUNDER_CONSOLE_HOSTING?: string;
}

export function validateWorkerEnv(env: WorkerBindings): { ok: boolean; reason?: string } {
  if (!env.DB) return { ok: false, reason: "production fail-closed: D1 binding DB is required" };
  if (!env.FOUNDER_SESSION_SECRET || env.FOUNDER_SESSION_SECRET.length < 32) {
    return { ok: false, reason: "production fail-closed: FOUNDER_SESSION_SECRET (>=32) is required" };
  }
  if (!env.FOUNDER_AUTH_PASSWORD_HASH || !/^(scrypt|pbkdf2)\$/.test(env.FOUNDER_AUTH_PASSWORD_HASH)) {
    return { ok: false, reason: "production fail-closed: FOUNDER_AUTH_PASSWORD_HASH required (no default credential)" };
  }
  return { ok: true };
}
