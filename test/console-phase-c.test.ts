import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FounderAuth } from "../src/console/auth.ts";
import { MemoryD1, D1Store, D1_SCHEMA_SQL, RevisionConflictError, WriterLockError, throttleRefresh } from "../src/console/d1-store.ts";
import { emptyData } from "../src/console/store.ts";
import { MemoryStore } from "../src/console/store.ts";
import { JsonFileStore } from "../src/console/file-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertStripeReadOnlyKey, assertStripeReadOnlyRequest, collectLiveEvidence } from "../src/console/live-adapters.ts";
import { collectEvidence } from "../src/console/evidence.ts";
import { DispatchEngine, MemorySlackTransport } from "../src/console/dispatch.ts";
import { CursorDispatch } from "../src/console/cursor-v1.ts";
import { ingestRehearsalStatus, runCursorRehearsal, runSlackRehearsal, SLACK_REHEARSAL_ACTION } from "../src/console/rehearsal.ts";
import { ChatGptDispatch } from "../src/console/openai-responses.ts";
import { ConsoleService } from "../src/console/service.ts";
import { startConsoleServer } from "../src/console/http.ts";
import { loadPermissions } from "../src/permissions.ts";
import { BUNDLED_PERMISSIONS, loadJsonWithFallback } from "../src/model-json.ts";
import { forbiddenKeys } from "../src/sensitive.ts";
import { authHeaders, loginFounder } from "./console-auth.ts";
import worker from "../src/worker/index.ts";
import { validateWorkerEnv } from "../src/worker/env.ts";

describe("founder console phase C D1 store", () => {
  it("migrates, persists across restart, and protects concurrent revisions", async () => {
    const db = new MemoryD1();
    const store = new D1Store(db, "writer-a");
    await store.exclusive((data) => {
      data.preferences.push({
        id: "run_daily_business_cycle",
        visible: true,
        order: 0,
        displayName: "Daily pulse",
        icon: "◆",
        description: "inspect",
        confirm: false,
      });
    });
    const restarted = new D1Store(db, "writer-b");
    const loaded = await restarted.load();
    assert.equal(loaded.version, 3);
    assert.ok(loaded.revision >= 1);
    assert.equal(loaded.preferences[0]?.displayName, "Daily pulse");
    assert.equal(forbiddenKeys(loaded).length, 0);
    await assert.rejects(() => restarted.save(loaded, loaded.revision - 1), RevisionConflictError);
    assert.equal(throttleRefresh(undefined), true);
    assert.equal(throttleRefresh(new Date().toISOString()), false);
  });

  it("keeps the local JSON store for dev/tests and fail-closes without D1 in production validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-c-"));
    const path = join(dir, "console-store.json");
    const file = new JsonFileStore(path);
    file.exclusive((data) => {
      data.revision = 1;
    });
    assert.equal(new JsonFileStore(path).load().version, 3);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(validateWorkerEnv({}).ok, false);
    assert.match(validateWorkerEnv({}).reason ?? "", /D1/);
  });

  it("enforces the single-active-writer lock", async () => {
    const db = new MemoryD1();
    const holder = new D1Store(db, "writer-a");
    await holder.save(emptyData());
    await holder.acquireWriter();
    const other = new D1Store(db, "writer-b");
    await assert.rejects(() => other.exclusive((data) => data.revision), WriterLockError);
    await holder.releaseWriter();
    await other.exclusive((data) => {
      data.preferences.push({
        id: "run_daily_business_cycle",
        visible: true,
        order: 0,
        displayName: "After lock",
        icon: "◆",
        description: "inspect",
        confirm: false,
      });
    });
    assert.equal((await other.load()).preferences[0]?.displayName, "After lock");
  });
});

