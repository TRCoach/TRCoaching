import { loadPermissions } from "../permissions.js";
import { FounderAuth, parseCookies, sessionCookie, csrfCookie, clearCookies } from "../console/auth.js";
import { ConsoleService } from "../console/service.js";
import type { ActionPreference } from "../console/store.js";
import type { DecisionAct, LaneActionAct, LaneId } from "../console/types.js";
import { collectEvidence, readEvidenceEnv } from "../console/evidence.js";
import { DispatchEngine, LiveSlackTransport, MemorySlackTransport, CursorDispatch, ChatGptDispatch } from "../console/dispatch.js";
import { D1Store } from "../console/d1-store.js";
import type { ConsoleStore, StoreData } from "../console/store.js";
import { assertNoSensitivePayload, forbiddenKeys } from "../sensitive.js";
import { CURSOR_REHEARSAL_REF } from "../console/rehearsal.js";
import { validateWorkerEnv, type WorkerBindings } from "./env.js";

const PUBLIC_API = new Set(["/api/health", "/api/login", "/api/session"]);
const SECURITY: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  "x-tr-console-mode": "TEST",
  "x-tr-external-write": "false",
  "x-tr-hosting": "cloudflare-workers-free",
};

function json(status: number, body: unknown, extra: Headers | Record<string, string> = {}): Response {
  const headers = new Headers({ ...SECURITY, "content-type": "application/json; charset=utf-8" });
  const extraInit = extra instanceof Headers ? extra : new Headers(extra);
  extraInit.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") headers.append("set-cookie", value);
    else headers.set(key, value);
  });
  return new Response(`${JSON.stringify(body, null, 2)}\n`, { status, headers });
}

function withSecurity(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return json(500, { ok: false, reason: "founder console worker exception", unauthorizedBusinessWrites: 0 });
      }
      return new Response("founder console unavailable", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  },
};

async function handle(request: Request, env: WorkerBindings): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") && env.ASSETS) {
      return withSecurity(await env.ASSETS.fetch(request));
    }
    if (url.pathname === "/api/health") {
      const ready = validateWorkerEnv(env);
      return json(ready.ok ? 200 : 503, {
        ok: ready.ok,
        mode: "TEST",
        hosting: "cloudflare-workers-free",
        dryRun: true,
        writeScope: "none",
        unauthorizedBusinessWrites: 0,
        openaiDisabled: true,
        d1: Boolean(env.DB),
        slackDispatchEnabled: env.SLACK_DISPATCH_ENABLED === "1",
        slackChannelBound: Boolean(env.SLACK_AI_OPS_CHANNEL),
        slackTokenPresent: Boolean(env.SLACK_BOT_TOKEN),
        reason: ready.reason,
        bind: "workers.dev",
      });
    }

    const valid = validateWorkerEnv(env);
    if (!valid.ok) return json(503, { ok: false, reason: valid.reason, unauthorizedBusinessWrites: 0 });

    const d1 = new D1Store(env.DB as unknown as import("../console/d1-store.js").D1Like);
    const snapshot = await d1.load();
    const store = d1.hydrate(snapshot);
    const auth = new FounderAuth(store, {
      username: env.FOUNDER_AUTH_USER ?? "founder",
      passwordHash: env.FOUNDER_AUTH_PASSWORD_HASH!,
      sessionSecret: env.FOUNDER_SESSION_SECRET!,
      secureCookies: true,
      allowDev: false,
    });
    const publicAuthPath =
      (request.method === "GET" && url.pathname === "/api/session") ||
      (request.method === "POST" && url.pathname === "/api/login");
    const service = publicAuthPath
      ? undefined
      : createConsoleService(env, store, snapshot);
    const response = await route(service, auth, request, url, env);
    if (request.method !== "GET") {
      try {
        await d1.save(store.load(), snapshot.revision);
      } catch {
        if (response.ok && url.pathname === "/api/login") {
          return json(503, { ok: false, reason: "founder console could not persist session", unauthorizedBusinessWrites: 0 });
        }
        if (
          response.ok &&
          (url.pathname === "/api/command" || url.pathname === "/api/rehearsal/slack" || url.pathname === "/api/rehearsal/cursor")
        ) {
          let existing: Record<string, unknown> = {};
          try {
            existing = (await response.clone().json()) as Record<string, unknown>;
          } catch {
            existing = {};
          }
          return json(503, {
            ...existing,
            ok: false,
            reason: "founder console could not persist event",
            unauthorizedBusinessWrites: 0,
          });
        }
      }
    }
    return response;
}

