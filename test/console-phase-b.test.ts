import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { FounderAuth } from "../src/console/auth.ts";
import { JsonFileStore, MemoryStore } from "../src/console/store.ts";
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

  it("expires sessions and rate-limits login", () => {
    const store = new MemoryStore();
    const auth = new FounderAuth(store, FounderAuth.testing());
    const ok = auth.login("founder", "phase-b-test-password", "127.0.0.1");
    assert.equal(ok.ok, true);
    store.exclusive((data) => {
      const session = data.sessions[0];
      if (session) session.expiresAt = "2000-01-01T00:00:00Z";
    });
    assert.equal(auth.resolve(ok.token), undefined);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(auth.login("founder", "nope", "203.0.113.9").status, 401);
    }
    assert.equal(auth.login("founder", "nope", "203.0.113.9").status, 429);
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
