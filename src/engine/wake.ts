import type { LifecycleTransition, Owner } from "../types.js";

export interface WakePlan {
  owner: Owner;
  worker: "Cursor" | "none";
  founderRequired: boolean;
  slackPrefix?: "Grok_Alex:";
  reason: string;
}

const CURSOR_WORKERS = new Set([
  "dry_run.record_campaign_pointer",
  "dry_run.record_asset_pointer",
  "dry_run.record_qa_pointer",
  "dry_run.record_learning_proposal",
  "dry_run.open_checkin_record",
  "dry_run.close_checkin_record",
]);

export function wakeFor(transition: LifecycleTransition): WakePlan {
  const founderRequired = transition.founderGate === true;
  const worker = CURSOR_WORKERS.has(transition.automatedAction) && !founderRequired ? "Cursor" : "none";
  return {
    owner: transition.owner,
    worker,
    founderRequired,
    slackPrefix: transition.owner === "Alex" ? "Grok_Alex:" : undefined,
    reason: founderRequired
      ? "human/founder gate — do not auto-advance"
      : `wake ${transition.owner}${worker === "Cursor" ? " with one bounded Cursor task in TRCoach/TRCoaching" : ""}`,
  };
}
