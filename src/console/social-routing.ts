import { newId } from "./ids.js";
import type { ChatGptSocialHandoff, DispatchStatus, StoredJob, StoreData } from "./store.js";

export const SOCIAL_PARENT_ACTION = "prepare_next_weeks_social_media";

export const SOCIAL_BOUNDED_ACTIONS = {
  grokTaylor: "grok_taylor_social_cycle",
  taylorPass: "taylor_specialist_review",
  cursor: "produce_and_technical_qa_next_week_social_assets",
  chatgpt: "CHATGPT_SOCIAL_ACTION",
  metricool: "metricool_schedule_via_personal_chatgpt",
  verify: "verify_metricool_via_personal_chatgpt",
} as const;

export const SOCIAL_RULE_REFS = [
  "no_back_to_back_audio_hooks_or_core_treatment",
  "tiktok_photo_jpeg_or_webp_not_png",
  "accurate_ai_aigc_disclosure",
  "no_text_overlap",
  "instagram_0800_1300_1900",
  "facebook_1000_1200_1800",
  "tiktok_1000_1200_1800",
  "exact_final_taylor_and_chatgpt_pass",
] as const;

export const SOCIAL_SOP_REFS = [
  "CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST",
  "AI Coaching Company — Operating System (Master)",
] as const;

export interface WeekRange {
  start: string;
  end: string;
  label: string;
}

export interface SocialPlanStep {
  id: string;
  lane: "marketing";
  owner: string;
  executor: "Slack" | "Cursor" | "ChatGPT" | "control_plane";
  boundedAction: string;
  permitted: boolean;
  founderGate: boolean;
  reason: string;
  nextTrigger: string;
  evidenceRefs: string[];
  initialStatus?: DispatchStatus;
  skipExecutorCall?: boolean;
  visibleOnDispatch?: DispatchStatus;
  briefing?: string;
  handoff?: ChatGptSocialHandoff;
}

export function nextWeekRange(now = new Date()): WeekRange {
  const utcDay = now.getUTCDay();
  const daysUntilMonday = utcDay === 1 ? 7 : (8 - utcDay) % 7 || 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);
  return {
    start: startIso,
    end: endIso,
    label: `next week ${startIso} to ${endIso}`,
  };
}

export function buildChatGptSocialHandoff(correlationId: string, week = nextWeekRange()): ChatGptSocialHandoff {
  return {
    kind: "CHATGPT_SOCIAL_ACTION",
    correlationId,
    weekStart: week.start,
    weekEnd: week.end,
    weekLabel: week.label,
    sopEvidenceRefs: [...SOCIAL_SOP_REFS],
    taylorGrokOutput: "pending_grok_taylor",
    finalCaptions: [],
    finalMediaAssetRefs: [],
    targetNetworks: ["instagram", "facebook", "tiktok"],
    targetPostingTimes: {
      instagram: ["08:00", "13:00", "19:00"],
      facebook: ["10:00", "12:00", "18:00"],
      tiktok: ["10:00", "12:00", "18:00"],
    },
    technicalQa: "pending_cursor_or_personal_chatgpt",
    taylorPassState: "pending",
    duplicationAudioContentChecks: [
      "no_back_to_back_audio_hooks_or_core_treatment",
      "prior_content_duplication_check",
      "hook_and_treatment_uniqueness",
    ],
    aiPublicCopyControl:
      "No AI-public-copy without accurate AIGC/AI disclosure. Personal ChatGPT applies native network disclosure where required. Console does not publish copy.",
    metricoolExecutionOwner: "personal_chatgpt",
    consoleMetricoolApi: "not_used",
    independentExactFinalQaOwner: "personal_chatgpt",
    nativeAiDisclosureOwner: "personal_chatgpt",
    providerReadbackOwner: "personal_chatgpt",
    returnFields: [
      "taylor_pass_state",
      "chatgpt_qa_result",
      "metricool_ids",
      "metricool_status",
      "provider_verified_readback",
    ],
  };
}

