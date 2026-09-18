import { getActionByTitle, loadFounderActions } from "./actions.js";
import type { CommandClassification } from "./types.js";

export const EXACT_PROMPTS = {
  marketing_and_schedule:
    "Generate next week's marketing and schedule anything that has the required approvals.",
  progress_leads: "Progress all active leads as far as current permissions allow.",
  progress_paid:
    "Progress every paid client through onboarding and coaching as far as current permissions allow.",
  refund: "Refund this client.",
  progress_today: "Progress everything that can be progressed today.",
} as const;

export function normalizePrompt(text: string): string {
  return text
    .trim()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const EXACT_MAP: Record<string, string[]> = {
  [normalizePrompt(EXACT_PROMPTS.marketing_and_schedule)]: [
    "generate_next_weeks_marketing",
    "schedule_approved_content",
  ],
  [normalizePrompt(EXACT_PROMPTS.progress_leads)]: [
    "review_new_leads",
    "progress_sales_pipeline",
  ],
  [normalizePrompt(EXACT_PROMPTS.progress_paid)]: [
    "check_payments",
    "progress_paid_clients",
    "review_onboarding",
    "review_coaching_clients",
  ],
  [normalizePrompt(EXACT_PROMPTS.refund)]: ["refund_this_client"],
  [normalizePrompt(EXACT_PROMPTS.progress_today)]: ["progress_everything_today"],
};

export function classifyCommand(text: string): CommandClassification {
  const raw = text ?? "";
  const normalized = normalizePrompt(raw);
  if (!normalized) {
    return {
      raw,
      normalized,
      confidence: "unknown",
      actionIds: [],
      escalateTo: "Alex",
    };
  }

  const exact = EXACT_MAP[normalized];
  if (exact) {
    return { raw, normalized, confidence: "exact", actionIds: exact };
  }

  const byTitle = getActionByTitle(raw, loadFounderActions());
  if (byTitle) {
    return { raw, normalized, confidence: "exact", actionIds: [byTitle.id] };
  }

  const hits: string[] = [];
  if (/refund|credit/.test(normalized)) hits.push("refund_this_client");
  if (/daily business cycle/.test(normalized)) hits.push("run_daily_business_cycle");
  if (
    /next week'?s.*(?:marketing|social(?: media)?|content)/.test(normalized)
    || /(?:marketing|social(?: media)?|content).*next week/.test(normalized)
    || /generate.*marketing/.test(normalized)
  ) {
    hits.push("generate_next_weeks_marketing");
  }
  if (/schedule/.test(normalized) && /approv/.test(normalized)) {
    hits.push("schedule_approved_content");
  }
  if (/active leads|new leads/.test(normalized)) hits.push("review_new_leads");
  if (/sales pipeline|progress.*leads/.test(normalized)) hits.push("progress_sales_pipeline");
  if (/paid client|onboarding and coaching/.test(normalized)) {
    hits.push("check_payments", "progress_paid_clients");
  }
  if (/ceo brief/.test(normalized)) hits.push("generate_weekly_ceo_brief");
  if (/health check/.test(normalized) && !/health\/safety|clinical/.test(normalized)) {
    hits.push("run_full_business_health_check");
  }
  if (/controlled-?beta readiness|readiness audit/.test(normalized)) {
    hits.push("run_controlled_beta_readiness_audit");
  }
  if (/publication error/.test(normalized)) hits.push("check_publication_errors");
  if (/founder decision/.test(normalized)) hits.push("show_founder_decisions");
  if (/progress everything that can be progressed today/.test(normalized)) {
    hits.push("progress_everything_today");
  }

  const unique = [...new Set(hits)];
  if (unique.length === 1) {
    return { raw, normalized, confidence: "keyword", actionIds: unique };
  }
  if (unique.length > 1) {
    return { raw, normalized, confidence: "keyword", actionIds: unique };
  }
  return {
    raw,
    normalized,
    confidence: normalized.split(" ").length < 3 ? "ambiguous" : "unknown",
    actionIds: [],
    escalateTo: "Alex",
  };
}
