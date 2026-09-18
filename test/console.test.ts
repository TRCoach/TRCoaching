import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { assertActionCompleteness, loadFounderActions } from "../src/console/actions.ts";
import { startConsoleServer } from "../src/console/http.ts";
import { EXACT_PROMPTS, classifyCommand, normalizePrompt } from "../src/console/router.ts";
import { ConsoleService } from "../src/console/service.ts";
import { FOUNDER_ACTION_TITLES, REQUIRED_ACTION_FIELDS } from "../src/console/types.ts";
import { loadPermissions, withTrustedMode } from "../src/permissions.ts";
import { authHeaders, loginFounder } from "./console-auth.ts";

describe("founder console phase A", () => {
  it("has a complete 17-action config with required fields", () => {
    const catalog = loadFounderActions();
    assert.equal(catalog.actions.length, 17);
    assert.deepEqual(
      catalog.actions.map((item) => item.title),
      [...FOUNDER_ACTION_TITLES],
    );
    assert.deepEqual(assertActionCompleteness(catalog), []);
    for (const action of catalog.actions) {
      for (const field of REQUIRED_ACTION_FIELDS) {
        assert.notEqual(action[field], undefined, `${action.id}.${field}`);
      }
      assert.ok(action.workflowId.startsWith("wf_"));
      assert.ok(action.allowedActions.length > 0);
      assert.ok(action.forbiddenActions.length > 0);
      assert.ok(action.success.length > 10);
      assert.ok(action.failureEscalation.length > 10);
    }
  });

  it("A: Run Daily Business Cycle button returns a founder-friendly dry-run summary", () => {
    const service = new ConsoleService();
    const result = service.runAction("run_daily_business_cycle");
    assert.equal(result.ok, true, result.reason);
    assert.match(result.founderFriendlySummary, /Daily Business Cycle/);
    assert.match(result.founderFriendlySummary, /Progressed:/);
    assert.match(result.founderFriendlySummary, /Blocked:/);
    assert.match(result.founderFriendlySummary, /Awaiting external:/);
    assert.match(result.founderFriendlySummary, /Founder required:/);
    assert.equal(result.externalWrites, 0);
    assert.equal(result.providerCalled, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.mode, "TEST");
    assert.ok(result.activity.some((item) => item.auditType === "daily_cycle"));
    assert.ok(result.lanes && result.lanes.length >= 18);
  });

  it("B: marketing+schedule prompt decomposes and stops at passes/TEST scheduling", () => {
    const service = new ConsoleService();
    const result = service.runCommand(EXACT_PROMPTS.marketing_and_schedule);
    assert.equal(result.classification.confidence, "exact");
    assert.deepEqual(result.classification.actionIds, [
      "generate_next_weeks_marketing",
      "schedule_approved_content",
    ]);
    assert.equal(result.results.length, 2);
    assert.equal(result.correlationId.length > 8, true);
    assert.equal(new Set(result.results.map((item) => item.correlationId)).size, 1);
    const generate = result.results[0]!;
    const schedule = result.results[1]!;
    assert.match(generate.founderFriendlySummary, /Taylor PASS/);
    assert.match(generate.founderFriendlySummary, /CHATGPT PASS/);
    assert.match(generate.founderFriendlySummary, /Stopped before Metricool scheduling/);
    assert.match(generate.founderFriendlySummary, /Missing exact-final passes/);
    assert.ok(generate.tasks?.some((task) => task.step === "scheduling_check" && task.status === "requested"));
    assert.ok(generate.tasks?.some((task) => task.step === "taylor_pass" && task.status === "pending"));
    assert.equal(schedule.activity[0]?.status, "requested");
    assert.notEqual(schedule.activity[0]?.status, "completed");
    assert.equal(result.externalWrites, 0);
    assert.equal(result.providerCalled, false);
  });

  it("C: progress-leads prompt is Taylor/Sam work plus exceptions", () => {
    const service = new ConsoleService();
    const result = service.runCommand(EXACT_PROMPTS.progress_leads);
    assert.equal(result.classification.confidence, "exact");
    assert.ok(result.founderFriendlySummary.includes("Taylor/Sam"));
    assert.match(result.founderFriendlySummary, /Exceptions:/);
    assert.ok(result.results.some((item) => item.exceptions && item.exceptions.length > 0));
    assert.equal(result.mode, "TEST");
    assert.equal(result.externalWrites, 0);
  });

  it("D: paid-client prompt keeps payment truth plus consent/Ready/programme gates", () => {
    const service = new ConsoleService();
    const result = service.runCommand(EXACT_PROMPTS.progress_paid);
    assert.equal(result.classification.confidence, "exact");
    assert.ok(result.classification.actionIds.includes("check_payments"));
    assert.ok(result.classification.actionIds.includes("progress_paid_clients"));
    assert.match(result.founderFriendlySummary, /payment_clear|Payment truth|TEST Stripe/i);
    assert.match(result.founderFriendlySummary, /consent/i);
    assert.match(result.founderFriendlySummary, /Ready/);
    assert.match(result.founderFriendlySummary, /founder/i);
    assert.equal(result.externalWrites, 0);
    assert.equal(result.providerCalled, false);
  });

  it("E: refund prompt creates a per-case packet and does not refund", () => {
    const service = new ConsoleService();
    const result = service.runCommand(EXACT_PROMPTS.refund);
    assert.equal(result.classification.actionIds[0], "refund_this_client");
    const packet = result.results[0]!;
    assert.ok(packet.inboxItem);
    assert.equal(packet.inboxItem?.kind, "refund_credit");
    assert.equal(packet.inboxItem?.status, "pending");
    assert.equal(packet.activity[0]?.status, "requested");
    assert.notEqual(packet.activity[0]?.status, "completed");
    assert.match(packet.founderFriendlySummary, /No refund/);
    assert.equal(packet.providerCalled, false);
    assert.equal(packet.externalWrites, 0);
    assert.ok(service.inbox().some((item) => item.kind === "refund_credit" && item.status === "pending"));
  });

  it("rejects mode spoofing from event evidence", () => {
    const service = new ConsoleService();
    assert.equal(loadPermissions().currentMode, "TEST");
    const spoofed = service.runAction("run_controlled_beta_readiness_audit", undefined, {
      operating_mode: "CONTROLLED_BETA",
      founder_stripe_live_unlock: true,
      founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
    });
    assert.equal(spoofed.mode, "TEST");
    assert.match(spoofed.founderFriendlySummary, /ignored|TEST/);
    const closedWon = service.overview().lanes.find((lane) => lane.id === "closed_won");
    assert.equal(closedWon?.outcome, "blocked");
    const trusted = new ConsoleService(withTrustedMode(loadPermissions(), "CONTROLLED_BETA"));
    assert.equal(trusted.mode(), "CONTROLLED_BETA");
    assert.equal(loadPermissions().currentMode, "TEST");
  });

  it("has no approve-all and TEST decisions never call a provider", () => {
    const service = new ConsoleService();
    assert.equal("approveAll" in service, false);
    const first = service.inbox()[0]!;
    const approved = service.decide(first.id, "approve");
    assert.equal(approved.ok, true);
    assert.equal(approved.providerCalled, false);
    assert.equal(approved.externalWrites, 0);
    assert.equal(approved.item?.status, "approved");
    const more = service.decide(service.inbox()[1]!.id, "request_evidence");
    assert.equal(more.item?.status, "more_evidence_requested");
  });

  it("never renders requested or PENDING as completed", () => {
    const service = new ConsoleService();
    service.runCommand(EXACT_PROMPTS.refund);
    service.runCommand(EXACT_PROMPTS.marketing_and_schedule);
    const pending = service.activity.filter((item) => item.status === "requested" || item.status === "pending");
    assert.ok(pending.length > 0);
    for (const item of pending) {
      assert.notEqual(item.status, "completed");
      assert.notEqual(item.status, "published");
    }
    const job = service.overview().lanes.find((lane) => lane.id === "jobs")?.items[0];
    assert.ok(job);
    assert.notEqual(job?.outcome, "progressed");
  });

  it("routes unknown commands to Alex/ChatGPT review", () => {
    const classification = classifyCommand("please invent a new policy and apply it");
    assert.equal(classification.actionIds.length, 0);
    assert.ok(classification.confidence === "unknown" || classification.confidence === "ambiguous");
    const result = new ConsoleService().runCommand("please invent a new policy and apply it");
    assert.equal(result.ok, false);
    assert.equal(result.classification.escalateTo, "Alex");
    assert.match(result.founderFriendlySummary, /Grok_Alex:/);
  });

  it("normalizes curly apostrophes in exact prompts", () => {
    const curly = "Generate next week’s marketing and schedule anything that has the required approvals.";
    assert.equal(normalizePrompt(curly), normalizePrompt(EXACT_PROMPTS.marketing_and_schedule));
    assert.equal(classifyCommand(curly).confidence, "exact");
  });

  it("routes founder wording for next-week social preparation", () => {
    const classification = classifyCommand("Prepare next week's social media and show me every blocker and owner.");
    assert.equal(classification.confidence, "keyword");
    assert.deepEqual(classification.actionIds, ["generate_next_weeks_marketing"]);
  });
});