export function grokTaylorBriefing(week: WeekRange, correlationId: string): string {
  return [
    "SOCIAL CYCLE BRIEFING",
    `correlation_id=${correlationId}`,
    `week=${week.label}`,
    "Interpret current approved marketing/offer/SOP titles. Drive remains the policy source of truth; titles only.",
    "Propose concepts, hooks and platform fit for Instagram, Facebook and TikTok.",
    "State creative requirements: no text overlap; TikTok photo JPEG/WebP not PNG; no publication.",
    "Run prior-content duplication plus back-to-back audio/hook/core-treatment checks.",
    "Taylor specialist exact-final review. Return PASS/FAIL on the exact final asset/copy/config.",
    "Do not call Metricool. Personal ChatGPT owns Metricool QA, upload, schedule, disclosure and read-back.",
  ].join("\n");
}

export function formatChatGptSocialHandoff(handoff: ChatGptSocialHandoff): string {
  return [
    "CHATGPT_SOCIAL_ACTION",
    `correlation_id=${handoff.correlationId}`,
    `week=${handoff.weekLabel}`,
    `week_start=${handoff.weekStart}`,
    `week_end=${handoff.weekEnd}`,
    `sop_evidence_refs=${handoff.sopEvidenceRefs.join(" | ")}`,
    `taylor_grok_output=${handoff.taylorGrokOutput}`,
    `final_captions=${handoff.finalCaptions.join(" | ") || "pending"}`,
    `final_media_asset_refs=${handoff.finalMediaAssetRefs.join(",") || "pending"}`,
    `target_networks=${handoff.targetNetworks.join(",")}`,
    `instagram_times=${handoff.targetPostingTimes.instagram.join(",")}`,
    `facebook_times=${handoff.targetPostingTimes.facebook.join(",")}`,
    `tiktok_times=${handoff.targetPostingTimes.tiktok.join(",")}`,
    `technical_qa=${handoff.technicalQa}`,
    `taylor_pass_state=${handoff.taylorPassState}`,
    `duplication_audio_content_checks=${handoff.duplicationAudioContentChecks.join(",")}`,
    `ai_public_copy_control=${handoff.aiPublicCopyControl}`,
    "metricool_execution_owner=personal_chatgpt",
    "console_metricool_api=not_used",
    "independent_exact_final_qa=personal_chatgpt",
    "native_ai_disclosure=personal_chatgpt",
    "provider_readback=personal_chatgpt",
    `return_fields=${handoff.returnFields.join(",")}`,
    "no_client_personal_data=true",
    "no_restricted_health_detail=true",
  ].join("\n");
}

export function socialEvidenceRefs(week: WeekRange): string[] {
  return [`week:${week.start}/${week.end}`, ...SOCIAL_SOP_REFS, ...SOCIAL_RULE_REFS];
}

