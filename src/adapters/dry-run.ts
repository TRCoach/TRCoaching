import type { EvidenceMap, SystemOfRecord } from "../types.js";
import type { Connector } from "./contracts.js";
import { dryRunResult } from "./contracts.js";

class DryRunAdapter implements Connector {
  readonly mode = "dry-run" as const;
  constructor(readonly system: SystemOfRecord) {}

  invoke(action: string, evidence: EvidenceMap) {
    if (action.startsWith("none.")) {
      return dryRunResult(this.system, action, `no automated mutation (${action})`);
    }
    const keys = Object.keys(evidence).sort();
    return dryRunResult(
      this.system,
      action,
      `dry-run only; would inspect ${this.system} with keys [${keys.join(", ")}]; no live write`,
    );
  }
}

export const driveAdapter = new DryRunAdapter("Drive");
export const metricoolAdapter = new DryRunAdapter("Metricool");
export const crmAdapter = new DryRunAdapter("CRM");
export const stripeAdapter = new DryRunAdapter("Stripe");
export const supersetAdapter = new DryRunAdapter("Superset");
export const slackAdapter = new DryRunAdapter("Slack");

export const adapters: Record<SystemOfRecord, Connector> = {
  Drive: driveAdapter,
  Metricool: metricoolAdapter,
  CRM: crmAdapter,
  Stripe: stripeAdapter,
  Superset: supersetAdapter,
  Slack: slackAdapter,
};

export function invokeAdapter(system: SystemOfRecord, action: string, evidence: EvidenceMap) {
  return adapters[system].invoke(action, evidence);
}
