import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DispatchEngine, MemorySlackTransport } from "../src/console/dispatch.ts";
import { ConsoleService } from "../src/console/service.ts";
import { MemoryStore } from "../src/console/store.ts";
import { classifyCommand } from "../src/console/router.ts";
import {
  SOCIAL_BOUNDED_ACTIONS,
  buildChatGptSocialHandoff,
  formatChatGptSocialHandoff,
  nextWeekRange,
} from "../src/console/social-routing.ts";
import { SOCIAL_VISIBLE_STATUSES } from "../src/console/store.ts";
import { loadPermissions } from "../src/permissions.ts";
import { forbiddenKeys } from "../src/sensitive.ts";
import type { WorkerDispatch, WorkerResult } from "../src/console/cursor-v1.ts";
import type { StoredJob } from "../src/console/store.ts";

class ForbiddenChatGpt implements WorkerDispatch {
  id = "chatgpt" as const;
  configured = false;
  setupRequirement = "must not be used for social routing";
  async dispatch(): Promise<WorkerResult> {
    throw new Error("OpenAI must not be called for social routing");
  }
  async status(): Promise<WorkerResult> {
    throw new Error("OpenAI must not be called for social routing");
  }
}

class RecordingCursor implements WorkerDispatch {
  id = "cursor" as const;
  configured: boolean;
  setupRequirement = "test cursor";
  dispatched: StoredJob[] = [];
  constructor(configured = false) {
    this.configured = configured;
  }
  async dispatch(job: StoredJob): Promise<WorkerResult> {
    this.dispatched.push(job);
    return { ok: true, status: "AWAITING_EXTERNAL", detail: "cursor accepted", externalId: "bc-social-test" };
  }
  async status(): Promise<WorkerResult> {
    return { ok: true, status: "AWAITING_EXTERNAL", detail: "cursor pending", externalId: "bc-social-test" };
  }
}

function socialService(cursorConfigured = false) {
  const slack = new MemorySlackTransport();
  const store = new MemoryStore();
  const cursor = new RecordingCursor(cursorConfigured);
  const dispatch = new DispatchEngine(store, loadPermissions(), slack, cursor, new ForbiddenChatGpt(), []);
  const service = new ConsoleService(loadPermissions(), { store, dispatch });
  return { slack, store, cursor, dispatch, service };
}