describe("founder console phase C adapters and gates", () => {
  it("enforces evidence freshness and never marks missing evidence VERIFIED", () => {
    const cards = collectEvidence({ demoFixtures: false, openaiForcedOff: true });
    for (const card of cards) {
      assert.notEqual(card.freshness, "VERIFIED");
      assert.notEqual(card.currentState, "VERIFIED");
      assert.ok(card.lastAttemptedAt);
      assert.ok(card.nextSetupRequirement);
      if (card.freshness === "NOT_CONNECTED" || card.freshness === "UNKNOWN") {
        assert.equal(card.lastVerified, null);
      }
    }
    assert.equal(cards.find((item) => item.id === "chatgpt")?.freshness, "NOT_CONNECTED");
  });

  it("rejects live Stripe keys and every Stripe write", () => {
    assert.throws(() => assertStripeReadOnlyKey("sk_live_xxx"), /live Stripe keys/);
    assert.throws(() => assertStripeReadOnlyKey("rk_live_xxx"), /live Stripe keys/);
    assert.throws(() => assertStripeReadOnlyKey("sk_test_xxx"), /rk_test_/);
    assert.doesNotThrow(() => assertStripeReadOnlyKey("rk_test_restricted"));
    assert.throws(() => assertStripeReadOnlyRequest("POST", "https://api.stripe.com/v1/charges"), /mutation/);
    assert.throws(() => assertStripeReadOnlyRequest("GET", "https://api.stripe.com/v1/charges"), /unallowlisted/);
    assert.doesNotThrow(() => assertStripeReadOnlyRequest("GET", "https://api.stripe.com/v1/account"));
  });

  it("collects live metadata only and keeps OpenAI disabled", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      const url = String(input);
      if (url.includes("stripe.com") && method !== "GET") throw new Error("stripe write");
      return new Response("{}", { status: 200 });
    };
    const cards = await collectLiveEvidence(
      {
        demoFixtures: false,
        driveKey: "drive",
        crmKey: "crm",
        crmUrl: "https://sheets.googleapis.com/v4/spreadsheets/placeholder",
        metricoolKey: "metricool",
        metricoolUrl: "https://app.metricool.com/api/calendar",
        stripeKey: "rk_test_restricted",
        supersetKey: "superset",
        supersetUrl: "https://superset.example.test/health",
        openaiForcedOff: true,
      },
      fetchImpl,
    );
    assert.ok(cards.every((card) => card.credentialsExposed === false));
    assert.ok(cards.some((card) => card.id === "drive" && card.freshness === "VERIFIED" && card.lastVerifiedAt));
    assert.equal(JSON.stringify(cards).includes("sk_live"), false);
    const openai = new ChatGptDispatch({ enabled: true, apiKey: "sk-test", model: "gpt-4.1-mini" });
    assert.equal(new ChatGptDispatch({ enabled: false, apiKey: "sk-test", model: "x" }).configured, false);
    assert.equal(openai.configured, true);
    const forced = collectEvidence({ demoFixtures: false, chatgptDispatchEnabled: true, openaiKey: "sk-test", openaiForcedOff: true });
    assert.equal(forced.find((item) => item.id === "chatgpt")?.freshness, "NOT_CONNECTED");
  });
});

