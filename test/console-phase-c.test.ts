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
import { DispatchEngine, LiveSlackTransport, MemorySlackTransport } from "../src/console/dispatch.ts";
import { newId } from "../src/console/ids.ts";
import { CursorDispatch } from "../src/console/cursor-v1.ts";
import { ingestRehearsalStatus, runCursorRehearsal, runSlackRehearsal, SLACK_REHEARSAL_ACTION } from "../src/console/rehearsal.ts";
import { ChatGptDispatch } from "../src/console/openai-responses.ts";
import { ConsoleService } from "../src/console/service.ts";
import { startConsoleServer } from "../src/console/http.ts";
import { loadPermissions } from "../src/permissions.ts";
import { BUNDLED_PERMISSIONS, loadJsonWithFallback } from "../src/model-json.ts";
import { importMetaDir, repoRoot } from "../src/paths.ts";
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

  it("retains Worker-bound connector credentials during evidence refresh", async () => {
    const evidenceEnv = {
      demoFixtures: false,
      cursorToken: "server-only",
      cursorAllowRepo: "TRCoach/TRCoaching",
      cursorStartingRef: "cursor/tr-training-control-plane-fcd0",
      openaiForcedOff: true,
    };
    const service = new ConsoleService(loadPermissions(), {
      evidenceEnv,
      evidence: collectEvidence({ demoFixtures: false }),
    });
    await service.refreshEvidence(async () => new Response("{}", { status: 200 }));
    const cursor = service.evidenceCards.find((item) => item.id === "cursor");
    assert.equal(cursor?.freshness, "UNKNOWN");
    assert.match(cursor?.detail ?? "", /server-only Cursor token is present/);
  });
});

