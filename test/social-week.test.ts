import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateAgainst } from "../src/schema.ts";
import {
  buildWeekCalendar,
  evaluateWeekRules,
  NEXT_WEEK_END,
  NEXT_WEEK_START,
  PLATFORM_WINDOWS,
  produceAndQaNextWeek,
  WEEK_TREATMENTS,
  weekDates,
} from "../src/social/week.ts";

describe("next-week social produce and technical QA", () => {
  it("builds a 7-day locked-window calendar with rotating silent treatments", () => {
    const slots = buildWeekCalendar();
    const dates = weekDates();
    assert.deepEqual(dates, [
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    assert.equal(NEXT_WEEK_START, "2026-09-21");
    assert.equal(NEXT_WEEK_END, "2026-09-27");
    assert.equal(slots.length, 7 * 3 * 3);
    assert.equal(slots.filter((slot) => slot.platform === "instagram").length, 21);
    assert.ok(slots.every((slot) => slot.audio === "none"));
    assert.ok(slots.every((slot) => slot.timezone === "Europe/London"));
    for (const date of dates) {
      assert.deepEqual(
        slots.filter((slot) => slot.platform === "instagram" && slot.date === date).map((slot) => slot.local_time),
        [...PLATFORM_WINDOWS.instagram],
      );
      assert.deepEqual(
        slots.filter((slot) => slot.platform === "facebook" && slot.date === date).map((slot) => slot.local_time),
        [...PLATFORM_WINDOWS.facebook],
      );
      assert.deepEqual(
        slots.filter((slot) => slot.platform === "tiktok" && slot.date === date).map((slot) => slot.local_time),
        [...PLATFORM_WINDOWS.tiktok],
      );
    }
    for (const platform of Object.keys(PLATFORM_WINDOWS)) {
      const ordered = slots
        .filter((slot) => slot.platform === platform)
        .sort((a, b) => `${a.date}${a.local_time}`.localeCompare(`${b.date}${b.local_time}`));
      for (let i = 1; i < ordered.length; i += 1) {
        assert.notEqual(ordered[i]!.treatment_id, ordered[i - 1]!.treatment_id);
      }
    }
    assert.deepEqual(
      WEEK_TREATMENTS.map((treatment) => treatment.format),
      ["photo", "reel", "photo"],
    );
  });

  it("fails publication dual PASS while technical week rules pass", () => {
    const slots = buildWeekCalendar();
    const assets = WEEK_TREATMENTS.flatMap((treatment) => {
      if (treatment.format === "photo") {
        return [
          stubAsset(`${treatment.id}_feed_jpg`, "image/jpeg", "assets/week-2026-09-21/t1-static-feed.jpg"),
          stubAsset(`${treatment.id}_feed_webp`, "image/webp", "assets/week-2026-09-21/t1-static-feed.webp"),
        ];
      }
      return [stubAsset(`${treatment.id}_mp4`, "video/mp4", "assets/week-2026-09-21/t2-reel-reel.mp4", "h264")];
    });
    const checks = evaluateWeekRules(slots, assets);
    assert.equal(checks.filter((check) => check.gate === "technical").every((check) => check.pass), true);
    const dual = checks.find((check) => check.id === "exact_final_taylor_and_chatgpt_pass");
    assert.equal(dual?.pass, false);
    assert.equal(dual?.gate, "publication");
  });

  it("renders next-week assets, technically passes, and keeps publishEligible false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-week-"));
    const result = await produceAndQaNextWeek({
      outDir: join(dir, "assets"),
      reportDir: join(dir, "reports"),
      eventId: "evt_b3ab3c98",
      correlationId: "corr_a80de922",
    });
    const schema = validateAgainst("weekSocialQa", result.report);
    assert.equal(schema.ok, true, schema.errors.join("; "));
    assert.equal(result.report.technical_qa_pass, true);
    assert.equal(result.report.proof.publish_eligible, false);
    assert.equal(result.report.proof.taylor_pass, false);
    assert.equal(result.report.proof.chatgpt_pass, false);
    assert.equal(result.report.proof.exact_final_dual_pass, false);
    assert.equal(result.report.publication_occurred, false);
    assert.equal(result.report.external_writes, 0);
    assert.ok(result.report.assets.every((asset) => asset.audio === "none"));
    assert.ok(result.report.assets.every((asset) => asset.aigc.used === false));
    assert.ok(result.report.assets.every((asset) => !asset.path.endsWith(".png")));
    assert.ok(result.report.files.every((file) => !file.endsWith(".png")));
    assert.ok(result.report.evidence_refs.includes("tiktok_photo_jpeg_or_webp_not_png"));
    assert.ok(result.report.evidence_refs.includes("CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST"));
  });
});

function stubAsset(assetId: string, mime: string, path: string, codec: string | null = null) {
  return {
    asset_id: assetId,
    path,
    checksum_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    config_id: "week-2026-09-21-test",
    dimensions: { width: mime === "video/mp4" ? 1080 : 1080, height: mime === "video/mp4" ? 1920 : 1350 },
    mime,
    codec,
    safe_margins: { pass: true },
    layout_overlap: { pass: true, overlaps: [] },
    provenance: {
      generator: "tr-control-plane/social-render",
      source: "code" as const,
      external_media: false as const,
      paid_assets: false as const,
      music: false as const,
    },
    aigc: { used: false, rationale: "deterministic code render; no generative image model" },
    audio: "none" as const,
    checks: [],
    taylor_pass: false,
    chatgpt_pass: false,
    pass_checksum: null,
    pass_config_id: null,
    publish_eligible: false,
    publication_occurred: false as const,
  };
}