export function buildSocialCyclePlan(input: {
  correlationId: string;
  slackConfigured: boolean;
  cursorConfigured: boolean;
  now?: Date;
}): { plan: SocialPlanStep[]; handoff: ChatGptSocialHandoff; week: WeekRange } {
  const week = nextWeekRange(input.now);
  const handoff = buildChatGptSocialHandoff(input.correlationId, week);
  const evidenceRefs = socialEvidenceRefs(week);
  const plan: SocialPlanStep[] = [
    {
      id: newId("evt"),
      lane: "marketing",
      owner: "Taylor",
      executor: "Slack",
      boundedAction: SOCIAL_BOUNDED_ACTIONS.grokTaylor,
      permitted: input.slackConfigured,
      founderGate: false,
      reason: input.slackConfigured
        ? "Dispatch Grok_Alex: OPS_EVENT for SOP interpretation, concepts/hooks, creative, duplication checks and Taylor review."
        : "Slack/Grok-Alex is NOT_CONNECTED. The Grok/Taylor social briefing was not sent.",
      nextTrigger: "OPS_STATUS",
      evidenceRefs,
      visibleOnDispatch: "DISPATCHED_TO_GROK",
      briefing: grokTaylorBriefing(week, input.correlationId),
    },
    {
      id: newId("evt"),
      lane: "marketing",
      owner: "Taylor",
      executor: "control_plane",
      boundedAction: SOCIAL_BOUNDED_ACTIONS.taylorPass,
      permitted: input.slackConfigured,
      founderGate: false,
      reason: input.slackConfigured
        ? "Taylor specialist review is in flight via the Grok/Slack social cycle. Not blocked on a Console Metricool adapter."
        : "Taylor review cannot start until the Grok_Alex OPS_EVENT is dispatched.",
      nextTrigger: "CHATGPT_SOCIAL_ACTION",
      evidenceRefs: ["taylor_pass", ...evidenceRefs],
      skipExecutorCall: true,
      initialStatus: input.slackConfigured ? "AWAITING_TAYLOR_PASS" : "BLOCKED",
    },
    {
      id: newId("evt"),
      lane: "marketing",
      owner: "ChatGPT",
      executor: "ChatGPT",
      boundedAction: SOCIAL_BOUNDED_ACTIONS.chatgpt,
      permitted: true,
      founderGate: false,
      reason:
        "Personal ChatGPT handoff stored for independent exact-final QA and Metricool execution. Missing Console Metricool/OpenAI APIs do not block this job.",
      nextTrigger: "metricool_schedule_via_personal_chatgpt",
      evidenceRefs: ["chatgpt_social_handoff", ...evidenceRefs],
      skipExecutorCall: true,
      initialStatus: "READY_FOR_CHATGPT",
      visibleOnDispatch: "AWAITING_CHATGPT",
      handoff,
    },
    {
      id: newId("evt"),
      lane: "marketing",
      owner: "ChatGPT",
      executor: "ChatGPT",
      boundedAction: SOCIAL_BOUNDED_ACTIONS.metricool,
      permitted: true,
      founderGate: false,
      reason:
        "Metricool upload/update/schedule stays with Personal ChatGPT through its existing Metricool integration. No Console Metricool API.",
      nextTrigger: "verify_metricool_via_personal_chatgpt",
      evidenceRefs: ["metricool_personal_chatgpt", ...evidenceRefs],
      skipExecutorCall: true,
      initialStatus: "AWAITING_CHATGPT",
    },
    {
      id: newId("evt"),
      lane: "marketing",
      owner: "ChatGPT",
      executor: "ChatGPT",
      boundedAction: SOCIAL_BOUNDED_ACTIONS.verify,
      permitted: true,
      founderGate: false,
      reason:
        "Provider read-back and Metricool IDs are returned by Personal ChatGPT. Console ingests that status and closes the cycle.",
      nextTrigger: "monitor_publication",
      evidenceRefs: ["metricool_provider_id", ...evidenceRefs],
      skipExecutorCall: true,
      initialStatus: "AWAITING_CHATGPT",
    },
  ];
  if (input.cursorConfigured) {
    plan.splice(2, 0, {
      id: newId("evt"),
      lane: "marketing",
      owner: "Cursor",
      executor: "Cursor",
      boundedAction: SOCIAL_BOUNDED_ACTIONS.cursor,
      permitted: true,
      founderGate: false,
      reason: "Bounded production, rendering and technical QA only. No provider writes, publishing or paid spend.",
      nextTrigger: "taylor_specialist_review",
      evidenceRefs,
      visibleOnDispatch: "CURSOR_PRODUCTION",
    });
  }
  return { plan, handoff, week };
}