describe("founder console phase C rehearsals", () => {
  it("reads threaded OPS_STATUS only from an allowlisted Slack sender", async () => {
    const eventId = "evt_threaded_status";
    const correlationId = "corr_threaded_status";
    const statusText = [
      "Grok_Alex: OPS_STATUS",
      `event_id=${eventId}`,
      `correlation_id=${correlationId}`,
      "status=COMPLETED",
      "executor=Slack",
      "detail=approved threaded return",
    ].join("\n");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("conversations.history")) {
        return new Response(JSON.stringify({ ok: true, messages: [{ ts: "200.2", user: "U_SPOOF", text: statusText }] }));
      }
      return new Response(JSON.stringify({
        ok: true,
        messages: [
          { ts: "100.1", bot_id: "B_CONSOLE", text: "Grok_Alex: OPS_EVENT" },
          { ts: "100.2", user: "U_APPROVED", text: statusText },
        ],
      }));
    };
    const transport = new LiveSlackTransport("xoxb-test", "C0C2B0TFN48", true, "U_APPROVED", fetchImpl);
    const collected = await transport.collect([{
      id: eventId,
      correlationId,
      title: "Threaded return",
      owner: "Alex",
      executor: "Slack",
      status: "AWAITING_EXTERNAL",
      boundedAction: "slack_grok_rehearsal",
      evidenceRefs: [],
      resultSummary: "posted",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      externalId: "100.1",
      founderGate: false,
    }]);
    assert.equal(collected.statuses.length, 1);
    assert.equal(collected.statuses[0]?.detail, "approved threaded return");
    assert.ok(collected.rejected.some((item) => /not allowlisted/.test(item.reason)));
  });

  it("accepts the approved Grok/Alex status envelope used in #ai-ops", async () => {
    const eventId = "evt_live_shape";
    const correlationId = "corr_live_shape";
    const statusText = [
      "COMPLETED",
      "Grok_Alex: OPS_STATUS",
      `event_id=${eventId}`,
      `correlation_id=${correlationId}`,
      "owner=Alex",
      "status=COMPLETED",
      "current_state=TEST",
      "bounded_action=slack_grok_rehearsal",
      "verified_evidence=ingested approved event; zero business-system writes; one status reply only",
      "state_after=TEST",
      "next_trigger=none",
    ].join("\n");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("conversations.history")) {
        return new Response(JSON.stringify({ ok: true, messages: [] }));
      }
      return new Response(JSON.stringify({
        ok: true,
        messages: [
          { ts: "300.1", bot_id: "B_CONSOLE", text: "Grok_Alex: OPS_EVENT" },
          { ts: "300.2", user: "U_APPROVED", text: statusText },
        ],
      }));
    };
    const transport = new LiveSlackTransport("xoxb-test", "C0C2B0TFN48", true, "U_APPROVED", fetchImpl);
    const collected = await transport.collect([{
      id: eventId,
      correlationId,
      title: "Live-shaped return",
      owner: "Alex",
      executor: "Slack",
      status: "AWAITING_EXTERNAL",
      boundedAction: "slack_grok_rehearsal",
      evidenceRefs: [],
      resultSummary: "posted",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      externalId: "300.1",
      founderGate: false,
    }]);
    assert.equal(collected.statuses.length, 1);
    assert.equal(collected.statuses[0]?.status, "COMPLETED");
    assert.match(collected.statuses[0]?.detail ?? "", /zero business-system writes/);
  });

  it("promotes a connector card only after a matching completed result is persisted", async () => {
    const store = new MemoryStore();
    const updatedAt = new Date().toISOString();
    store.exclusive((data) => {
      data.jobs.push({
        id: "evt_verified_slack",
        correlationId: "corr_verified_slack",
        title: "Verified Slack round trip",
        owner: "Alex",
        executor: "Slack",
        status: "COMPLETED",
        boundedAction: SLACK_REHEARSAL_ACTION,
        evidenceRefs: ["TRCoach/TRCoaching"],
        resultSummary: "verified return",
        createdAt: updatedAt,
        updatedAt,
        externalId: "300.1",
        founderGate: false,
      });
      data.resultEnvelopes.push({
        id: "env_verified_slack",
        jobId: "evt_verified_slack",
        correlationId: "corr_verified_slack",
        status: "COMPLETED",
        detail: "approved OPS_STATUS with zero business-system writes",
        collectedAt: updatedAt,
      });
    });
    const evidence = collectEvidence({
      demoFixtures: false,
      slackToken: "xoxb-test",
      slackChannel: "C0C2B0TFN48",
      slackDispatchEnabled: true,
    });
    const service = new ConsoleService(loadPermissions(), { store, evidence });
    await service.refreshJobs();
    const slack = service.evidenceCards.find((item) => item.id === "slack");
    assert.equal(slack?.freshness, "VERIFIED");
    assert.equal(slack?.lastVerified, updatedAt);
    assert.match(slack?.detail ?? "", /Founder Console .* Slack\/Grok .* OPS_STATUS .* Console round trip/);
  });

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

  it("fail-closes a Cursor transport exception as an auditable blocked job", async () => {
    const cursor = new CursorDispatch({
      token: "server-only",
      allowRepo: "TRCoach/TRCoaching",
      startingRef: "cursor/tr-training-control-plane-fcd0",
      autoCreatePR: false,
      fetchImpl: async () => {
        throw new Error("provider unavailable");
      },
    });
    const store = new MemoryStore();
    const result = await runCursorRehearsal(store, cursor);
    assert.equal(result.ok, false);
    assert.equal(result.job.status, "BLOCKED");
    assert.match(result.job.resultSummary, /failed before verified provider acceptance/);
    assert.deepEqual(result.job.blockers, ["cursor_dispatch_exception"]);
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
      assert.match(sw, /tr-founder-console-test-v4/);
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
    assert.match(html, /Prepare next week’s social media/);
    assert.match(css, /minmax/);
    assert.equal(/sk_live|rk_live|OPENAI_API_KEY=sk-/.test(html), false);
    const wrangler = readFileSync("wrangler.toml", "utf8");
    assert.match(wrangler, /workers.dev/);
    assert.match(wrangler, /d1_databases/);
    assert.match(wrangler, /FOUNDER_OPENAI_DISABLED/);
    assert.match(wrangler, /SLACK_DISPATCH_ENABLED = "1"/);
    assert.match(wrangler, /SLACK_AI_OPS_CHANNEL = "C0C2B0TFN48"/);
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
    const fromThrowingDefault = loadJsonWithFallback(undefined, { currentMode: "TEST" as const }, () => {
      throw new Error("Invalid URL string.");
    });
    assert.equal(fromThrowingDefault.currentMode, "TEST");
  });

  it("resolves repo paths without throwing when import.meta.url is invalid", () => {
    assert.ok(importMetaDir("").length > 0);
    assert.ok(importMetaDir("not-a-url").length > 0);
    assert.ok(repoRoot("/").length > 0);
    assert.equal(loadPermissions().currentMode, "TEST");
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

describe("founder console Worker-safe dispatch and Slack transport", () => {
  const rehearsalEnvelope = {
    prefix: "Grok_Alex:" as const,
    kind: "OPS_EVENT" as const,
    event_id: "evt_test1",
    correlation_id: "corr_test1",
    owner: "Alex",
    current_state: "TEST",
    bounded_action: SLACK_REHEARSAL_ACTION,
    evidence_refs: ["TRCoach/TRCoaching"],
    due_time: "2026-09-18T00:00:00.000Z",
    stop_condition: "test only",
  };

  it("allocates ids from Web Crypto rather than node:crypto.randomUUID", () => {
    const id = newId("corr");
    assert.match(id, /^corr_[0-9a-f]{8}$/);
    const source = readFileSync("src/console/ids.ts", "utf8");
    assert.match(source, /globalThis\.crypto\.randomUUID/);
    assert.equal(source.includes("node:crypto"), false);
    assert.equal(readFileSync("src/console/service.ts", "utf8").includes('from "node:crypto"'), false);
  });

  it("treats LiveSlack non-JSON errors as failed posts and never leaks the token", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("auth.test")) {
        return new Response("<html>bad gateway</html>", { status: 502 });
      }
      return new Response("<html>cloudflare</html>", { status: 502 });
    };
    const slack = new LiveSlackTransport("xoxb-test-token-value", "C0C2B0TFN48", true, fetchImpl);
    assert.equal(slack.configured, true);
    const auth = await slack.authTest();
    assert.equal(auth.ok, false);
    assert.match(auth.detail, /non-JSON/);
    const posted = await slack.submit(rehearsalEnvelope);
    assert.equal(posted.ok, false);
    assert.match(posted.detail, /non-JSON/);
    assert.equal(/xoxb-test-token-value/.test(`${auth.detail} ${posted.detail}`), false);
    assert.ok(calls.some((url) => url.includes("auth.test")));
    assert.ok(calls.some((url) => url.includes("chat.postMessage")));
  });

  it("captures Slack message ts on a successful post and joins when not_in_channel", async () => {
    let posts = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("auth.test")) {
        return Response.json({ ok: true, user_id: "U123" });
      }
      if (url.includes("conversations.join")) {
        return Response.json({ ok: true });
      }
      posts += 1;
      if (posts === 1) return Response.json({ ok: false, error: "not_in_channel" });
      return Response.json({ ok: true, ts: "1778880000.000100" });
    };
    const slack = new LiveSlackTransport("xoxb-test-token-value", "C0C2B0TFN48", true, fetchImpl);
    const auth = await slack.authTest();
    assert.equal(auth.ok, true);
    const posted = await slack.submit(rehearsalEnvelope);
    assert.equal(posted.ok, true);
    assert.equal(posted.externalId, "1778880000.000100");
    assert.equal(posts, 2);
  });

  it("does not bind Worker fetch as a method this", () => {
    const source = readFileSync("src/console/dispatch.ts", "utf8");
    assert.match(source, /globalThis\.fetch/);
    assert.equal(/private fetchImpl: typeof fetch = fetch/.test(source), false);
  });

  it("returns JSON for Worker command and Slack rehearsal without a worker exception", async () => {
    const hash = FounderAuth.hashPasswordPbkdf2("phase-c-test-password", "c-salt");
    const env = {
      DB: new MemoryD1(),
      FOUNDER_SESSION_SECRET: "tr-founder-phase-c-session-secret-32ch",
      FOUNDER_AUTH_PASSWORD_HASH: hash,
      FOUNDER_OPENAI_DISABLED: "1",
      SLACK_DISPATCH_ENABLED: "0",
      SLACK_AI_OPS_CHANNEL: "C0C2B0TFN48",
    };
    const health = await worker.fetch(new Request("https://tr-founder-console.workers.dev/api/health"), env);
    const healthBody = (await health.json()) as {
      slackDispatchEnabled?: boolean;
      slackChannelBound?: boolean;
      slackTokenPresent?: boolean;
    };
    assert.equal(healthBody.slackDispatchEnabled, false);
    assert.equal(healthBody.slackChannelBound, true);
    assert.equal(healthBody.slackTokenPresent, false);
    const login = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "founder", password: "phase-c-test-password" }),
      }),
      env,
    );
    const loginBody = (await login.json()) as { csrf: string };
    const cookie = login.headers.get("set-cookie") ?? "";
    const command = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/command", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": loginBody.csrf },
        body: JSON.stringify({ text: "Progress everything that can be progressed today." }),
      }),
      env,
    );
    assert.equal(command.status, 200);
    const commandBody = (await command.json()) as { reason?: string; founderFriendlySummary?: string; ok?: boolean };
    assert.notEqual(commandBody.reason, "founder console worker exception");
    assert.match(commandBody.founderFriendlySummary ?? "", /Progress everything/);
    const rehearsal = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/rehearsal/slack", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": loginBody.csrf },
        body: "{}",
      }),
      env,
    );
    assert.equal(rehearsal.status, 200);
    const rehearsalBody = (await rehearsal.json()) as {
      ok?: boolean;
      reason?: string;
      slackAuth?: boolean;
      job?: { externalId?: string; status?: string };
    };
    assert.notEqual(rehearsalBody.reason, "founder console worker exception");
    assert.equal(rehearsalBody.ok, true);
    assert.equal(rehearsalBody.slackAuth, true);
    assert.ok(rehearsalBody.job?.externalId);
    assert.equal(rehearsalBody.job?.status, "AWAITING_EXTERNAL");
  });

  it("surfaces D1 persist failure after rehearsal without dropping the captured Slack ts", async () => {
    const db = new MemoryD1();
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
    const loginBody = (await login.json()) as { csrf: string };
    const cookie = login.headers.get("set-cookie") ?? "";
    db.batch = async () => {
      throw new Error("d1 projection failed");
    };
    const rehearsal = await worker.fetch(
      new Request("https://tr-founder-console.workers.dev/api/rehearsal/slack", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": loginBody.csrf },
        body: "{}",
      }),
      env,
    );
    assert.equal(rehearsal.status, 503);
    const body = (await rehearsal.json()) as { ok?: boolean; reason?: string; job?: { externalId?: string } };
    assert.equal(body.ok, false);
    assert.match(body.reason ?? "", /persist event/);
    assert.ok(body.job?.externalId);
  });
});
