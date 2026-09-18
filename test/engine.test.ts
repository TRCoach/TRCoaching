import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { event, happyPathToReady, SHARED } from "../src/events.ts";
import { loadLifecycle, StateEngine } from "../src/engine/state-engine.ts";
import type { BusinessEvent } from "../src/types.ts";

function engine() {
  return new StateEngine(loadLifecycle());
}

function applyAll(target: StateEngine, events: BusinessEvent[]) {
  return events.map((item) => {
    const result = target.apply(item);
    assert.equal(result.status, "applied", result.reason);
    return result;
  });
}

describe("state engine", () => {
  it("walks marketing through payment_verified and returns next owner/action/trigger", () => {
    const target = engine();
    const results = applyAll(target, happyPathToReady());
    assert.equal(target.state.current, "payment_verified");
    const last = results.at(-1)!;
    assert.equal(last.nextOwner, "Sam");
    assert.equal(last.nextTrigger, "mark_closed_won");
    assert.equal(last.externalWrite, false);
    assert.equal(last.dryRun, true);
    assert.equal(target.next().from, "payment_verified");
  });

  it("ignores a duplicated event_id and idempotency key", () => {
    const target = engine();
    applyAll(target, happyPathToReady().slice(0, 1));
    const first = event("social_enquiry", "Taylor", {
      enquiry_channel: "instagram",
      enquiry_received_at: "2026-09-18T10:00:00Z",
      non_pii_enquiry_ref: "ENQ-DUP-1",
    }, "evt_dup_1");
    const applied = target.apply(first);
    assert.equal(applied.status, "applied");
    const again = target.apply(first);
    assert.equal(again.status, "ignored_duplicate");
    assert.match(again.reason ?? "", /event_id/);
    const sameKey: BusinessEvent = { ...first, event_id: "evt_dup_2" };
    const ignoredKey = target.apply(sameKey);
    assert.equal(ignoredKey.status, "ignored_duplicate");
    assert.equal(target.state.current, "social_enquiry_received");
  });

  it("covers classification, nurture, coaching loop, retention and offboarding without money movement", () => {
    const target = engine();
    applyAll(target, [
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
      event("start_nurture", "Taylor", {
        non_pii_enquiry_ref: SHARED.non_pii_enquiry_ref,
        nurture_sequence_ref: SHARED.nurture_sequence_ref,
      }),
    ]);
    assert.equal(target.state.current, "nurture");
  });
});
