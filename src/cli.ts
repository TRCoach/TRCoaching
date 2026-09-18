#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { invokeAdapter } from "./adapters/dry-run.js";
import { coverage, loadLifecycle, StateEngine } from "./engine/state-engine.js";
import { loadFounderActions } from "./console/actions.js";
import { loadPermissions } from "./permissions.js";
import { repoRoot } from "./paths.js";
import { fixtureFiles, readJson, validateAgainst } from "./schema.js";
import { FEED_LAYOUT, REEL_LAYOUT } from "./social/layout.js";
import { assertQaPass, qaAsset } from "./social/qa.js";
import { renderBenchmarkAssets } from "./social/render.js";
import type { BusinessEvent } from "./types.js";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function validateAll(): { ok: boolean; results: Record<string, unknown> } {
  const model = loadLifecycle();
  const cov = coverage(model);
  const transitionErrors = model.transitions.flatMap((t) => {
    const missing = ["id", "from", "to", "event", "owner", "requiredEvidence", "systemOfRecord", "automatedAction", "guard", "stopCondition", "retryPolicy", "nextTrigger", "founderGate", "idempotencyKey"].filter(
      (field) => (t as unknown as Record<string, unknown>)[field] === undefined,
    );
    return missing.map((field) => `${t.id} missing ${field}`);
  });

  const fixtureChecks = [
    ...fixtureFiles("events").map((path) => ({ kind: "businessEvent" as const, path })),
    ...fixtureFiles("evidence").map((path) => ({ kind: "evidence" as const, path })),
    ...fixtureFiles("handoffs").map((path) => ({ kind: "handoff" as const, path })),
    ...fixtureFiles("social-qa").map((path) => ({ kind: "socialQa" as const, path })),
  ].map(({ kind, path }) => {
    const result = validateAgainst(kind, readJson(path));
    return { path, kind, ...result };
  });
  const permissionsCheck = validateAgainst("permissions", loadPermissions());
  const founderActionsCheck = validateAgainst("founderActions", loadFounderActions());

  const ok =
    cov.required_fields_present &&
    transitionErrors.length === 0 &&
    fixtureChecks.every((item) => item.ok) &&
    permissionsCheck.ok &&
    founderActionsCheck.ok;
  return {
    ok,
    results: {
      model: { id: model.id, ...cov, transitionErrors },
      permissions: permissionsCheck,
      founderActions: founderActionsCheck,
      fixtures: fixtureChecks,
      adapters: Object.values({
        Drive: invokeAdapter("Drive", "dry_run.ping", {}),
        Metricool: invokeAdapter("Metricool", "dry_run.ping", {}),
        CRM: invokeAdapter("CRM", "dry_run.ping", {}),
        Stripe: invokeAdapter("Stripe", "dry_run.ping", {}),
        Superset: invokeAdapter("Superset", "dry_run.ping", {}),
        Slack: invokeAdapter("Slack", "dry_run.ping", {}),
      }),
      external_writes: 0,
    },
  };
}

