import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixtureFiles, readJson, validateAgainst } from "../src/schema.ts";
import { coverage, loadLifecycle } from "../src/engine/state-engine.ts";
import { loadPermissions } from "../src/permissions.ts";

describe("schemas and model", () => {
  it("accepts valid fixtures", () => {
    for (const path of fixtureFiles("events")) {
      const result = validateAgainst("businessEvent", readJson(path));
      assert.equal(result.ok, true, `${path}: ${result.errors.join("; ")}`);
    }
    for (const path of fixtureFiles("evidence")) {
      const result = validateAgainst("evidence", readJson(path));
      assert.equal(result.ok, true, `${path}: ${result.errors.join("; ")}`);
    }
    for (const path of fixtureFiles("handoffs")) {
      const result = validateAgainst("handoff", readJson(path));
      assert.equal(result.ok, true, `${path}: ${result.errors.join("; ")}`);
    }
    for (const path of fixtureFiles("social-qa")) {
      const result = validateAgainst("socialQa", readJson(path));
      assert.equal(result.ok, true, `${path}: ${result.errors.join("; ")}`);
    }
  });

  it("requires every lifecycle transition field", () => {
    const model = loadLifecycle();
    const cov = coverage(model);
    assert.equal(cov.required_fields_present, true);
    assert.ok(cov.states >= 20);
    assert.ok(cov.transitions >= 30);
    const permissions = validateAgainst("permissions", loadPermissions());
    assert.equal(permissions.ok, true, permissions.errors.join("; "));
  });
});
