import { forbiddenKeys } from "../sensitive.js";
import type { EvidenceMap, LifecycleTransition } from "../types.js";

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

const HUMAN_ATTESTERS = new Set(["Jordan", "Founder", "Sam", "Taylor", "Alex"]);

function flag(evidence: EvidenceMap, key: string): boolean {
  return evidence[key] === true || evidence[key] === "true";
}

export function runGuard(
  name: string,
  evidence: EvidenceMap,
  transition: LifecycleTransition,
): GuardResult {
  switch (name) {
    case "allow":
      return { ok: true };
    case "no_sensitive_payload":
      return forbiddenKeys(evidence).length === 0
        ? { ok: true }
        : { ok: false, reason: "payload contains forbidden client or Zone C fields" };
    case "no_live_payment_link":
      if (flag(evidence, "live_payment_link") || evidence.payment_link_mode === "live") {
        return { ok: false, reason: "live payment links are a hard stop" };
      }
      return { ok: true };
    case "no_live_charge":
      if (flag(evidence, "live_charge") || evidence.charge_requested === "live") {
        return { ok: false, reason: "live Stripe charges are a hard stop" };
      }
      return { ok: true };
    case "payment_clear_owner_is_sam":
      if (evidence.payment_clear_owner !== "Sam") {
        return { ok: false, reason: "payment_clear must be owned by Sam" };
      }
      if (evidence.stripe_status !== "succeeded") {
        return { ok: false, reason: "Stripe status is not succeeded" };
      }
      return { ok: true };
    case "live_closed_won_requires_livemode":
      if (evidence.payment_mode === "live" || transition.to === "closed_won") {
        if (evidence.stripe_livemode !== true && evidence.stripe_livemode !== "true") {
          return {
            ok: false,
            reason: "test-mode payment cannot become live Closed Won",
          };
        }
        if (evidence.payment_mode === "test") {
          return {
            ok: false,
            reason: "test-mode payment cannot become live Closed Won",
          };
        }
        if (evidence.stripe_status !== "succeeded") {
          return { ok: false, reason: "Closed Won requires succeeded payment evidence" };
        }
      }
      if (transition.event === "accept_renewal") {
        if (evidence.payment_mode === "test" || evidence.stripe_livemode === false) {
          return { ok: false, reason: "test-mode payment cannot become live Closed Won" };
        }
      }
      return { ok: true };
    case "privacy_notice_version_required":
      return evidence.privacy_notice_version
        ? { ok: true }
        : { ok: false, reason: "privacy notice version missing" };
    case "explicit_health_consent_required":
      if (!flag(evidence, "explicit_health_consent")) {
        return {
          ok: false,
          reason: "missing explicit health consent blocks screening/Ready",
        };
      }
      return { ok: true };
    case "human_ready_evidence_required":
      if (!flag(evidence, "explicit_health_consent")) {
        return {
          ok: false,
          reason: "missing explicit health consent blocks screening/Ready",
        };
      }
      if (!evidence.ready_human_evidence || evidence.screening_complete_human !== true) {
        return { ok: false, reason: "Ready cannot bypass human evidence" };
      }
      if (
        typeof evidence.ready_attested_by !== "string" ||
        !HUMAN_ATTESTERS.has(evidence.ready_attested_by) ||
        evidence.ready_attested_by === "Cursor" ||
        evidence.ready_attested_by === "ChatGPT" ||
        evidence.ready_attested_by === "Grok"
      ) {
        return { ok: false, reason: "Ready cannot bypass human evidence" };
      }
      return { ok: true };
    case "no_health_judgement":
      if (flag(evidence, "health_judgement") || evidence.clinical_decision) {
        return { ok: false, reason: "health/safety judgement is a hard stop" };
      }
      return { ok: true };
    case "founder_golive_required":
      if (!flag(evidence, "founder_golive_approval")) {
        return {
          ok: false,
          reason: "programme assignment blocked without founder approval",
        };
      }
      return { ok: true };
    case "publication_dual_pass": {
      const taylor = flag(evidence, "taylor_pass");
      const chatgpt = flag(evidence, "chatgpt_pass");
      const checksum = evidence.asset_checksum;
      const config = evidence.asset_config_id;
      const passChecksum = evidence.pass_checksum;
      const passConfig = evidence.pass_config_id;
      if (!taylor || !chatgpt) {
        return {
          ok: false,
          reason: "publication blocked without exact-final dual PASS",
        };
      }
      if (!checksum || !config || checksum !== passChecksum || config !== passConfig) {
        return {
          ok: false,
          reason: "publication blocked without exact-final dual PASS",
        };
      }
      return { ok: true };
    }
    case "founder_refund_credit": {
      if (flag(evidence, "automatic_refund") || flag(evidence, "automatic_credit")) {
        return { ok: false, reason: "refund/credit must remain per-case and human-only" };
      }
      const decision = evidence.founder_refund_credit_decision;
      const allowed = new Set([
        "refund_approved",
        "credit_approved",
        "no_refund",
        "no_credit",
        "decline_money_movement",
      ]);
      if (typeof decision !== "string" || !allowed.has(decision)) {
        return { ok: false, reason: "cancellation refund/credit routes to founder" };
      }
      return { ok: true };
    }
    case "offboard_without_money_movement":
      if (evidence.money_movement === "refund" || evidence.money_movement === "credit") {
        return { ok: false, reason: "cancellation refund/credit routes to founder" };
      }
      return evidence.money_movement === "none"
        ? { ok: true }
        : { ok: false, reason: "cancellation refund/credit routes to founder" };
    case "learning_proposal_only":
      if (flag(evidence, "apply_policy") || flag(evidence, "self_modify_policy")) {
        return { ok: false, reason: "agents must never self-modify policy" };
      }
      if (!evidence.proposal_version || !evidence.learning_domain) {
        return { ok: false, reason: "learning requires a versioned proposal only" };
      }
      return { ok: true };
    case "chatgpt_reviewed_learning":
      if (!flag(evidence, "chatgpt_learning_review")) {
        return { ok: false, reason: "learning proposals require ChatGPT review" };
      }
      return { ok: true };
    case "founder_sop_approval":
      if (!flag(evidence, "founder_sop_approval")) {
        return { ok: false, reason: "SOP/rule changes require founder approval" };
      }
      if (flag(evidence, "apply_policy") || flag(evidence, "self_modify_policy")) {
        return { ok: false, reason: "agents must never self-modify policy" };
      }
      return { ok: true };
    case "taylor_pass_required":
      return flag(evidence, "taylor_pass")
        ? { ok: true }
        : { ok: false, reason: "TAYLOR PASS required for this checksum/config" };
    case "weekly_cycle_dual_pass":
      return runGuard("publication_dual_pass", evidence, transition);
    default:
      return { ok: false, reason: `unknown guard ${name} fails closed` };
  }
}

export function missingEvidence(required: string[], evidence: EvidenceMap): string[] {
  return required.filter((key) => {
    const value = evidence[key];
    return value === undefined || value === null || value === "";
  });
}