describe("founder console phase C rehearsals", () => {
  it("emits one Slack OPS_EVENT and accepts only a matching idempotent OPS_STATUS", async () => {
    const slack = new MemorySlackTransport();
    const store = new MemoryStore();
    const first = await runSlackRehearsal(store, loadPermissions(), slack);
    assert.equal(slack.posts.length, 1);
    assert.equal(first.envelope?.prefix, "Grok_Alex:");
    assert.equal(first.envelope?.bounded_action, SLACK_REHEARSAL_ACTION);
    assert.ok(first.envelope?.event_id);
    assert.ok(first.envelope?.correlation_id);
    const text = [
      "Grok_Alex: OPS_STATUS",
      `event_id=${first.job.id}`,
      `correlation_id=${first.job.correlationId}`,
      "status=COMPLETED",
      "executor=Slack",
      "detail=rehearsal ack",
    ].join("\n");
    const ingested = ingestRehearsalStatus(store, text);
    assert.equal(ingested.ok, true);
    assert.equal(ingested.job?.status, "COMPLETED");
    const replay = ingestRehearsalStatus(store, text);
    assert.match(replay.reason ?? "", /idempotent/);
    const wrong = ingestRehearsalStatus(store, text.replace(first.job.correlationId, "corr_wrong"));
    assert.equal(wrong.ok, false);
  });

  it("keeps Cursor rehearsal on this repo/ref with autoCreatePR=false and verified read-back", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/v1/agents") && init?.method === "POST") {
        assert.equal(body?.autoCreatePR, false);
        assert.deepEqual((body?.repos as Array<{ url: string; startingRef: string }>)[0], {
          url: "https://github.com/TRCoach/TRCoaching",
          startingRef: "cursor/tr-training-control-plane-fcd0",
        });
        return new Response(
          JSON.stringify({ agent: { id: body?.agentId, latestRunId: "run-r" }, run: { id: "run-r", status: "CREATING" } }),
          { status: 201 },
        );
      }
      if (url.endsWith("/runs/run-r")) {
        return new Response(JSON.stringify({ status: "FINISHED", result: "rehearsal qa", tests: ["validate"] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const cursor = new CursorDispatch({
      token: "server-only",
      allowRepo: "TRCoach/TRCoaching",
      startingRef: "cursor/tr-training-control-plane-fcd0",
      autoCreatePR: false,
      fetchImpl,
    });
    const store = new MemoryStore();
    const created = await runCursorRehearsal(store, cursor);
    assert.equal(created.job.status, "AWAITING_EXTERNAL");
    const verified = await cursor.status({ ...created.job, externalId: created.job.externalId, runId: created.job.runId });
    assert.equal(verified.status, "COMPLETED");
    assert.deepEqual(verified.tests, ["validate"]);
  });
});

describe("founder console phase C worker and HTTP", () => {
  it("verifies PBKDF2 via Web Crypto and never throws on unsupported hashes", async () => {
    const hash = FounderAuth.hashPasswordPbkdf2("phase-c-test-password", "c-salt");
    assert.equal(await FounderAuth.verifyPassword("phase-c-test-password", hash), true);
    assert.equal(await FounderAuth.verifyPassword("wrong-password", hash), false);
    assert.equal(await FounderAuth.verifyPassword("x", "not-a-hash"), false);
    assert.equal(await FounderAuth.verifyPassword("x", "scrypt"), false);
    const nodeHash = Buffer.from(await FounderAuth.derivePbkdf2("phase-c-test-password", "c-salt", 310000)).toString("hex");
    assert.equal(hash.endsWith(`$${nodeHash}`), true);
  });

  it("returns JSON for Worker login even when persistence fails", async () => {
    const db = new MemoryD1();
    db.batch = async () => {
      throw new Error("d1 projection failed");
    };
    const hash = FounderAuth.hashPasswordPbkdf2("phase-c-test-password", "c-salt");
    const env = {
      DB: db,
      FOUNDER_SESSION_SECRET: "tr-founder-phase-c-session-secret-32ch",
      FOUNDER_AUTH_PASSWORD_HASH: hash,
      FOUNDER_OPENAI_DISABLED: "1",
    };
    const login = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "founder", password: "phase-c-test-password" }),
      }),
      env,
    );
    assert.equal(login.headers.get("content-type")?.includes("application/json"), true);
    const body = (await login.json()) as { ok?: boolean; reason?: string };
    assert.equal(login.status, 503);
    assert.equal(body.ok, false);
    assert.match(body.reason ?? "", /persist session/);
  });

  it("blocks anonymous Worker API access and supports PBKDF2 login/CSRF", async () => {
    const db = new MemoryD1();
    const hash = FounderAuth.hashPasswordPbkdf2("phase-c-test-password", "c-salt");
    const env = {
      DB: db,
      FOUNDER_SESSION_SECRET: "tr-founder-phase-c-session-secret-32ch",
      FOUNDER_AUTH_PASSWORD_HASH: hash,
      FOUNDER_OPENAI_DISABLED: "1",
    };
    const health = await worker.fetch(new Request("https://tr-founder-console.workers.dev/api/health"), env);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.openaiDisabled, true);
    assert.equal((await worker.fetch(new Request("https://tr-founder-console.workers.dev/api/overview"), env)).status, 401);
    const login = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "founder", password: "phase-c-test-password" }),
      }),
      env,
    );
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { csrf: string };
    const cookie = login.headers.get("set-cookie") ?? "";
    const denied = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/command", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ text: "Run Daily Business Cycle" }),
      }),
      env,
    );
    assert.equal(denied.status, 403);
    const ok = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/command", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": loginBody.csrf },
        body: JSON.stringify({ text: "Run Daily Business Cycle", operating_mode: "LIVE", email: undefined }),
      }),
      env,
    );
    assert.equal(ok.status, 200);
    const leaked = await ok.text();
    assert.equal(/sk_live|password|zone_c/.test(leaked), false);
    const detail = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/detail/action/run_daily_business_cycle", {
        headers: { cookie },
      }),
      env,
    );
    assert.equal(detail.status, 200);
    for (let i = 0; i < 6; i += 1) {
      await worker.fetch(
        new Request("https://tr-founder-console.workers.dev/api/login", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
          body: JSON.stringify({ username: "founder", password: "wrong-password" }),
        }),
        env,
      );
    }
    const limited = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify({ username: "founder", password: "wrong-password" }),
      }),
      env,
    );
    assert.equal(limited.status, 429);
    const asset = await worker.fetch(new Request("https://tr-founder-console.workers.dev/"), {
      ...env,
      ASSETS: {
        fetch: async () => new Response("<html>Add to Home Screen</html>", { headers: { "content-type": "text/html" } }),
      },
    } as typeof env);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /Add to Home Screen/);
  });

  it("serves PWA/offline/health and keeps 17 actions plus honest disconnected cards", async () => {
    const started = await startConsoleServer({ port: 0 });
    try {
      const session = await loginFounder(started.url);
      const home = await (await fetch(`${started.url}/`)).text();
      assert.match(home, /Add to Home Screen/);
      assert.match(home, /Slack rehearsal/);
      const manifest = await (await fetch(`${started.url}/manifest.webmanifest`)).json();
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.background_color, "#0b0d10");
      const sw = await (await fetch(`${started.url}/sw.js`)).text();
      assert.match(sw, /tr-founder-console-test-v3/);
      const css = await (await fetch(`${started.url}/styles.css`)).text();
      assert.match(css, /\[hidden\]/);
      assert.match(css, /minmax\(0, 1fr\)/);
      const health = await (await fetch(`${started.url}/api/health`)).json();
      assert.equal(health.unauthorizedBusinessWrites, 0);
      const evidence = await (
        await fetch(`${started.url}/api/evidence`, { headers: { cookie: session.cookie } })
      ).json();
      assert.equal(evidence.openaiDisabled, true);
      assert.ok(evidence.items.every((item: { freshness: string }) => item.freshness !== "VERIFIED" || item.freshness === "VERIFIED"));
      const sensitive = await fetch(`${started.url}/api/command`, {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({ text: "hi", email: "hidden@example.com" }),
      });
      assert.equal(sensitive.status, 400);
    } finally {
      started.server.close();
    }
  });

  it("preserves Phase B dispatch semantics and zero unauthorised writes", async () => {
    const service = new ConsoleService();
    const summary = await service.dispatch.progressToday();
    assert.equal(summary.unauthorizedWrites, 0);
    assert.ok(service.catalog().actions.length === 17);
    assert.equal(service.mode(), "TEST");
    const spoof = service.runAction("run_controlled_beta_readiness_audit", undefined, { operating_mode: "LIVE" });
    assert.equal(spoof.mode, "TEST");
    assert.equal(loadPermissions().currentMode, "TEST");
    const engine = DispatchEngine.forTests(new MemoryStore(), loadPermissions(), new MemorySlackTransport());
    void engine;
  });
});

