import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../paths.js";
import { assertNoSensitivePayload, forbiddenKeys } from "../sensitive.js";
import { loadPermissions } from "../permissions.js";
import { ConsoleService } from "./service.js";
import { FounderAuth, parseCookies, sessionCookie, csrfCookie, clearCookies } from "./auth.js";
import { MemoryStore, type ActionPreference } from "./store.js";
import { collectEvidence, readEvidenceEnv } from "./evidence.js";
import { DispatchEngine, LiveSlackTransport, MemorySlackTransport, CursorDispatch, ChatGptDispatch } from "./dispatch.js";
import type { EvidenceMap } from "../types.js";
import type { DecisionAct } from "./types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface ConsoleServerOptions {
  host?: string;
  port?: number;
  service?: ConsoleService;
  auth?: FounderAuth;
  secureCookies?: boolean;
}

const PUBLIC_API = new Set(["/api/health", "/api/login", "/api/session"]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function securityHeaders(res: ServerResponse, extra: Record<string, string | string[]> = {}): void {
  const headers: Record<string, string | string[]> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    "x-tr-console-mode": "TEST",
    "x-tr-external-write": "false",
    ...extra,
  };
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  type = "application/json; charset=utf-8",
  extra: Record<string, string | string[]> = {},
): void {
  const payload =
    typeof body === "string" || Buffer.isBuffer(body) ? body : `${JSON.stringify(body, null, 2)}\n`;
  securityHeaders(res, { "content-type": type, ...extra });
  res.statusCode = status;
  res.end(payload);
}

function publicDir(): string {
  return join(repoRoot(), "console/public");
}

function safeStatic(urlPath: string): string | undefined {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (relative.includes("\0") || relative.split(/[\\/]/).includes("..")) return undefined;
  const root = resolve(publicDir()) + sep;
  const resolved = resolve(publicDir(), relative);
  if (!resolved.startsWith(root)) return undefined;
  if (!existsSync(resolved)) return undefined;
  return resolved;
}

export function createDefaultRuntime(service?: ConsoleService) {
  const store = service?.store ?? new MemoryStore();
  const permissions = service?.permissions ?? loadPermissions();
  const auth = new FounderAuth(store, FounderAuth.testing());
  const env = readEvidenceEnv();
  const slack =
    env.slackDispatchEnabled && env.slackToken
      ? new LiveSlackTransport(env.slackToken, env.slackChannel, true)
      : new MemorySlackTransport();
  const dispatch =
    service?.dispatch ??
    new DispatchEngine(
      store,
      permissions,
      slack,
      new CursorDispatch({
        token: env.cursorToken,
        allowRepo: env.cursorAllowRepo,
        startingRef: env.cursorStartingRef,
        requestedModel: env.cursorModel,
      }),
      new ChatGptDispatch({
        enabled: env.chatgptDispatchEnabled,
        apiKey: env.openaiKey,
        model: env.openaiModel,
      }),
      collectEvidence(env),
    );
  const resolved = service ?? new ConsoleService(permissions, { store, dispatch, evidence: collectEvidence(env) });
  return { auth, service: resolved, secureCookies: false };
}

export function handleConsoleRequest(service: ConsoleService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = createDefaultRuntime(service);
  return route(runtime.service, runtime.auth, runtime.secureCookies, req, res);
}

async function route(
  service: ConsoleService,
  auth: FounderAuth,
  secureCookies: boolean,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const host = (req.headers.host ?? "").split(":")[0];
  if (host && host !== "127.0.0.1" && host !== "localhost" && process.env.FOUNDER_CONSOLE_ALLOW_REMOTE !== "1") {
    send(res, 403, { ok: false, reason: "Founder Console is private; remote bind is not enabled" });
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    if (path.startsWith("/api/")) {
      await api(service, auth, secureCookies, method, path, req, res);
      return;
    }
    const file = safeStatic(path);
    if (!file) {
      const offline = safeStatic("/offline.html");
      if (offline && path !== "/offline.html") {
        send(res, 404, readFileSync(offline, "utf8"), "text/html; charset=utf-8");
        return;
      }
      send(res, 404, { ok: false, reason: "not found" });
      return;
    }
    send(res, 200, readFileSync(file), MIME[extname(file)] ?? "application/octet-stream");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(res, message.includes("forbidden") ? 400 : 500, { ok: false, reason: message, externalWrites: 0 });
  }
}

