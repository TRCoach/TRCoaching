import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adapters, invokeAdapter } from "../src/adapters/dry-run.ts";
import { assertDryRun } from "../src/adapters/contracts.ts";

describe("connectors", () => {
  it("exposes dry-run adapters for every system of record", () => {
    for (const system of ["Drive", "Metricool", "CRM", "Stripe", "Superset", "Slack"] as const) {
      const result = invokeAdapter(system, "dry_run.ping", { ref: "bench" });
      assert.equal(adapters[system].mode, "dry-run");
      assert.equal(result.dryRun, true);
      assert.equal(result.externalWrite, false);
      assertDryRun(result);
    }
  });
});