function createConsoleService(env: WorkerBindings, store: ConsoleStore, snapshot: StoreData): ConsoleService {
  const permissions = loadPermissions();
  const evidenceEnv = {
    ...readEvidenceEnv({
      FOUNDER_OPENAI_DISABLED: "1",
      SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
      SLACK_AI_OPS_CHANNEL: env.SLACK_AI_OPS_CHANNEL,
      SLACK_DISPATCH_ENABLED: env.SLACK_DISPATCH_ENABLED,
      SLACK_APPROVED_STATUS_SENDER_IDS: env.SLACK_APPROVED_STATUS_SENDER_IDS,
      CURSOR_CLOUD_AGENT_TOKEN: env.CURSOR_CLOUD_AGENT_TOKEN,
      CURSOR_ALLOW_REPO: env.CURSOR_ALLOW_REPO,
      CURSOR_STARTING_REF: env.CURSOR_STARTING_REF ?? CURSOR_REHEARSAL_REF,
      CURSOR_MODEL: env.CURSOR_MODEL,
      TR_DRIVE_READONLY_TOKEN: env.TR_DRIVE_READONLY_TOKEN,
      TR_CRM_READONLY_TOKEN: env.TR_CRM_READONLY_TOKEN,
      TR_CRM_READONLY_URL: env.TR_CRM_READONLY_URL,
      TR_METRICOOL_READONLY_TOKEN: env.TR_METRICOOL_READONLY_TOKEN,
      TR_METRICOOL_READONLY_URL: env.TR_METRICOOL_READONLY_URL,
      TR_STRIPE_READONLY_TOKEN: env.TR_STRIPE_READONLY_TOKEN,
      TR_SUPERSET_READONLY_TOKEN: env.TR_SUPERSET_READONLY_TOKEN,
      TR_SUPERSET_READONLY_URL: env.TR_SUPERSET_READONLY_URL,
      GITHUB_READONLY_TOKEN: env.GITHUB_READONLY_TOKEN,
    } as NodeJS.ProcessEnv),
    openaiForcedOff: true,
    chatgptDispatchEnabled: false,
  };
  const slack =
    evidenceEnv.slackDispatchEnabled && evidenceEnv.slackToken
      ? new LiveSlackTransport(
          evidenceEnv.slackToken,
          evidenceEnv.slackChannel,
          true,
          evidenceEnv.slackApprovedStatusSenderIds,
        )
      : new MemorySlackTransport();
  const dispatch = new DispatchEngine(
    store,
    permissions,
    slack,
    new CursorDispatch({
      token: evidenceEnv.cursorToken,
      allowRepo: evidenceEnv.cursorAllowRepo,
      startingRef: evidenceEnv.cursorStartingRef ?? CURSOR_REHEARSAL_REF,
      requestedModel: evidenceEnv.cursorModel,
      autoCreatePR: false,
    }),
    new ChatGptDispatch({ enabled: false }),
    collectEvidence(evidenceEnv),
  );
  return new ConsoleService(permissions, {
    store,
    dispatch,
    evidenceEnv,
    evidence: snapshot.evidenceCards.length ? snapshot.evidenceCards : collectEvidence(evidenceEnv),
  });
}