async function api(
  service: ConsoleService,
  auth: FounderAuth,
  secureCookies: boolean,
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (method === "GET" && path === "/api/health") {
    const writeScope = service.dispatch.writeScope();
    send(res, 200, {
      ok: true,
      mode: service.mode(),
      dryRun: writeScope === "none",
      writeScope,
      unauthorizedBusinessWrites: 0,
      authorisedGovernedDispatchCount: service.dispatch.authorisedGovernedDispatchCount(),
      bind: "private",
    });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = auth.resolve(cookies.tr_session);

  if (method === "GET" && path === "/api/session") {
    send(res, 200, {
      authenticated: Boolean(session),
      csrf: session?.csrf,
      expiresAt: session?.expiresAt,
    });
    return;
  }

  if (method === "POST" && path === "/api/login") {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (forbiddenKeys(body).length > 0) {
      send(res, 400, { ok: false, reason: `sensitive keys rejected: ${forbiddenKeys(body).join(", ")}` });
      return;
    }
    const ip = req.socket.remoteAddress ?? "local";
    const result = auth.login(String(body.username ?? ""), String(body.password ?? ""), ip);
    if (!result.ok || !result.token || !result.session) {
      send(res, result.status, { ok: false, reason: result.reason });
      return;
    }
    send(res, 200, { ok: true, csrf: result.session.csrf, expiresAt: result.session.expiresAt }, undefined, {
      "set-cookie": [sessionCookie(result.token, secureCookies), csrfCookie(result.session.csrf, secureCookies)],
    });
    return;
  }

  if (method === "POST" && path === "/api/inbox/approve-all") {
    send(res, 404, { ok: false, reason: "approve-all does not exist" });
    return;
  }

  if (method !== "GET") {
    const raw = await peekSensitive(req, res);
    if (raw === undefined) return;
    if (!session) {
      send(res, 401, { ok: false, reason: "founder authentication required" });
      return;
    }
    if (!auth.assertCsrf(session, req.headers["x-csrf-token"] as string | undefined)) {
      send(res, 403, { ok: false, reason: "csrf rejected" });
      return;
    }
    if (path === "/api/logout") {
      auth.logout(cookies.tr_session);
      send(res, 200, { ok: true }, undefined, { "set-cookie": clearCookies(secureCookies) });
      return;
    }
    if (path === "/api/session/rotate") {
      if (!cookies.tr_session) {
        send(res, 401, { ok: false, reason: "founder authentication required" });
        return;
      }
      const rotated = auth.rotate(cookies.tr_session);
      if (!rotated.ok || !rotated.token || !rotated.session) {
        send(res, rotated.status, { ok: false, reason: rotated.reason });
        return;
      }
      send(res, 200, { ok: true, csrf: rotated.session.csrf, expiresAt: rotated.session.expiresAt }, undefined, {
        "set-cookie": [sessionCookie(rotated.token, secureCookies), csrfCookie(rotated.session.csrf, secureCookies)],
      });
      return;
    }
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    assertNoSensitivePayload(body, "request");
    const { operating_mode: _ignored, ...safe } = body;
    await mutate(service, method, path, safe, res);
    return;
  }

  if (!session && !PUBLIC_API.has(path)) {
    send(res, 401, { ok: false, reason: "founder authentication required" });
    return;
  }

  if (path === "/api/mode") {
    send(res, 200, {
      mode: service.mode(),
      currentMode: service.permissions.currentMode,
      trustedModeSource: "permission_registry",
      eventPayloadCannotPromoteMode: true,
      demo: true,
    });
    return;
  }
  if (path === "/api/overview") {
    send(res, 200, service.snapshot());
    return;
  }
  if (path === "/api/actions") {
    send(res, 200, { actions: service.visibleActions(), catalog: service.catalog() });
    return;
  }
  if (path === "/api/inbox") {
    send(res, 200, { items: service.inbox(), approveAllAvailable: false });
    return;
  }
  if (path === "/api/activity") {
    send(res, 200, { items: service.activity });
    return;
  }
  if (path === "/api/status") {
    send(res, 200, { items: service.status(), evidence: service.evidenceCards, credentialsExposed: false });
    return;
  }
  if (path === "/api/usage") {
    send(res, 200, service.usage());
    return;
  }
  if (path === "/api/preferences") {
    send(res, 200, { items: service.preferences() });
    return;
  }
  const detail = path.match(/^\/api\/detail\/([a-z]+)\/([a-z0-9_-]+)$/);
  if (detail?.[1] && detail[2]) {
    send(res, 200, service.detail(detail[1], detail[2]));
    return;
  }
  send(res, 404, { ok: false, reason: "not found" });
}

async function peekSensitive(req: IncomingMessage, res: ServerResponse): Promise<string | undefined> {
  const raw = await readBody(req);
  const body = raw ? (JSON.parse(raw || "{}") as Record<string, unknown>) : {};
  const hits = forbiddenKeys(body);
  if (hits.length > 0) {
    send(res, 400, { ok: false, reason: `sensitive keys rejected: ${hits.join(", ")}`, externalWrites: 0 });
    return undefined;
  }
  return raw;
}

async function mutate(
  service: ConsoleService,
  method: string,
  path: string,
  safe: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  if (method !== "POST") {
    send(res, 405, { ok: false, reason: "method not allowed" });
    return;
  }
  if (path === "/api/command") {
    const text = typeof safe.text === "string" ? safe.text : "";
    if (/progress everything that can be progressed today/i.test(text)) {
      send(res, 200, await service.progressEverythingAsync());
      return;
    }
    send(res, 200, service.runCommand(text, (safe.evidence as EvidenceMap | undefined) ?? {}));
    return;
  }
  if (path === "/api/preferences") {
    send(res, 200, { items: service.savePreferences((safe.items as ActionPreference[]) ?? []) });
    return;
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
    if (result.rejected) {
      send(res, 400, { ok: false, reason: result.rejected, job: undefined });
      return;
    }
    send(res, result.job ? 200 : 404, { ok: Boolean(result.job), job: result.job });
    return;
  }
  if (path === "/api/jobs/refresh") {
    send(res, 200, await service.refreshJobs());
    return;
  }
  const actionMatch = path.match(/^\/api\/actions\/([a-z0-9_]+)$/);
  if (actionMatch?.[1]) {
    if (actionMatch[1] === "progress_everything_today") {
      send(res, 200, await service.progressEverythingAsync());
      return;
    }
    send(res, 200, service.runAction(actionMatch[1], undefined, (safe.evidence as EvidenceMap | undefined) ?? {}));
    return;
  }
  const decideMatch = path.match(/^\/api\/inbox\/([a-z0-9_]+)\/(approve|reject|request-evidence)$/);
  if (decideMatch?.[1] && decideMatch[2]) {
    const act = decideMatch[2].replace("request-evidence", "request_evidence") as DecisionAct;
    send(res, 200, service.decide(decideMatch[1], act));
    return;
  }
  send(res, 404, { ok: false, reason: "not found" });
}

export function startConsoleServer(options: ConsoleServerOptions = {}) {
  const host = options.host ?? process.env.FOUNDER_CONSOLE_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && process.env.FOUNDER_CONSOLE_ALLOW_REMOTE !== "1") {
    throw new Error("Founder Console binds localhost only unless FOUNDER_CONSOLE_ALLOW_REMOTE=1");
  }
  const port = options.port ?? Number(process.env.FOUNDER_CONSOLE_PORT ?? 8787);
  const runtime = options.service && options.auth
    ? { service: options.service, auth: options.auth, secureCookies: options.secureCookies ?? false }
    : createDefaultRuntime(options.service);
  const auth = options.auth ?? runtime.auth;
  const service = options.service ?? runtime.service;
  const secureCookies = options.secureCookies ?? runtime.secureCookies;
  const server = createServer((req, res) => {
    void route(service, auth, secureCookies, req, res);
  });
  return new Promise<{
    server: typeof server;
    host: string;
    port: number;
    url: string;
    service: ConsoleService;
    auth: FounderAuth;
  }>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        service,
        auth,
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { loadRuntimeConfig } = await import("./config.js");
  const cfg = loadRuntimeConfig();
  const env = readEvidenceEnv();
  const slack = new LiveSlackTransport(env.slackToken, env.slackChannel, Boolean(env.slackDispatchEnabled));
  const dispatch = new DispatchEngine(
    cfg.store,
    loadPermissions(),
    slack,
    new CursorDispatch({
      token: env.cursorToken,
      allowRepo: env.cursorAllowRepo,
      startingRef: env.cursorStartingRef,
      requestedModel: env.cursorModel,
    }),
    new ChatGptDispatch({
      enabled: env.chatgptDispatchEnabled,
      apiKey: env.openaiKey,
      model: env.openaiModel,
    }),
    collectEvidence(env),
  );
  const service = new ConsoleService(loadPermissions(), {
    store: cfg.store,
    dispatch,
    evidence: collectEvidence(env),
  });
  const auth = new FounderAuth(cfg.store, cfg.auth);
  const started = await startConsoleServer({
    host: cfg.host,
    port: cfg.port,
    service,
    auth,
    secureCookies: cfg.auth.secureCookies,
  });
  process.stdout.write(`Founder Console ${started.url} (authenticated, private, dry-run)\n`);
}
