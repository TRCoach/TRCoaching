import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { event } from "../src/events.ts";
import { loadLifecycle, StateEngine } from "../src/engine/state-engine.ts";
import { wakeFor } from "../src/engine/wake.ts";
import { loadPermissions, permissionAllowed } from "../src/permissions.ts";

function engine() {
  return new StateEngine(loadLifecycle());
}

describe("continuous learning and permissions", () => {
  it("records sales, coaching, and marketing learning as versioned proposals only", () => {
    const target = engine();
    const sales = target.apply(
      event("propose_sales_learning", "Sam", {
        proposal_version: "sop-sales-v1",
        learning_domain: "sales",
        source_refs: "conversations,objections,conversions",
        apply_policy: false,
      }),
    );
    assert.equal(sales.status, "applied", sales.reason);
    assert.equal(target.state.current, "uninitialized");
    assert.equal(target.state.tracks.learning, "learning_proposal");
  });

  it("rejects agent self-modification of policy", () => {
    const target = engine();
    const result = target.apply(
      event("propose_coaching_learning", "Jordan", {
        proposal_version: "sop-coach-v1",
        learning_domain: "coaching",
        source_refs: "adherence,check-ins,programme,retention",
        apply_policy: true,
      }),
    );
    assert.equal(result.status, "rejected");
    assert.match(result.reason ?? "", /never self-modify policy/);
    assert.equal(permissionAllowed(loadPermissions(), "policy_self_modify").ok, false);
  });

  it("requires ChatGPT review then founder SOP approval", () => {
    const target = engine();
    assert.equal(
      target.apply(
        event("propose_marketing_learning", "Taylor", {
          proposal_version: "sop-mkt-v1",
          learning_domain: "marketing",
          source_refs: "performance,lead_quality,sales_feedback",
        }),
      ).status,
      "applied",
    );
    const unreviewed = target.apply(
      event("review_learning_proposal", "ChatGPT", {
        proposal_version: "sop-mkt-v1",
        chatgpt_learning_review: false,
      }),
    );
    assert.equal(unreviewed.status, "rejected");
    assert.equal(
      target.apply(
        event("review_learning_proposal", "ChatGPT", {
          proposal_version: "sop-mkt-v1",
          chatgpt_learning_review: true,
        }),
      ).status,
      "applied",
    );
    const noFounder = target.apply(
      event("founder_approve_sop_change", "Founder", {
        proposal_version: "sop-mkt-v1",
        founder_sop_approval: false,
        founder_decision_ref: "FD-SOP-NO",
      }),
    );
    assert.equal(noFounder.status, "rejected");
    const approved = target.apply(
      event("founder_approve_sop_change", "Founder", {
        proposal_version: "sop-mkt-v1",
        founder_sop_approval: true,
        founder_decision_ref: "FD-SOP-1",
      }),
    );
    assert.equal(approved.status, "applied");
    assert.equal(approved.founderGate, true);
  });

  it("walks weekly marketing cycle and blocks Metricool schedule in TEST", () => {
    const target = engine();
    const checksum = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const steps = [
      event("analyse_marketing_cycle", "Taylor", { cycle_week: "2026-W38", performance_summary_ref: "perf-1" }),
      event("generate_marketing_cycle", "Taylor", { cycle_week: "2026-W38", draft_concept_ref: "concept-1" }),
      event("produce_marketing_cycle", "Cursor", {
        cycle_week: "2026-W38",
        asset_checksum: checksum,
        asset_config_id: "scene-benchmark-v1",
      }),
      event("qa_marketing_cycle", "ChatGPT", {
        asset_checksum: checksum,
        asset_config_id: "scene-benchmark-v1",
        qa_report_ref: "qa-cycle-1",
      }),
      event("taylor_pass_marketing_cycle", "Taylor", {
        asset_checksum: checksum,
        asset_config_id: "scene-benchmark-v1",
        taylor_pass: true,
      }),
      event("chatgpt_pass_marketing_cycle", "ChatGPT", {
        asset_checksum: checksum,
        asset_config_id: "scene-benchmark-v1",
        taylor_pass: true,
        chatgpt_pass: true,
        pass_checksum: checksum,
        pass_config_id: "scene-benchmark-v1",
      }),
    ];
    for (const item of steps) {
      const result = target.apply(item);
      assert.equal(result.status, "applied", `${item.type}: ${result.reason}`);
    }
    const scheduled = target.apply(
      event("schedule_marketing_cycle", "Taylor", {
        asset_checksum: checksum,
        asset_config_id: "scene-benchmark-v1",
        taylor_pass: true,
        chatgpt_pass: true,
        pass_checksum: checksum,
        pass_config_id: "scene-benchmark-v1",
      }),
    );
    assert.equal(scheduled.status, "rejected");
    assert.match(scheduled.reason ?? "", /metricool_schedule blocked in TEST/);
    assert.equal(target.state.tracks.marketing_cycle, "marketing_cycle_chatgpt_pass");
  });

  it("documents founder unlocks and TEST default mode", () => {
    const registry = loadPermissions();
    assert.equal(registry.currentMode, "TEST");
    assert.equal(registry.betaTarget, "2026-09-25");
    const needed = [
      "payments",
      "sales_messaging",
      "onboarding",
      "routine_coaching_communications",
      "programme_assignment_golive",
      "refunds_credits",
      "privacy_legal_exceptions",
      "irreversible_security_account",
    ];
    for (const capability of needed) {
      const unlock = registry.unlocks.find((item) => item.capability === capability);
      assert.ok(unlock, capability);
      assert.ok(unlock!.founderUnlock.length > 10);
      assert.equal(permissionAllowed(registry, capability).ok, false);
    }
  });

  it("allows CONTROLLED_BETA paying clients only with named founder Stripe-live unlock", () => {
    const registry = loadPermissions();
    const payments = registry.unlocks.find((item) => item.capability === "payments")!;
    assert.deepEqual(payments.allowedIn, ["CONTROLLED_BETA", "LIVE"]);
    assert.equal(payments.separateFromWholeBusinessLive, true);
    assert.equal(payments.paymentClearOwner, "Sam");
    const unlockEvidence = {
      founder_stripe_live_unlock: true,
      founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
      payment_clear_owner: "Sam",
    };
    assert.equal(permissionAllowed(registry, "payments", "TEST", unlockEvidence).ok, false);
    assert.equal(permissionAllowed(registry, "payments", "CONTROLLED_BETA").ok, false);
    const beta = permissionAllowed(registry, "payments", "CONTROLLED_BETA", unlockEvidence);
    assert.equal(beta.ok, true, beta.reason);
    const live = permissionAllowed(registry, "payments", "LIVE", unlockEvidence);
    assert.equal(live.ok, true, live.reason);
    assert.notEqual(registry.currentMode, "LIVE");
  });

  it("allows per-case founder refund/credit in CONTROLLED_BETA and LIVE, never automatic", () => {
    const registry = loadPermissions();
    const refunds = registry.unlocks.find((item) => item.capability === "refunds_credits")!;
    assert.deepEqual(refunds.allowedIn, ["CONTROLLED_BETA", "LIVE"]);
    assert.equal(refunds.neverAutomatic, true);
    assert.equal(refunds.perCase, true);
    const decision = {
      founder_refund_credit_decision: "refund_approved",
      founder_decision_ref: "FD-REF-BETA",
    };
    assert.equal(permissionAllowed(registry, "refunds_credits", "TEST", decision).ok, false);
    assert.equal(permissionAllowed(registry, "refunds_credits", "CONTROLLED_BETA").ok, false);
    assert.equal(
      permissionAllowed(registry, "refunds_credits", "CONTROLLED_BETA", {
        ...decision,
        automatic_refund: true,
      }).ok,
      false,
    );
    assert.equal(permissionAllowed(registry, "refunds_credits", "CONTROLLED_BETA", decision).ok, true);
    assert.equal(permissionAllowed(registry, "refunds_credits", "LIVE", decision).ok, true);
  });

  it("rejects live Closed Won in TEST even with founder payment unlock evidence", () => {
    const target = engine();
    const start = [
      event("start_marketing", "Taylor", { campaign_ref: "CAMP-PAY-1" }),
      event("social_enquiry", "Taylor", {
        enquiry_channel: "instagram",
        enquiry_received_at: "2026-09-18T10:00:00Z",
        non_pii_enquiry_ref: "ENQ-PAY-1",
      }),
      event("classify_enquiry", "Taylor", {
        non_pii_enquiry_ref: "ENQ-PAY-1",
        classification_label: "coaching_enquiry",
      }),
      event("qualify_lead", "Sam", {
        non_pii_enquiry_ref: "ENQ-PAY-1",
        qualification_outcome: "qualified",
      }),
      event("present_offer", "Sam", { offer_id: "OFF-PAY-1", offer_version: "v1" }),
      event("payment_intent_recorded", "Sam", {
        offer_id: "OFF-PAY-1",
        stripe_payment_ref: "pi_test_pay",
        stripe_livemode: true,
      }),
      event("payment_cleared", "Sam", {
        stripe_payment_ref: "pi_test_pay",
        stripe_livemode: true,
        stripe_status: "succeeded",
        payment_clear_owner: "Sam",
      }),
    ];
    for (const item of start) {
      assert.equal(target.apply(item).status, "applied", item.type);
    }
    const blocked = target.apply(
      event("mark_closed_won", "Sam", {
        stripe_payment_ref: "pi_test_pay",
        stripe_livemode: true,
        stripe_status: "succeeded",
        closed_won_commercial_ref: "CW-PAY-1",
        payment_mode: "live",
        founder_stripe_live_unlock: true,
        founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
        payment_clear_owner: "Sam",
      }),
    );
    assert.equal(blocked.status, "rejected");
    assert.match(blocked.reason ?? "", /payments blocked in TEST/);
    const founding = target.apply(
      event("mark_closed_won", "Sam", {
        stripe_payment_ref: "pi_test_pay",
        stripe_livemode: true,
        stripe_status: "succeeded",
        closed_won_commercial_ref: "CW-PAY-1",
        payment_mode: "live",
        operating_mode: "CONTROLLED_BETA",
        founder_stripe_live_unlock: true,
        founder_payment_unlock_ref: "FD-STRIPE-LIVE-CONTROLLED-BETA",
        payment_clear_owner: "Sam",
      }),
    );
    assert.equal(founding.status, "applied", founding.reason);
    assert.equal(founding.externalWrite, false);
    assert.equal(founding.dryRun, true);
  });

  it("wakes the owner/worker and keeps founder gates human", () => {
    const model = loadLifecycle();
    const checkin = model.transitions.find((item) => item.id === "t_open_weekly_checkin")!;
    const golive = model.transitions.find((item) => item.id === "t_founder_golive")!;
    const blocker = model.transitions.find((item) => item.id === "t_route_blocker")!;
    assert.equal(wakeFor(checkin).owner, "Jordan");
    assert.equal(wakeFor(checkin).founderRequired, false);
    assert.equal(wakeFor(golive).founderRequired, true);
    assert.equal(wakeFor(blocker).slackPrefix, "Grok_Alex:");
  });
});