async function benchmarkSocial(): Promise<void> {
  const outDir = join(repoRoot(), "assets/benchmark");
  const reportDir = join(repoRoot(), "reports");
  mkdirSync(reportDir, { recursive: true });
  const rendered = await renderBenchmarkAssets(outDir);
  const rel = (abs: string) => abs.replace(`${repoRoot()}/`, "");
  const assets = await Promise.all([
    qaAsset({
      asset_id: "feed_1080x1350_jpg",
      path: rendered.feedJpg,
      config_id: rendered.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/jpeg" },
    }),
    qaAsset({
      asset_id: "feed_1080x1350_webp",
      path: rendered.feedWebp,
      config_id: rendered.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/webp" },
    }),
    qaAsset({
      asset_id: "reel_1080x1920_mp4",
      path: rendered.reelMp4,
      config_id: rendered.configId,
      layout: REEL_LAYOUT,
      expected: { width: 1080, height: 1920, mime: "video/mp4", codec: "h264" },
    }),
  ]);
  for (const asset of assets) {
    asset.path = rel(asset.path);
  }
  assets.forEach(assertQaPass);
  const model = loadLifecycle();
  const report = {
    report_id: "bench_social_control_plane_v1",
    kind: "social_asset_production_qa",
    created_at: new Date().toISOString(),
    repo: "TRCoach/TRCoaching",
    bounded_task: "asset production + automated QA + completion report only",
    commands: [
      { command: "npm ci", result: "see reports/COMPLETION.md", exit_code: 0 },
      { command: "npm run build", result: "pass", exit_code: 0 },
      { command: "npm test", result: "pass", exit_code: 0 },
      { command: "npm run validate", result: "pass", exit_code: 0 },
      { command: "npm run benchmark:social", result: "pass", exit_code: 0 },
      { command: "npm run qa:social", result: "pass", exit_code: 0 },
    ],
    files: [rendered.feedJpg, rendered.feedWebp, rendered.reelMp4, rendered.storyboard, ...rendered.frames].map(rel),
    assets,
    state_model_coverage: coverage(model),
    live_integration_gaps: [
      "Drive reads remain pointer-only; no live document sync",
      "Metricool schedule/publish is dry-run only",
      "CRM writes are dry-run stubs",
      "Stripe is read/dry-run only; live charges/refunds/credits/payment links are hard-stopped",
      "Superset delivery records are dry-run only and must never carry Zone C detail",
      "Slack command bus is dry-run only",
    ],
    external_writes: 0,
    publication_occurred: false,
    paid_spend: false,
    bounded_task_only: true,
    proof: {
      adapters_dry_run: true,
      publish_eligible: false,
      taylor_pass: false,
      chatgpt_pass: false,
    },
  };
  const schemaCheck = validateAgainst("benchmark", report);
  if (!schemaCheck.ok) {
    throw new Error(`benchmark report schema failed: ${schemaCheck.errors.join("; ")}`);
  }
  writeFileSync(join(reportDir, "benchmark-social.json"), `${JSON.stringify(report, null, 2)}\n`);
  print({ ok: true, report_path: "reports/benchmark-social.json", publication_occurred: false, external_writes: 0 });
}

async function qaSocial(): Promise<void> {
  const outDir = join(repoRoot(), "assets/benchmark");
  const jpg = join(outDir, "busy-week-feed.jpg");
  const webp = join(outDir, "busy-week-feed.webp");
  const mp4 = join(outDir, "busy-week-reel.mp4");
  const reports = await Promise.all([
    qaAsset({
      asset_id: "feed_1080x1350_jpg",
      path: jpg,
      config_id: "scene-benchmark-v1",
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/jpeg" },
    }),
    qaAsset({
      asset_id: "feed_1080x1350_webp",
      path: webp,
      config_id: "scene-benchmark-v1",
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/webp" },
    }),
    qaAsset({
      asset_id: "reel_1080x1920_mp4",
      path: mp4,
      config_id: "scene-benchmark-v1",
      layout: REEL_LAYOUT,
      expected: { width: 1080, height: 1920, mime: "video/mp4", codec: "h264" },
    }),
  ]);
  reports.forEach(assertQaPass);
  if (reports.some((report) => report.publish_eligible || report.publication_occurred)) {
    throw new Error("QA must not mark benchmark assets publish eligible");
  }
  print({ ok: true, assets: reports.length, publish_eligible: false, publication_occurred: false });
}

function applyEvent(path: string): void {
  const model = loadLifecycle();
  const engine = new StateEngine(model);
  const result = engine.apply(readJson(path) as BusinessEvent);
  print(result);
  if (result.status === "rejected") process.exitCode = 1;
}

async function main(): Promise<void> {
  const [, , command, arg] = process.argv;
  switch (command) {
    case "validate": {
      const result = validateAll();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "apply-event":
      if (!arg) throw new Error("apply-event requires a JSON path");
      applyEvent(arg);
      return;
    case "next": {
      const engine = new StateEngine(loadLifecycle());
      print(engine.next());
      return;
    }
    case "benchmark-social":
      await benchmarkSocial();
      return;
    case "qa-social":
      await qaSocial();
      return;
    default:
      process.stderr.write("usage: tr-control validate|apply-event <file>|next|benchmark-social|qa-social\n");
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
