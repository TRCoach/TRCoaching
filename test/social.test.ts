import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { boxesWithinSafe, FEED_LAYOUT, layoutOverlaps, REEL_LAYOUT } from "../src/social/layout.ts";
import { qaAsset } from "../src/social/qa.ts";
import { renderBenchmarkAssets } from "../src/social/render.ts";
import { runGuard } from "../src/engine/guards.ts";
import type { LifecycleTransition } from "../src/types.ts";

const dummyTransition = {
  id: "t_request_publication",
  from: "social_qa_recorded",
  to: "publish_eligible",
  event: "request_publication",
  owner: "Taylor",
  requiredEvidence: [],
  systemOfRecord: "Metricool",
  automatedAction: "none",
  guard: "publication_dual_pass",
  stopCondition: "x",
  retryPolicy: { maxAttempts: 1, backoffSeconds: 0, escalateTo: "Alex", onExhausted: "fail_closed" },
  nextTrigger: "none",
  founderGate: true,
  idempotencyKey: "x",
} as LifecycleTransition;

describe("social render and QA", () => {
  it("declares non-overlapping layout inside safe margins", () => {
    assert.deepEqual(layoutOverlaps(FEED_LAYOUT), []);
    assert.deepEqual(layoutOverlaps(REEL_LAYOUT), []);
    assert.equal(boxesWithinSafe(FEED_LAYOUT), true);
    assert.equal(boxesWithinSafe(REEL_LAYOUT), true);
  });

  it("renders original benchmark assets and keeps publishEligible false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-social-"));
    const rendered = await renderBenchmarkAssets(dir);
    const jpg = await qaAsset({
      asset_id: "feed_jpg",
      path: rendered.feedJpg,
      config_id: rendered.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/jpeg" },
    });
    const webp = await qaAsset({
      asset_id: "feed_webp",
      path: rendered.feedWebp,
      config_id: rendered.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/webp" },
    });
    const mp4 = await qaAsset({
      asset_id: "reel_mp4",
      path: rendered.reelMp4,
      config_id: rendered.configId,
      layout: REEL_LAYOUT,
      expected: { width: 1080, height: 1920, mime: "video/mp4", codec: "h264" },
    });
    for (const report of [jpg, webp, mp4]) {
      assert.equal(report.checks.every((check) => check.pass), true, JSON.stringify(report.checks));
      assert.equal(report.audio, "none");
      assert.equal(report.aigc.used, false);
      assert.equal(report.publish_eligible, false);
      assert.equal(report.publication_occurred, false);
    }
  });

  it("requires dual PASS on the exact checksum and config", () => {
    const denied = runGuard(
      "publication_dual_pass",
      { taylor_pass: true, chatgpt_pass: false, asset_checksum: "aa", asset_config_id: "cfg" },
      dummyTransition,
    );
    assert.equal(denied.ok, false);
    const ok = runGuard(
      "publication_dual_pass",
      {
        taylor_pass: true,
        chatgpt_pass: true,
        asset_checksum: "aa",
        asset_config_id: "cfg",
        pass_checksum: "aa",
        pass_config_id: "cfg",
      },
      dummyTransition,
    );
    assert.equal(ok.ok, true);
  });
});
