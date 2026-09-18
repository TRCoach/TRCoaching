import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../paths.js";
import { assertNoSensitivePayload, forbiddenKeys } from "../sensitive.js";
import { loadPermissions } from "../permissions.js";
import { ConsoleService } from "./service.js";
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
}

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

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const payload =
    typeof body === "string" || Buffer.isBuffer(body) ? body : `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-tr-console-mode": "TEST",
    "x-tr-external-write": "false",
  });
  res.end(payload);
}

function publicDir(): string {
  return join(repoRoot(), "console/public");
}

function safeStatic(urlPath: string): string | undefined {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const resolved = normalize(join(publicDir(), relative));
  if (!resolved.startsWith(publicDir())) return undefined;
  if (!existsSync(resolved)) return undefined;
  return resolved;
}

export function handleConsoleRequest(service: ConsoleService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  return route(service, req, res);
}

async function route(service: ConsoleService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = (req.headers.host ?? "").split(":")[0];
  if (host && host !== "127.0.0.1" && host !== "localhost") {
    send(res, 403, { ok: false, reason: "Founder Console is localhost-only" });
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    if (path.startsWith("/api/")) {
      await api(service, method, path, req, res);
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

async function api(service: ConsoleService, method: string, path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (method === "GET" && path === "/api/health") {
    send(res, 200, { ok: true, mode: service.mode(), dryRun: true, externalWrites: 0, bind: "127.0.0.1" });
    return;
  }
  if (method === "GET" && path === "/api/mode") {
    send(res, 200, {
      mode: service.mode(),
      currentMode: service.permissions.currentMode,
      trustedModeSource: "permission_registry",
      eventPayloadCannotPromoteMode: true,
      demo: true,
    });
    return;
  }
  if (method === "GET" && path === "/api/overview") {
    send(res, 200, service.snapshot());
    return;
  }
  if (method === "GET" && path === "/api/actions") {
    send(res, 200, service.catalog());
    return;
  }
  if (method === "GET" && path === "/api/inbox") {
    send(res, 200, { items: service.inbox(), approveAllAvailable: false });
    return;
  }
  if (method === "GET" && path === "/api/activity") {
    send(res, 200, { items: service.activity });
    return;
  }
  if (method === "GET" && path === "/api/status") {
    send(res, 200, { items: service.status(), credentialsExposed: false });
    return;
  }
  if (method === "GET" && path === "/api/usage") {
    send(res, 200, service.usage());
    return;
  }
  if (method === "POST" && path === "/api/inbox/approve-all") {
    send(res, 404, { ok: false, reason: "approve-all does not exist" });
    return;
  }

  if (method !== "POST") {
    send(res, 405, { ok: false, reason: "method not allowed" });
    return;
  }

  const raw = await readBody(req);
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const hits = forbiddenKeys(body);
  if (hits.length > 0) {
    send(res, 400, { ok: false, reason: `sensitive keys rejected: ${hits.join(", ")}`, externalWrites: 0 });
    return;
  }
  assertNoSensitivePayload(body, "request");
  const { operating_mode: _ignored, ...safe } = body;

  if (path === "/api/command") {
    const text = typeof safe.text === "string" ? safe.text : "";
    send(res, 200, service.runCommand(text, (safe.evidence as EvidenceMap | undefined) ?? {}));
    return;
  }
  const actionMatch = path.match(/^\/api\/actions\/([a-z0-9_]+)$/);
  if (actionMatch?.[1]) {
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
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Founder Console binds localhost only");
  }
  const port = options.port ?? Number(process.env.FOUNDER_CONSOLE_PORT ?? 8787);
  const service = options.service ?? new ConsoleService(loadPermissions());
  const server = createServer((req, res) => {
    void route(service, req, res);
  });
  return new Promise<{ server: typeof server; host: string; port: number; url: string; service: ConsoleService }>((resolve, reject) => {
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
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const started = await startConsoleServer();
  process.stdout.write(`Founder Console TEST/DEMO ${started.url} (localhost only, dry-run, zero writes)\n`);
}