describe("founder console HTTP smoke", () => {
  const runtime = startConsoleServer({ port: 0 });

  after(async () => {
    const started = await runtime;
    started.server.close();
  });

  it("serves API, static shell, rejects secrets, and refuses approve-all", async () => {
    const started = await runtime;
    const denied = await fetch(`${started.url}/api/mode`);
    assert.equal(denied.status, 401);
    const session = await loginFounder(started.url);
    assert.equal(session.status, 200);
    const mode = await (
      await fetch(`${started.url}/api/mode`, { headers: { cookie: session.cookie } })
    ).json();
    assert.equal(mode.mode, "TEST");
    assert.equal(mode.eventPayloadCannotPromoteMode, true);
    const home = await fetch(`${started.url}/`);
    assert.equal(home.ok, true);
    assert.match(await home.text(), /TEST/);
    const manifest = await fetch(`${started.url}/manifest.webmanifest`);
    assert.equal(manifest.ok, true);
    const sensitive = await fetch(`${started.url}/api/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi", email: "hidden@example.com" }),
    });
    assert.equal(sensitive.status, 400);
    const body = await sensitive.json();
    assert.match(body.reason, /sensitive keys rejected/);
    const approveAll = await fetch(`${started.url}/api/inbox/approve-all`, { method: "POST", body: "{}" });
    assert.equal(approveAll.status, 404);
    const daily = await fetch(`${started.url}/api/actions/run_daily_business_cycle`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ operating_mode: "CONTROLLED_BETA" }),
    });
    const dailyBody = await daily.json();
    assert.equal(dailyBody.mode, "TEST");
    assert.equal(dailyBody.externalWrites, 0);
    const usage = await (
      await fetch(`${started.url}/api/usage`, { headers: { cookie: session.cookie } })
    ).json();
    assert.equal(usage.estimatedCostUsd, null);
    assert.equal(usage.costStatus, "unknown");
    const status = await (
      await fetch(`${started.url}/api/status`, { headers: { cookie: session.cookie } })
    ).json();
    assert.equal(status.credentialsExposed, false);
    assert.ok(status.items.every((item: { credentialsExposed: boolean }) => item.credentialsExposed === false));
  });
});
