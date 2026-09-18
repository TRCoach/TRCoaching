import type { BusinessEvent, EvidenceMap, Owner } from "./types.js";

export function event(
  type: string,
  actor: Owner,
  evidence: EvidenceMap,
  event_id = `evt_${type}_${Object.values(evidence)[0] ?? "x"}`,
): BusinessEvent {
  return {
    event_id: String(event_id).slice(0, 80),
    type,
    occurred_at: "2026-09-18T10:00:00Z",
    actor,
    source: "control_plane",
    evidence,
    idempotency_key: `${type}:${event_id}`,
    trace: { repo: "TRCoach/TRCoaching", task: type },
  };
}

export const SHARED = {
  campaign_ref: "CAMP-BENCH-001",
  enquiry_channel: "instagram",
  enquiry_received_at: "2026-09-18T10:00:00Z",
  non_pii_enquiry_ref: "ENQ-BENCH-001",
  classification_label: "coaching_enquiry",
  nurture_sequence_ref: "NUR-01",
  qualification_outcome: "qualified",
  offer_id: "OFF-BENCH-001",
  offer_version: "v1",
  stripe_payment_ref: "pi_test_benchmark_not_live",
  stripe_livemode: false,
  stripe_status: "succeeded",
  payment_clear_owner: "Sam",
  payment_mode: "test",
  closed_won_commercial_ref: "CW-BENCH-001",
  onboarding_pack_version: "ob-v1",
  privacy_notice_version: "privacy-final-v3",
  privacy_notice_issued_at: "2026-09-18T10:10:00Z",
  explicit_health_consent: true,
  consent_version: "consent-v1",
  consent_recorded_at: "2026-09-18T10:12:00Z",
  screening_process_version: "screen-v1.2",
  ready_human_evidence: "READY-HUMAN-001",
  ready_attested_by: "Jordan",
  screening_complete_human: true,
  programme_draft_ref: "PROG-DRAFT-001",
  founder_golive_approval: true,
  founder_decision_ref: "FD-GO-001",
  assignment_ref: "ASG-001",
  welcome_sent_ref: "WEL-001",
  checkin_week: "2026-W38",
  checkin_outcome: "completed",
  escalation_reason_code: "missed_checkin",
  escalation_resolution_code: "resumed",
  retention_window: "week_8",
  renewal_offer_ref: "REN-001",
  cancellation_reason_code: "client_request",
  founder_refund_credit_decision: "no_refund",
  offboarding_complete: true,
  money_movement: "none",
};

export function happyPathToReady(): BusinessEvent[] {
  return [
    event("start_marketing", "Taylor", { campaign_ref: SHARED.campaign_ref }),
    event("social_enquiry", "Taylor", {
      enquiry_channel: SHARED.enquiry_channel,
      enquiry_received_at: SHARED.enquiry_received_at,
      non_pii_enquiry_ref: SHARED.non_pii_enquiry_ref,
    }),
    event("classify_enquiry", "Taylor", {
      non_pii_enquiry_ref: SHARED.non_pii_enquiry_ref,
      classification_label: SHARED.classification_label,
    }),
    event("qualify_lead", "Sam", {
      non_pii_enquiry_ref: SHARED.non_pii_enquiry_ref,
      qualification_outcome: SHARED.qualification_outcome,
    }),
    event("present_offer", "Sam", { offer_id: SHARED.offer_id, offer_version: SHARED.offer_version }),
    event("payment_intent_recorded", "Sam", {
      offer_id: SHARED.offer_id,
      stripe_payment_ref: SHARED.stripe_payment_ref,
      stripe_livemode: SHARED.stripe_livemode,
    }),
    event("payment_cleared", "Sam", {
      stripe_payment_ref: SHARED.stripe_payment_ref,
      stripe_livemode: SHARED.stripe_livemode,
      stripe_status: SHARED.stripe_status,
      payment_clear_owner: SHARED.payment_clear_owner,
    }),
  ];
}