async function route(
  service: ConsoleService | undefined,
  auth: FounderAuth,
  request: Request,
  url: URL,
  env: WorkerBindings,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const cookies = parseCookies(request.headers.get("cookie") ?? undefined);
  const session = auth.resolve(cookies.tr_session);

  if (method === "GET" && path === "/api/session") {
    return json(200, { authenticated: Boolean(session), csrf: session?.csrf, expiresAt: session?.expiresAt });
  }
  if (method === "POST" && path === "/api/login") {
    const raw = await request.text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (forbiddenKeys(body).length > 0) {
      return json(400, { ok: false, reason: `sensitive keys rejected: ${forbiddenKeys(body).join(", ")}` });
    }
    const ip = request.headers.get("cf-connecting-ip") ?? "remote";
    const result = await auth.login(String(body.username ?? ""), String(body.password ?? ""), ip);
    if (!result.ok || !result.token || !result.session) return json(result.status, { ok: false, reason: result.reason });
    const cookies = new Headers();
    cookies.append("set-cookie", sessionCookie(result.token, true));
    cookies.append("set-cookie", csrfCookie(result.session.csrf, true));
    return json(200, { ok: true, csrf: result.session.csrf, expiresAt: result.session.expiresAt }, cookies);
  }

  if (!service) {
    return json(500, { ok: false, reason: "founder console worker exception", unauthorizedBusinessWrites: 0 });
  }

  if (method !== "GET") {
    const raw = await request.text();
    const body = raw ? (JSON.parse(raw || "{}") as Record<string, unknown>) : {};
    if (forbiddenKeys(body).length > 0) {
      return json(400, { ok: false, reason: `sensitive keys rejected: ${forbiddenKeys(body).join(", ")}`, externalWrites: 0 });
    }
    if (!session) return json(401, { ok: false, reason: "founder authentication required" });
    if (!auth.assertCsrf(session, request.headers.get("x-csrf-token") ?? undefined)) {
      return json(403, { ok: false, reason: "csrf rejected" });
    }
    if (path === "/api/logout") {
      auth.logout(cookies.tr_session);
      const cleared = new Headers();
      for (const cookie of clearCookies(true)) cleared.append("set-cookie", cookie);
      return json(200, { ok: true }, cleared);
    }
    if (path === "/api/session/rotate") {
      const rotated = auth.rotate(cookies.tr_session!);
      if (!rotated.ok || !rotated.token || !rotated.session) return json(rotated.status, { ok: false, reason: rotated.reason });
      const rotatedCookies = new Headers();
      rotatedCookies.append("set-cookie", sessionCookie(rotated.token, true));
      rotatedCookies.append("set-cookie", csrfCookie(rotated.session.csrf, true));
      return json(200, { ok: true, csrf: rotated.session.csrf }, rotatedCookies);
    }
    assertNoSensitivePayload(body, "request");
    const { operating_mode: _ignored, ...safe } = body;
    if (path === "/api/command") {
      const text = String(safe.text ?? "");
      return json(200, await service.runCommandAsync(text));
    }
    if (path === "/api/jobs/refresh") return json(200, await service.refreshJobs());
    if (path === "/api/evidence/refresh") return json(200, await service.refreshEvidence());
    if (path === "/api/rehearsal/slack") return json(200, await service.rehearsalSlack());
    if (path === "/api/rehearsal/cursor") {
      return json(
        200,
        await service.rehearsalCursor(
          new CursorDispatch({
            token: env.CURSOR_CLOUD_AGENT_TOKEN,
            allowRepo: env.CURSOR_ALLOW_REPO ?? "TRCoach/TRCoaching",
            startingRef: env.CURSOR_STARTING_REF ?? CURSOR_REHEARSAL_REF,
            autoCreatePR: false,
          }),
        ),
      );
    }
    if (path === "/api/rehearsal/slack/status") return json(200, service.ingestRehearsal(String(safe.text ?? "")));
    if (path === "/api/preferences") {
      return json(200, { items: service.savePreferences((safe.items as ActionPreference[]) ?? []) });
    }
    if (path === "/api/ops-status") {
      const result = service.dispatch.ingestStatusResult({
        kind: "OPS_STATUS",
        event_id: String(safe.event_id ?? ""),
        correlation_id: String(safe.correlation_id ?? ""),
        status: (safe.status as "COMPLETED") ?? "AWAITING_EXTERNAL",
        detail: String(safe.detail ?? ""),
        executor: safe.executor ? String(safe.executor) : undefined,
      });
      if (result.rejected) return json(400, { ok: false, reason: result.rejected });
      return json(result.job ? 200 : 404, { ok: Boolean(result.job), job: result.job });
    }
    const actionMatch = path.match(/^\/api\/actions\/([a-z0-9_]+)$/);
    if (actionMatch?.[1]) {
      if (actionMatch[1] === "progress_everything_today") return json(200, await service.progressEverythingAsync());
      if (actionMatch[1] === "generate_next_weeks_marketing") return json(200, await service.prepareNextWeeksSocial());
      return json(200, service.runAction(actionMatch[1]));
    }
    const laneMatch = path.match(/^\/api\/lanes\/([a-z_]+)\/([A-Za-z0-9_-]+)\/(request-evidence|add-instruction|retry|resolve|acknowledge)$/);
    if (laneMatch?.[1] && laneMatch[2] && laneMatch[3]) {
      const act = laneMatch[3].replaceAll("-", "_") as LaneActionAct;
      const result = service.laneAction(laneMatch[1] as LaneId, laneMatch[2], act, String(safe.comment ?? ""));
      return json(result.ok ? 200 : 409, result);
    }
    const decideMatch = path.match(/^\/api\/inbox\/([a-z0-9_]+)\/(approve|reject|request-evidence)$/);
    if (decideMatch?.[1] && decideMatch[2]) {
      const act = decideMatch[2].replace("request-evidence", "request_evidence") as DecisionAct;
      return json(200, service.decide(decideMatch[1], act));
    }
    if (path === "/api/inbox/approve-all") return json(404, { ok: false, reason: "approve-all does not exist" });
    return json(404, { ok: false, reason: "not found" });
  }

  if (!session && !PUBLIC_API.has(path)) return json(401, { ok: false, reason: "founder authentication required" });
  if (path === "/api/overview") return json(200, service.snapshot());
  if (path === "/api/mode") {
    return json(200, {
      mode: service.mode(),
      currentMode: service.permissions.currentMode,
      trustedModeSource: "permission_registry",
      eventPayloadCannotPromoteMode: true,
    });
  }
  if (path === "/api/evidence") return json(200, { items: service.evidenceCards, openaiDisabled: true, credentialsExposed: false });
  if (path === "/api/status") return json(200, { items: service.status(), evidence: service.evidenceCards, credentialsExposed: false });
  if (path === "/api/actions") return json(200, { actions: service.visibleActions(), catalog: service.catalog() });
  if (path === "/api/inbox") return json(200, { items: service.inbox(), approveAllAvailable: false });
  if (path === "/api/activity") return json(200, { items: service.activity });
  if (path === "/api/usage") return json(200, service.usage());
  if (path === "/api/preferences") return json(200, { items: service.preferences() });
  const detail = path.match(/^\/api\/detail\/([a-z]+)\/([a-z0-9_-]+)$/);
  if (detail?.[1] && detail[2]) return json(200, service.detail(detail[1], detail[2]));
  return json(404, { ok: false, reason: "not found" });
}
