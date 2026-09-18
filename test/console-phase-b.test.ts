import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { FounderAuth } from "../src/console/auth.ts";
import { MemoryStore } from "../src/console/store.ts";
import { JsonFileStore } from "../src/console/file-store.ts";
import { collectEvidence } from "../src/console/evidence.ts";
import { DispatchEngine, MemorySlackTransport } from "../src/console/dispatch.ts";
import { startConsoleServer } from "../src/console/http.ts";
import { ConsoleService } from "../src/console/service.ts";
import { EXACT_PROMPTS, classifyCommand } from "../src/console/router.ts";
import { loadPermissions } from "../src/permissions.ts";
import { forbiddenKeys } from "../src/sensitive.ts";
import { authHeaders, loginFounder } from "./console-auth.ts";

describe("founder console phase B", () => {
  it("classifies the required progress-today command", () => {
    const classified = classifyCommand(EXACT_PROMPTS.progress_today);
    assert.equal(classified.confidence, "exact");
    assert.deepEqual(classified.actionIds, ["progress_everything_today"]);
  });

  it("dispatches linked sub-events and does not fake Cursor/ChatGPT success", async () => {
    const slack = new MemorySlackTransport();
    const store = new MemoryStore();
    const permissions = loadPermissions();
    const engine = DispatchEngine.forTests(store, permissions, slack);
    const summary = await engine.progressToday();
    assert.ok(summary.decomposition.length >= 6);
    assert.equal(new Set(summary.decomposition.map((item) => item.id)).size, summary.decomposition.length);
    assert.match(summary.founderFriendlySummary, /Progressed:/);
    assert.match(summary.founderFriendlySummary, /Awaiting external:/);
    assert.match(summary.founderFriendlySummary, /Founder required:/);
    assert.ok(summary.founderRequired.length >= 1);
    assert.ok(summary.blocked.some((job) => /NOT_CONNECTED|Cursor|ChatGPT/.test(job.resultSummary)));
    assert.ok(slack.posts.length >= 1);
    const envelope = slack.posts[0]!;
    assert.equal(envelope.prefix, "Grok_Alex:");
    assert.equal(envelope.kind, "OPS_EVENT");
    assert.ok(envelope.event_id);
    assert.equal(envelope.correlation_id, summary.correlationId);
    assert.ok(envelope.owner);
    assert.ok(envelope.current_state);
    assert.ok(envelope.bounded_action);
    assert.ok(envelope.due_time);
    assert.ok(envelope.stop_condition);
    const replay = await slack.submit(envelope);
    assert.match(replay.detail, /idempotent/);
    const ingested = engine.ingestStatus({
      kind: "OPS_STATUS",
      event_id: envelope.event_id,
      correlation_id: envelope.correlation_id,
      status: "COMPLETED",
      detail: "Alex acknowledged",
    });
    assert.equal(ingested?.status, "COMPLETED");
    assert.equal(summary.unauthorizedWrites, 0);
  });

  it("keeps Cursor and ChatGPT honestly disconnected by default", async () => {
    const cards = collectEvidence({ demoFixtures: false });
    const cursor = cards.find((item) => item.id === "cursor");
    const chatgpt = cards.find((item) => item.id === "chatgpt");
    assert.equal(cursor?.freshness, "NOT_CONNECTED");
    assert.equal(chatgpt?.freshness, "NOT_CONNECTED");
    assert.match(cursor?.setupRequirement ?? "", /Cursor Cloud/);
    assert.match(chatgpt?.setupRequirement ?? "", /OPENAI_API_KEY/);
    assert.notEqual(cursor?.freshness, "VERIFIED");
  });

  it("never marks missing evidence VERIFIED or green", () => {
    const cards = collectEvidence({ demoFixtures: true });
    for (const card of cards) {
      assert.notEqual(card.freshness, "VERIFIED");
      assert.equal(card.credentialsExposed, false);
    }
    assert.ok(cards.some((card) => card.freshness === "DEMO_FIXTURE" || card.freshness === "NOT_CONNECTED"));
  });

  it("persists preferences across restart without secrets or PII", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-console-"));
    const path = join(dir, "console-store.json");
    const store = new JsonFileStore(path);
    const service = new ConsoleService(loadPermissions(), { store });
    const prefs = service.preferences();
    prefs[0]!.displayName = "Daily pulse";
    prefs[0]!.visible = true;
    service.savePreferences(prefs);
    const restarted = new ConsoleService(loadPermissions(), { store: new JsonFileStore(path) });
    assert.equal(restarted.preferences()[0]?.displayName, "Daily pulse");
    assert.equal(forbiddenKeys(restarted.store.load()).length, 0);
    store.save({
      version: 1,
      sessions: [],
      preferences: restarted.store.load().preferences,
      jobs: [
        {
          id: "evt_legacy",
          correlationId: "corr_legacy",
          title: "legacy",
          owner: "Cursor",
          executor: "Cursor",
          status: "AWAITING_EXTERNAL",
          boundedAction: "bounded_qa_report",
          evidenceRefs: ["TRCoach/TRCoaching"],
          resultSummary: "legacy",
          createdAt: "2026-09-18T00:00:00.000Z",
          updatedAt: "2026-09-18T00:00:00.000Z",
          founderGate: false,
        },
      ],
      audits: [],
    } as never);
    const migrated = new JsonFileStore(path).load();
    assert.equal(migrated.version, 3);
    assert.equal(migrated.revision, 0);
    assert.deepEqual(migrated.jobs[0]?.tests, []);
    assert.deepEqual(migrated.jobs[0]?.blockers, []);
    assert.deepEqual(migrated.probes, []);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exposes drilldowns for lanes, decisions and jobs", async () => {
    const service = new ConsoleService();
    await service.progressEverythingAsync();
    const lane = service.detail("lane", "closed_won");
    assert.equal(lane.state, "blocked");
    assert.ok(lane.evidence);
    const decision = service.detail("decision", service.inbox()[0]!.id);
    assert.ok(decision.impact);
    assert.ok(decision.nextTrigger);
    const job = service.store.load().jobs[0];
    if (job) {
      const detail = service.detail("job", job.id);
      assert.ok(detail.state);
    }
  });

  it("persists auditable founder interactions on every lane card", () => {
    const store = new MemoryStore();
    const service = new ConsoleService(loadPermissions(), { store });
    const noted = service.laneAction("publication_errors", "PUBERR-CONSOLE-001", "add_instruction", "Use the corrected exact-final asset and return evidence.");
    assert.equal(noted.ok, true);
    const requested = service.laneAction("publication_errors", "PUBERR-CONSOLE-001", "request_evidence", "Return provider and checksum evidence.");
    assert.equal(requested.ok, true);
    const unsafeResolve = service.laneAction("publication_errors", "PUBERR-CONSOLE-001", "resolve", "done");
    assert.equal(unsafeResolve.ok, false);
    const restarted = new ConsoleService(loadPermissions(), { store });
    const detail = restarted.detail("lane", "publication_errors");
    assert.ok(detail.items?.[0]?.auditHistory?.some((row) => row.type === "lane_instruction"));
    assert.equal(detail.items?.[0]?.controls.canAcknowledge, true);
    assert.equal(detail.items?.[0]?.controls.canResolve, false);
    assert.ok(store.load().audits.length >= 3);
  });

  it("builds an independent-executor next-week social workflow", async () => {
    const slack = new MemorySlackTransport();
    const store = new MemoryStore();
    const dispatch = DispatchEngine.forTests(store, loadPermissions(), slack);
    const service = new ConsoleService(loadPermissions(), {
      store,
      dispatch,
      evidence: collectEvidence({ demoFixtures: false }),
    });
    const summary = await service.prepareNextWeeksSocial();
    assert.equal(summary.blocked.length, 0);
    assert.ok(summary.awaitingExternal.length >= 4);
    assert.ok(slack.posts.some((item) => item.kind === "OPS_EVENT" && item.bounded_action === "grok_taylor_social_cycle"));
    assert.ok(slack.handoffs.some((item) => item.kind === "CHATGPT_SOCIAL_ACTION"));
    assert.ok(summary.decomposition.some((step) => step.boundedAction === "CHATGPT_SOCIAL_ACTION"));
    assert.ok(summary.decomposition.some((step) => step.evidenceRefs.includes("tiktok_photo_jpeg_or_webp_not_png")));
    assert.ok(summary.decomposition.some((step) => step.evidenceRefs.includes("no_text_overlap")));
    assert.equal(summary.unauthorizedWrites, 0);
    assert.match(summary.founderFriendlySummary, /CHATGPT_SOCIAL_ACTION/);
    assert.equal(summary.founderFriendlySummary.includes("Blocked: 10"), false);
  });

  it("expires sessions and rate-limits login", async () => {
    const store = new MemoryStore();
    const auth = new FounderAuth(store, FounderAuth.testing());
    const ok = await auth.login("founder", "phase-b-test-password", "127.0.0.1");
    assert.equal(ok.ok, true);
    store.exclusive((data) => {
      const session = data.sessions[0];
      if (session) session.expiresAt = "2000-01-01T00:00:00Z";
    });
    assert.equal(auth.resolve(ok.token), undefined);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await auth.login("founder", "nope", "203.0.113.9")).status, 401);
    }
    assert.equal((await auth.login("founder", "nope", "203.0.113.9")).status, 429);
  });

  it("customization cannot change catalog permissions", () => {
    const service = new ConsoleService();
    const before = service.catalog().actions[0]!;
    service.savePreferences(
      service.preferences().map((item, index) =>
        index === 0 ? { ...item, displayName: "Renamed", confirm: true } : item,
      ),
    );
    const after = service.catalog().actions[0]!;
    assert.equal(after.id, before.id);
    assert.equal(after.founderGate, before.founderGate);
    assert.deepEqual(after.allowedActions, before.allowedActions);
    assert.equal(service.visibleActions()[0]?.title, "Renamed");
  });
});