export function applySocialCycleIngest(data: StoreData, job: StoredJob, status: DispatchStatus, detail: string): void {
  const correlation = data.correlations.find((item) => item.id === job.correlationId);
  if (correlation?.parentAction !== SOCIAL_PARENT_ACTION) return;
  const siblings = data.jobs.filter((item) => item.correlationId === job.correlationId);
  const find = (boundedAction: string) => siblings.find((item) => item.boundedAction === boundedAction);
  const chatgpt = find(SOCIAL_BOUNDED_ACTIONS.chatgpt);
  const patchHandoff = (patch: Partial<ChatGptSocialHandoff>) => {
    if (!chatgpt) return;
    chatgpt.handoff = { ...(chatgpt.handoff ?? buildChatGptSocialHandoff(job.correlationId)), ...patch };
  };

  if (job.boundedAction === SOCIAL_BOUNDED_ACTIONS.grokTaylor && (status === "COMPLETED" || status === "AWAITING_TAYLOR_PASS")) {
    const taylor = find(SOCIAL_BOUNDED_ACTIONS.taylorPass);
    if (taylor && status === "COMPLETED") {
      taylor.status = "COMPLETED";
      taylor.resultSummary = detail || "Taylor/Grok social cycle returned.";
      taylor.updatedAt = new Date().toISOString();
    }
    patchHandoff({
      taylorGrokOutput: detail || chatgpt?.handoff?.taylorGrokOutput || "pending_grok_taylor",
      taylorPassState: /\bPASS\b/i.test(detail) ? "PASS" : /\bFAIL\b/i.test(detail) ? "FAIL" : chatgpt?.handoff?.taylorPassState ?? "pending",
    });
  }

  if (status === "CHATGPT_QA_PASSED") {
    const target = find(SOCIAL_BOUNDED_ACTIONS.chatgpt);
    if (target) {
      target.status = "CHATGPT_QA_PASSED";
      target.resultSummary = detail || "Personal ChatGPT exact-final QA passed.";
      target.updatedAt = new Date().toISOString();
    }
  }
  if (status === "METRICOOL_SCHEDULED") {
    const target = find(SOCIAL_BOUNDED_ACTIONS.metricool);
    if (target) {
      target.status = "METRICOOL_SCHEDULED";
      target.resultSummary = detail || "Personal ChatGPT scheduled in Metricool.";
      target.updatedAt = new Date().toISOString();
    }
  }
  if (status === "PROVIDER_VERIFIED") {
    const verify = find(SOCIAL_BOUNDED_ACTIONS.verify);
    if (verify) {
      verify.status = "PROVIDER_VERIFIED";
      verify.resultSummary = detail || "Personal ChatGPT returned provider-verified Metricool IDs.";
      verify.updatedAt = new Date().toISOString();
    }
    const schedule = find(SOCIAL_BOUNDED_ACTIONS.metricool);
    if (schedule && schedule.status === "AWAITING_CHATGPT") {
      schedule.status = "METRICOOL_SCHEDULED";
      schedule.updatedAt = new Date().toISOString();
    }
    if (chatgpt && (chatgpt.status === "AWAITING_CHATGPT" || chatgpt.status === "READY_FOR_CHATGPT")) {
      chatgpt.status = "CHATGPT_QA_PASSED";
      chatgpt.updatedAt = new Date().toISOString();
    }
  }
}

export function socialFounderSummary(input: {
  mode: string;
  correlationId: string;
  weekLabel: string;
  progressed: number;
  stillRunning: number;
  awaitingExternal: number;
  blocked: number;
  founderRequired: number;
  grokDispatched: boolean;
  cursorDispatched: boolean;
  chatgptReady: boolean;
}): string {
  return [
    `Prepare next week's social media — trusted mode ${input.mode}.`,
    `Correlation ${input.correlationId} covers ${input.weekLabel}.`,
    input.grokDispatched
      ? "Grok/Taylor: real Grok_Alex: OPS_EVENT dispatched."
      : "Grok/Taylor: Slack OPS_EVENT was not sent.",
    input.cursorDispatched
      ? "Cursor: bounded production/technical-QA dispatched."
      : "Cursor: omitted because no bounded production executor is configured.",
    input.chatgptReady
      ? "ChatGPT: CHATGPT_SOCIAL_ACTION handoff stored for Personal ChatGPT. Classified READY_FOR_CHATGPT/AWAITING_CHATGPT, not blocked on a Console Metricool API."
      : "ChatGPT handoff was not stored.",
    "Metricool execution stays with Personal ChatGPT. Console Metricool API was not used.",
    `Progressed: ${input.progressed}. Still running: ${input.stillRunning}. Awaiting external: ${input.awaitingExternal}. Blocked: ${input.blocked}. Founder required: ${input.founderRequired}.`,
    "Unauthorized business writes: 0.",
  ].join(" ");
}
