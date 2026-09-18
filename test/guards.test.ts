import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { event, happyPathToReady, SHARED } from "../src/events.ts";
import { loadLifecycle, StateEngine } from "../src/engine/state-engine.ts";
import type { BusinessEvent, EvidenceMap } from "../src/types.ts";

function engine() {
  return new StateEngine(loadLifecycle());
}

function mustApply(target: StateEngine, events: BusinessEvent[]) {
  for (const item of events) {
    const result = target.apply(item);
    assert.equal(result.status, "applied", `${item.type}: ${result.reason}`);
  }
}

function liveWonEvidence(): EvidenceMap {
  return {
    ...SHARED,
    stripe_livemode: true,
    payment_mode: "live",
  };
}

function toPaymentVerified(target: StateEngine) {
  mustApply(target, happyPathToReady());
}

function toClosedWon(target: StateEngine) {
  toPaymentVerified(target);
  mustApply(target, [
    event("mark_closed_won", "Sam", {
      stripe_payment_ref: SHARED.stripe_payment_ref,
      stripe_livemode: true,
      stripe_status: "succeeded",
      closed_won_commercial_ref: SHARED.closed_won_commercial_ref,
      payment_mode: "live",
    }),
  ]);
}

function toScreeningReadyPath(target: StateEngine, extra: EvidenceMap = {}) {
  toClosedWon(target);
  const ev = { ...liveWonEvidence(), ...extra };
  mustApply(target, [
    event("start_onboarding", "Jordan", {
      closed_won_commercial_ref: ev.closed_won_commercial_ref,
      onboarding_pack_version: ev.onboarding_pack_version,
    }),
    event("issue_privacy_notice", "Jordan", {
      privacy_notice_version: ev.privacy_notice_version,
      privacy_notice_issued_at: ev.privacy_notice_issued_at,
      closed_won_commercial_ref: ev.closed_won_commercial_ref,
    }),
  ]);
}