describe("founder console phase B HTTP security", () => {
  const runtime = startConsoleServer({ port: 0 });

  after(async () => {
    (await runtime).server.close();
  });

  it("blocks anonymous data, CSRF, and mode spoof; login works", async () => {
    const started = await runtime;
    assert.equal((await fetch(`${started.url}/api/overview`)).status, 401);
    const denied = await fetch(`${started.url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "founder", password: "wrong" }),
    });
    assert.equal(denied.status, 401);
    const session = await loginFounder(started.url);
    assert.equal(session.status, 200);
    const csrfFail = await fetch(`${started.url}/api/command`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session.cookie },
      body: JSON.stringify({ text: "Run Daily Business Cycle" }),
    });
    assert.equal(csrfFail.status, 403);
    const command = await fetch(`${started.url}/api/command`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ text: EXACT_PROMPTS.progress_today, operating_mode: "LIVE" }),
    });
    const body = await command.json();
    assert.equal(body.mode, "TEST");
    assert.match(body.founderFriendlySummary, /Progressed:/);
    assert.equal(body.externalWrites, 0);
    const leaked = JSON.stringify(body);
    assert.equal(/sk_live|api_key|password/.test(leaked), false);
    assert.equal(forbiddenKeys(body).length, 0);
  });
});

describe("founder console phase B QA delta", () => {
  it("creates and reads server-minted Cursor v1 agents without unsafe create retries", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const agentId = "bc-11111111-1111-1111-1111-111111111111";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (method === "GET" && url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ items: [{ id: "composer-2", aliases: ["composer"] }] }), { status: 200 });
      }
      if (method === "POST" && url.endsWith("/v1/agents")) {
        assert.equal(body.autoCreatePR, true);
        assert.deepEqual(body.repos, [{ url: "https://github.com/TRCoach/TRCoaching", startingRef: "main" }]);
        assert.equal(body.agentId, undefined);
        assert.equal(body.model.id, "composer-2");
        assert.match(body.prompt.text, /TRCoach\/TRCoaching/);
        return new Response(
          JSON.stringify({
            agent: { id: agentId, latestRunId: "run-created" },
            run: { id: "run-created", status: "CREATING" },
          }),
          { status: 201 },
        );
      }
      if (url.endsWith("/runs/run-created")) {
        return new Response(JSON.stringify({ status: "FINISHED", result: "QA report", tests: ["validate"] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    const { CursorDispatch } = await import("../src/console/cursor-v1.ts");
    const cursor = new CursorDispatch({
      token: "server-only-test-token",
      allowRepo: "TRCoach/TRCoaching",
      startingRef: "main",
      requestedModel: "composer",
      fetchImpl,
    });
    const job = {
      id: "evt_cursor",
      correlationId: "corr_cursor",
      title: "qa",
      owner: "Cursor",
      executor: "Cursor",
      status: "RUNNING" as const,
      boundedAction: "bounded_qa_report",
      evidenceRefs: ["TRCoach/TRCoaching"],
      resultSummary: "",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
      founderGate: false,
    };
    const created = await cursor.dispatch(job);
    assert.equal(created.status, "AWAITING_EXTERNAL");
    assert.ok(created.externalId);
    assert.equal(created.runId, "run-created");
    assert.equal(created.model, "composer-2");
    const verified = await cursor.status({ ...job, externalId: created.externalId, runId: created.runId, model: created.model });
    assert.equal(verified.status, "COMPLETED");
    assert.deepEqual(verified.tests, ["validate"]);
    const missingIdentity = await cursor.status(job);
    assert.equal(missingIdentity.status, "BLOCKED");
    assert.match(missingIdentity.detail, /never retried automatically/);
    assert.equal(calls.filter((item) => item.method === "POST" && item.url.endsWith("/v1/agents")).length, 1);
  });

  it("keeps OpenAI spend gated and posts the Responses background contract", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/v1/responses") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "resp_1", status: "queued" }), { status: 200 });
      }
      if (url.endsWith("/v1/responses/resp_1")) {
        return new Response(JSON.stringify({ id: "resp_1", status: "completed", output_text: "review ok" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    const { ChatGptDispatch } = await import("../src/console/openai-responses.ts");
    const gated = new ChatGptDispatch({
      enabled: false,
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      fetchImpl,
    });
    const job = {
      id: "evt_gpt",
      correlationId: "corr_gpt",
      title: "qa",
      owner: "ChatGPT",
      executor: "ChatGPT",
      status: "RUNNING" as const,
      boundedAction: "independent_qa_review",
      evidenceRefs: ["qa_report_ref"],
      resultSummary: "",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
      founderGate: false,
    };
    const blocked = await gated.dispatch(job);
    assert.equal(blocked.status, "BLOCKED");
    assert.match(blocked.detail, /NOT_CONNECTED/);
    assert.equal(calls.length, 0);
    const live = new ChatGptDispatch({
      enabled: true,
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      fetchImpl,
    });
    const created = await live.dispatch(job);
    assert.equal(created.status, "AWAITING_EXTERNAL");
    assert.equal(created.externalId, "resp_1");
    assert.equal(calls[0]?.body?.background, true);
    assert.equal(calls[0]?.body?.model, "gpt-4.1-mini");
    const input = JSON.parse(String(calls[0]?.body?.input ?? "{}")) as Record<string, unknown>;
    assert.equal(input.event_id, "evt_gpt");
    assert.equal(JSON.stringify(input).includes("@"), false);
    const verified = await live.status({ ...job, externalId: "resp_1" });
    assert.equal(verified.status, "COMPLETED");
  });

  it("collects correlated Slack OPS_STATUS and rejects wrong correlation, status, executor, and oversized detail", async () => {
    const slack = new MemorySlackTransport();
    const store = new MemoryStore();
    const engine = DispatchEngine.forTests(store, loadPermissions(), slack);
    const summary = await engine.progressToday();
    const slackJob = store.load().jobs.find((item) => item.executor === "Slack");
    assert.ok(slackJob);
    slack.inbox.push(
      [
        "Grok_Alex: OPS_STATUS",
        `event_id=${slackJob!.id}`,
        `correlation_id=${summary.correlationId}`,
        "status=COMPLETED",
        "executor=Slack",
        "detail=Alex acknowledged",
      ].join("\n"),
    );
    slack.inbox.push(
      [
        "Grok_Alex: OPS_STATUS",
        `event_id=${slackJob!.id}`,
        "correlation_id=corr_wrong",
        "status=COMPLETED",
        "executor=Slack",
        "detail=nope",
      ].join("\n"),
    );
    slack.inbox.push(
      [
        "Grok_Alex: OPS_STATUS",
        `event_id=${slackJob!.id}`,
        `correlation_id=${summary.correlationId}`,
        "status=DONE",
        "executor=Slack",
        "detail=nope",
      ].join("\n"),
    );
    slack.inbox.push(
      [
        "Grok_Alex: OPS_STATUS",
        `event_id=${slackJob!.id}`,
        `correlation_id=${summary.correlationId}`,
        "status=COMPLETED",
        "executor=Cursor",
        "detail=nope",
      ].join("\n"),
    );
    slack.inbox.push(
      [
        "Grok_Alex: OPS_STATUS",
        `event_id=${slackJob!.id}`,
        `correlation_id=${summary.correlationId}`,
        "status=COMPLETED",
        "executor=Slack",
        `detail=${"x".repeat(500)}`,
      ].join("\n"),
    );
    const refreshed = await engine.refresh();
    assert.equal(store.load().jobs.find((item) => item.id === slackJob!.id)?.status, "COMPLETED");
    assert.ok(refreshed.rejected.some((item) => item.reason === "wrong correlation"));
    assert.ok(refreshed.rejected.some((item) => item.reason === "unknown status"));
    assert.ok(refreshed.rejected.some((item) => item.reason === "wrong executor"));
    assert.ok(refreshed.rejected.some((item) => item.reason === "oversized detail"));
    assert.equal(refreshed.unauthorizedBusinessWrites, 0);
  });

  it("discards live probe response bodies and persists only labels", async () => {
    let cancelled = 0;
    const fetchImpl: typeof fetch = async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ email: "hidden@example.com", secret: "nope" })));
          controller.close();
        },
        cancel() {
          cancelled += 1;
        },
      });
      return new Response(stream, { status: 200 });
    };
    const { probeConnectors } = await import("../src/console/probes.ts");
    const probes = await probeConnectors(
      {
        demoFixtures: false,
        driveKey: "drive",
        crmKey: "crm",
        crmUrl: "https://crm.example.test/health",
        metricoolKey: "metricool",
        metricoolUrl: "https://metricool.example.test/health",
        stripeKey: "stripe",
        supersetKey: "superset",
        supersetUrl: "https://superset.example.test/health",
        slackToken: "slack",
        cursorToken: "cursor",
        githubToken: "github",
      },
      fetchImpl,
    );
    assert.ok(probes.every((item) => item.bodyDiscarded));
    assert.ok(cancelled >= 8);
    assert.ok(probes.every((item) => item.evidenceLabel === "auth_or_metadata_probe_http_ok"));
    assert.equal(JSON.stringify(probes).includes("hidden@example.com"), false);
    assert.equal(JSON.stringify(probes).includes("nope"), false);
    const missing = await probeConnectors({ demoFixtures: false }, fetchImpl);
    assert.ok(missing.every((item) => item.evidenceLabel === "NOT_CONNECTED"));
  });

  it("protects logout and session rotation with auth and CSRF", async () => {
    const started = await startConsoleServer({ port: 0 });
    try {
      const anon = await fetch(`${started.url}/api/logout`, { method: "POST", body: "{}" });
      assert.equal(anon.status, 401);
      const session = await loginFounder(started.url);
      const csrfFail = await fetch(`${started.url}/api/logout`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: session.cookie },
        body: "{}",
      });
      assert.equal(csrfFail.status, 403);
      const rotated = await fetch(`${started.url}/api/session/rotate`, {
        method: "POST",
        headers: authHeaders(session),
        body: "{}",
      });
      assert.equal(rotated.status, 200);
      const rotatedBody = (await rotated.json()) as { csrf: string };
      const rotatedCookie = rotated.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
      const stale = await fetch(`${started.url}/api/overview`, { headers: { cookie: session.cookie } });
      assert.equal(stale.status, 401);
      const ok = await fetch(`${started.url}/api/overview`, { headers: { cookie: rotatedCookie } });
      assert.equal(ok.status, 200);
      const logout = await fetch(`${started.url}/api/logout`, {
        method: "POST",
        headers: authHeaders({ cookie: rotatedCookie, csrf: rotatedBody.csrf }),
        body: "{}",
      });
      assert.equal(logout.status, 200);
      const after = await fetch(`${started.url}/api/overview`, { headers: { cookie: rotatedCookie } });
      assert.equal(after.status, 401);
    } finally {
      started.server.close();
    }
  });
});