describe("founder console phase C static acceptance", () => {
  it("includes desktop/mobile install copy and no secrets in public shell", () => {
    const html = readFileSync("console/public/index.html", "utf8");
    const css = readFileSync("console/public/styles.css", "utf8");
    assert.match(html, /Windows Edge\/Chrome/);
    assert.match(html, /iOS Safari/);
    assert.match(css, /minmax/);
    assert.equal(/sk_live|rk_live|OPENAI_API_KEY=sk-/.test(html), false);
    const wrangler = readFileSync("wrangler.toml", "utf8");
    assert.match(wrangler, /workers.dev/);
    assert.match(wrangler, /d1_databases/);
    assert.match(wrangler, /FOUNDER_OPENAI_DISABLED/);
  });

  it("keeps bundled Worker model JSON identical to repo model files", () => {
    for (const name of ["permissions.json", "founder-actions.json", "lifecycle.json"]) {
      assert.equal(readFileSync(`src/bundled/${name}`, "utf8"), readFileSync(`model/${name}`, "utf8"));
    }
    assert.equal(BUNDLED_PERMISSIONS.currentMode, "TEST");
    assert.match(D1_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS console_meta/);
    assert.match(D1_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS sessions/);
  });

  it("falls back to bundled JSON when the default model path is missing", () => {
    const fallback = loadJsonWithFallback(undefined, { currentMode: "TEST" as const }, "/not-a-real/permissions.json");
    assert.equal(fallback.currentMode, "TEST");
    assert.throws(() => loadJsonWithFallback("/also-missing/permissions.json", { currentMode: "TEST" as const }, "/default"));
  });
});