describe("social routing model", () => {
  it("exposes the founder-visible social states", () => {
    assert.deepEqual([...SOCIAL_VISIBLE_STATUSES], [
      "DISPATCHED_TO_GROK",
      "CURSOR_PRODUCTION",
      "AWAITING_TAYLOR_PASS",
      "READY_FOR_CHATGPT",
      "AWAITING_CHATGPT",
      "CHATGPT_QA_PASSED",
      "METRICOOL_SCHEDULED",
      "PROVIDER_VERIFIED",
      "BLOCKED",
    ]);
  });

  it("routes Prepare next week's social media to the social cycle", () => {
    const classification = classifyCommand("Prepare next week’s social media");
    assert.deepEqual(classification.actionIds, ["generate_next_weeks_marketing"]);
  });

  it("dispatches Grok plus a complete ChatGPT handoff instead of blocking on Metricool", async () => {
    const { service, slack, store } = socialService();
    const summary = await service.prepareNextWeeksSocial();
    assert.equal(summary.correlationId.length > 0, true);
    assert.equal(summary.blocked.length, 0);
    assert.ok(summary.awaitingExternal.length >= 4);
    assert.equal(summary.founderFriendlySummary.includes("Blocked: 10"), false);
    assert.match(summary.founderFriendlySummary, /Grok_Alex: OPS_EVENT/);
    assert.match(summary.founderFriendlySummary, /CHATGPT_SOCIAL_ACTION/);
    assert.match(summary.founderFriendlySummary, /Personal ChatGPT/);

    const grok = slack.posts.find((item) => item.kind === "OPS_EVENT");
    assert.ok(grok);
    assert.equal(grok?.prefix, "Grok_Alex:");
    assert.equal(grok?.bounded_action, SOCIAL_BOUNDED_ACTIONS.grokTaylor);
    assert.equal(grok?.correlation_id, summary.correlationId);
    assert.match(grok?.briefing ?? "", /concepts, hooks and platform fit/i);
    assert.match(grok?.briefing ?? "", /duplication/i);
    assert.match(grok?.briefing ?? "", /Taylor specialist/i);
    assert.ok(grok?.evidence_refs.some((ref) => ref.includes("week:")));
    assert.ok(grok?.evidence_refs.includes("tiktok_photo_jpeg_or_webp_not_png"));

    const jobs = store.load().jobs.filter((item) => item.correlationId === summary.correlationId);
    assert.equal(new Set(jobs.map((item) => item.correlationId)).size, 1);
    assert.ok(jobs.some((job) => job.status === "DISPATCHED_TO_GROK"));
    assert.ok(jobs.some((job) => job.status === "AWAITING_TAYLOR_PASS"));
    assert.ok(jobs.some((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.chatgpt && (job.status === "AWAITING_CHATGPT" || job.status === "READY_FOR_CHATGPT")));
    assert.ok(jobs.some((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.metricool && job.status === "AWAITING_CHATGPT"));
    assert.ok(jobs.some((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.verify && job.status === "AWAITING_CHATGPT"));
    assert.equal(jobs.some((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.cursor), false);
    assert.equal(jobs.some((job) => job.status === "BLOCKED"), false);

    const chatgpt = jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.chatgpt);
    assert.ok(chatgpt?.handoff);
    const handoff = chatgpt!.handoff!;
    assert.equal(handoff.kind, "CHATGPT_SOCIAL_ACTION");
    assert.equal(handoff.correlationId, summary.correlationId);
    assert.match(handoff.weekLabel, /next week/);
    assert.ok(handoff.sopEvidenceRefs.length >= 2);
    assert.equal(handoff.taylorGrokOutput, "pending_grok_taylor");
    assert.deepEqual(handoff.targetNetworks, ["instagram", "facebook", "tiktok"]);
    assert.deepEqual(handoff.targetPostingTimes.instagram, ["08:00", "13:00", "19:00"]);
    assert.equal(handoff.taylorPassState, "pending");
    assert.ok(handoff.duplicationAudioContentChecks.length > 0);
    assert.match(handoff.aiPublicCopyControl, /AIGC|AI disclosure/i);
    assert.equal(handoff.metricoolExecutionOwner, "personal_chatgpt");
    assert.equal(handoff.consoleMetricoolApi, "not_used");
    assert.equal(forbiddenKeys(handoff).length, 0);

    assert.equal(slack.handoffs.length, 1);
    assert.equal(slack.handoffs[0]?.correlationId, summary.correlationId);
    const stored = store.load().resultEnvelopes.find((item) => item.jobId === chatgpt!.id);
    assert.match(stored?.detail ?? "", /CHATGPT_SOCIAL_ACTION/);
    assert.match(formatChatGptSocialHandoff(handoff), /target_networks=instagram,facebook,tiktok/);
  });

  it("dispatches Cursor only when a production executor is configured", async () => {
    const { service, cursor } = socialService(true);
    const summary = await service.prepareNextWeeksSocial();
    assert.equal(cursor.dispatched.length, 1);
    assert.equal(cursor.dispatched[0]?.boundedAction, SOCIAL_BOUNDED_ACTIONS.cursor);
    assert.ok(summary.awaitingExternal.some((job) => job.status === "CURSOR_PRODUCTION"));
    assert.equal(summary.blocked.length, 0);
  });

  it("ingests ChatGPT Metricool return status and closes the cycle jobs", async () => {
    const { service, dispatch, store } = socialService();
    const summary = await service.prepareNextWeeksSocial();
    const grok = store.load().jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.grokTaylor)!;
    const chatgpt = store.load().jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.chatgpt)!;
    dispatch.ingestStatus({
      kind: "OPS_STATUS",
      event_id: grok.id,
      correlation_id: summary.correlationId,
      status: "COMPLETED",
      detail: "Taylor PASS on exact-final social cycle",
    });
    dispatch.ingestStatus({
      kind: "OPS_STATUS",
      event_id: chatgpt.id,
      correlation_id: summary.correlationId,
      status: "PROVIDER_VERIFIED",
      detail: "metricool_ids=mt_1,mt_2 status=scheduled",
      executor: "ChatGPT",
    });
    const jobs = store.load().jobs.filter((job) => job.correlationId === summary.correlationId);
    assert.equal(jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.taylorPass)?.status, "COMPLETED");
    assert.equal(jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.chatgpt)?.handoff?.taylorPassState, "PASS");
    assert.equal(jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.chatgpt)?.status, "PROVIDER_VERIFIED");
    assert.equal(jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.metricool)?.status, "METRICOOL_SCHEDULED");
    assert.equal(jobs.find((job) => job.boundedAction === SOCIAL_BOUNDED_ACTIONS.verify)?.status, "PROVIDER_VERIFIED");
  });

  it("computes next week as the following Monday-Sunday range", () => {
    const week = nextWeekRange(new Date("2026-09-18T21:00:00Z"));
    assert.equal(week.start, "2026-09-21");
    assert.equal(week.end, "2026-09-27");
    const handoff = buildChatGptSocialHandoff("corr_test", week);
    assert.equal(handoff.weekStart, "2026-09-21");
    assert.equal(handoff.weekEnd, "2026-09-27");
  });
});