describe("fail-closed guards", () => {
  it("rejects test-mode payment becoming live Closed Won", () => {
    const target = engine();
    toPaymentVerified(target);
    const result = target.apply(
      event("mark_closed_won", "Sam", {
        stripe_payment_ref: SHARED.stripe_payment_ref,
        stripe_livemode: false,
        stripe_status: "succeeded",
        closed_won_commercial_ref: SHARED.closed_won_commercial_ref,
        payment_mode: "test",
      }),
    );
    assert.equal(result.status, "rejected");
    assert.match(result.reason ?? "", /test-mode payment cannot become live Closed Won/);
    assert.equal(target.state.current, "payment_verified");
  });

  it("blocks screening and Ready without explicit health consent", () => {
    const target = engine();
    toScreeningReadyPath(target);
    const noConsent = target.apply(
      event("record_explicit_health_consent", "Jordan", {
        explicit_health_consent: false,
        consent_version: "consent-v1",
        consent_recorded_at: "2026-09-18T10:12:00Z",
      }),
    );
    assert.equal(noConsent.status, "rejected");
    assert.match(noConsent.reason ?? "", /missing explicit health consent/);

    mustApply(target, [
      event("record_explicit_health_consent", "Jordan", {
        explicit_health_consent: true,
        consent_version: "consent-v1",
        consent_recorded_at: "2026-09-18T10:12:00Z",
      }),
    ]);
    target.state.evidence.explicit_health_consent = false;
    const screening = target.apply(
      event("start_screening", "Jordan", {
        explicit_health_consent: false,
        screening_process_version: "screen-v1.2",
      }),
    );
    assert.equal(screening.status, "rejected");
  });

  it("rejects Ready that bypasses human evidence", () => {
    const target = engine();
    toScreeningReadyPath(target);
    mustApply(target, [
      event("record_explicit_health_consent", "Jordan", {
        explicit_health_consent: true,
        consent_version: "consent-v1",
        consent_recorded_at: "2026-09-18T10:12:00Z",
      }),
      event("start_screening", "Jordan", {
        explicit_health_consent: true,
        screening_process_version: "screen-v1.2",
      }),
    ]);
    const automated = target.apply(
      event("human_ready", "Cursor", {
        explicit_health_consent: true,
        ready_human_evidence: "AUTO-READY-NOT-HUMAN",
        ready_attested_by: "Cursor",
        screening_complete_human: true,
      }),
    );
    assert.equal(automated.status, "rejected");
    assert.match(automated.reason ?? "", /Ready cannot bypass human evidence/);
  });

  it("blocks programme assignment without founder approval", () => {
    const target = engine();
    toScreeningReadyPath(target);
    mustApply(target, [
      event("record_explicit_health_consent", "Jordan", {
        explicit_health_consent: true,
        consent_version: "consent-v1",
        consent_recorded_at: "2026-09-18T10:12:00Z",
      }),
      event("start_screening", "Jordan", {
        explicit_health_consent: true,
        screening_process_version: "screen-v1.2",
      }),
      event("human_ready", "Jordan", {
        explicit_health_consent: true,
        ready_human_evidence: "READY-HUMAN-001",
        ready_attested_by: "Jordan",
        screening_complete_human: true,
      }),
      event("draft_programme", "Jordan", {
        programme_draft_ref: "PROG-DRAFT-001",
        ready_human_evidence: "READY-HUMAN-001",
        ready_attested_by: "Jordan",
        screening_complete_human: true,
        explicit_health_consent: true,
      }),
    ]);
    const result = target.apply(
      event("founder_approve_golive", "Founder", {
        programme_draft_ref: "PROG-DRAFT-001",
        founder_golive_approval: false,
        founder_decision_ref: "FD-NO",
      }),
    );
    assert.equal(result.status, "rejected");
    assert.match(result.reason ?? "", /programme assignment blocked without founder approval/);
  });

  it("blocks publication without exact-final dual PASS", () => {
    const target = engine();
    mustApply(target, [
      event("start_marketing", "Taylor", { campaign_ref: SHARED.campaign_ref }),
      event("social_asset_drafted", "Taylor", {
        asset_checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        asset_config_id: "scene-benchmark-v1",
      }),
      event("social_qa_completed", "ChatGPT", {
        asset_checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        asset_config_id: "scene-benchmark-v1",
        qa_report_ref: "qa-bench-1",
      }),
    ]);
    const missingPass = target.apply(
      event("request_publication", "Taylor", {
        asset_checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        asset_config_id: "scene-benchmark-v1",
        taylor_pass: false,
        chatgpt_pass: false,
      }),
    );
    assert.equal(missingPass.status, "rejected");
    assert.match(missingPass.reason ?? "", /publication blocked without exact-final dual PASS/);

    const mismatched = target.apply(
      event("request_publication", "Taylor", {
        asset_checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        asset_config_id: "scene-benchmark-v1",
        taylor_pass: true,
        chatgpt_pass: true,
        pass_checksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        pass_config_id: "other-config",
      }),
    );
    assert.equal(mismatched.status, "rejected");
  });

  it("routes cancellation refund/credit to founder", () => {
    const target = engine();
    toClosedWon(target);
    mustApply(target, [
      event("start_onboarding", "Jordan", {
        closed_won_commercial_ref: SHARED.closed_won_commercial_ref,
        onboarding_pack_version: SHARED.onboarding_pack_version,
      }),
      event("request_cancellation", "Jordan", {
        closed_won_commercial_ref: SHARED.closed_won_commercial_ref,
        cancellation_reason_code: "client_request",
      }),
    ]);
    const autoRefund = target.apply(
      event("complete_offboarding", "Jordan", {
        cancellation_reason_code: "client_request",
        offboarding_complete: true,
        money_movement: "refund",
      }),
    );
    assert.equal(autoRefund.status, "rejected");
    assert.match(autoRefund.reason ?? "", /cancellation refund\/credit routes to founder/);

    const founder = target.apply(
      event("founder_refund_credit_decision", "Founder", {
        cancellation_reason_code: "client_request",
        founder_refund_credit_decision: "refund_approved",
        founder_decision_ref: "FD-REF-1",
        closed_won_commercial_ref: SHARED.closed_won_commercial_ref,
      }),
    );
    assert.equal(founder.status, "applied");
    assert.equal(founder.founderGate, true);
    assert.equal(founder.nextTrigger, "complete_offboarding");
  });
});
