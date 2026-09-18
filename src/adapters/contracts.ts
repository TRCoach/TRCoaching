import type { DryRunResult, EvidenceMap, SystemOfRecord } from "../types.js";

export interface Connector {
  readonly system: SystemOfRecord;
  readonly mode: "dry-run";
  invoke(action: string, evidence: EvidenceMap): DryRunResult;
}

export function dryRunResult(
  system: SystemOfRecord,
  action: string,
  detail: string,
  accepted = true,
): DryRunResult {
  return {
    adapter: system,
    action,
    dryRun: true,
    externalWrite: false,
    accepted,
    detail,
  };
}

export function assertDryRun(result: DryRunResult): void {
  if (result.dryRun !== true || result.externalWrite !== false) {
    throw new Error(`${result.adapter} attempted a live write`);
  }
}