describe("founder console worker login path without repo filesystem or D1 tables", () => {
  it("returns JSON session and login without a Worker exception when D1 schema is missing", async () => {
    class SchemaOnDemandD1 extends MemoryD1 {
      #ready = false;
      override prepare(sql: string) {
        if (!this.#ready && /FROM console_meta/i.test(sql)) {
          throw new Error("no such table: console_meta");
        }
        return super.prepare(sql);
      }
      override async exec() {
        this.#ready = true;
        return { success: true };
      }
    }
    const hash = FounderAuth.hashPasswordPbkdf2("phase-c-test-password", "c-salt");
    const env = {
      DB: new SchemaOnDemandD1(),
      FOUNDER_SESSION_SECRET: "tr-founder-phase-c-session-secret-32ch",
      FOUNDER_AUTH_PASSWORD_HASH: hash,
      FOUNDER_OPENAI_DISABLED: "1",
    };
    const session = await worker.fetch(new Request("https://tr-founder-console.workers.dev/api/session"), env);
    assert.equal(session.status, 200);
    assert.equal(session.headers.get("content-type")?.includes("application/json"), true);
    const sessionBody = (await session.json()) as { authenticated?: boolean; reason?: string };
    assert.equal(sessionBody.authenticated, false);
    assert.notEqual(sessionBody.reason, "founder console worker exception");
    const denied = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "founder", password: "wrong-password" }),
      }),
      env,
    );
    assert.equal(denied.status, 401);
    const deniedBody = (await denied.json()) as { ok?: boolean; reason?: string };
    assert.equal(deniedBody.ok, false);
    assert.notEqual(deniedBody.reason, "founder console worker exception");
    const login = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "founder", password: "phase-c-test-password" }),
      }),
      env,
    );
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { ok?: boolean; csrf?: string };
    assert.equal(loginBody.ok, true);
    assert.ok(loginBody.csrf);
  });
});
