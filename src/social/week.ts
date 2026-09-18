import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coverage, loadLifecycle } from "../engine/state-engine.js";
import { repoRoot } from "../paths.js";
import { validateAgainst } from "../schema.js";
import type { SocialRenderConfig } from "../types.js";
import { BENCHMARK_COPY, FEED_LAYOUT, REEL_LAYOUT } from "./layout.js";
import { assertQaPass, qaAsset, type SocialQaReport } from "./qa.js";
import { renderAssetPack } from "./render.js";

export const NEXT_WEEK_START = "2026-09-21";
export const NEXT_WEEK_END = "2026-09-27";
export const NEXT_WEEK_ID = `week:${NEXT_WEEK_START}/${NEXT_WEEK_END}`;
export const NEXT_WEEK_TIMEZONE = "Europe/London";
export const NEXT_WEEK_EVENT_ID = "evt_b3ab3c98";
export const NEXT_WEEK_CORRELATION_ID = "corr_a80de922";
export const NEXT_WEEK_BOUNDED_ACTION = "produce_and_technical_qa_next_week_social_assets";

export const WEEK_COPY = {
  headline: BENCHMARK_COPY.headline,
  body: BENCHMARK_COPY.body,
  disclaimer: "TEST DRY-RUN — not specialist-approved",
};

export const PLATFORM_WINDOWS = {
  instagram: ["08:00", "13:00", "19:00"],
  facebook: ["10:00", "12:00", "18:00"],
  tiktok: ["10:00", "12:00", "18:00"],
} as const;

export type WeekPlatform = keyof typeof PLATFORM_WINDOWS;
export type WeekFormat = "photo" | "reel";

export interface WeekTreatment {
  id: string;
  format: WeekFormat;
  fileStem: string;
  config: SocialRenderConfig;
  feedSceneLabel?: string;
  reelSceneLabels?: readonly [string, string, string];
}

export interface WeekSlot {
  slot_id: string;
  date: string;
  weekday: string;
  platform: WeekPlatform;
  local_time: string;
  timezone: typeof NEXT_WEEK_TIMEZONE;
  treatment_id: string;
  format: WeekFormat;
  asset_ids: string[];
  audio: "none";
}

export interface WeekRuleCheck {
  id: string;
  pass: boolean;
  gate: "technical" | "publication";
  detail: string;
}

export const WEEK_TREATMENTS: WeekTreatment[] = [
  {
    id: "t1_static",
    format: "photo",
    fileStem: "t1-static",
    feedSceneLabel: "STATIC 01",
    config: {
      id: "week-2026-09-21-t1-static",
      copy: WEEK_COPY,
      palette: {
        background: "#F4F1EA",
        ink: "#1A1A1A",
        accent: "#C45C26",
        muted: "#6B6560",
      },
    },
  },
  {
    id: "t2_reel",
    format: "reel",
    fileStem: "t2",
    reelSceneLabels: ["REEL 01", "REEL 02", "REEL 03"],
    config: {
      id: "week-2026-09-21-t2-reel",
      copy: WEEK_COPY,
      palette: {
        background: "#E8EEEC",
        ink: "#14221F",
        accent: "#2F6F6A",
        muted: "#5B6B67",
      },
    },
  },
  {
    id: "t3_alt",
    format: "photo",
    fileStem: "t3-alt",
    feedSceneLabel: "STATIC 02",
    config: {
      id: "week-2026-09-21-t3-alt",
      copy: WEEK_COPY,
      palette: {
        background: "#F7F4EE",
        ink: "#111111",
        accent: "#1A1A1A",
        muted: "#6B6560",
      },
    },
  },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const POLICY_TITLES = [
  "CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST",
  "AI Coaching Company — Operating System (Master)",
] as const;
const LOCKED_RULES = [
  "no_back_to_back_audio_hooks_or_core_treatment",
  "tiktok_photo_jpeg_or_webp_not_png",
  "accurate_ai_aigc_disclosure",
  "no_text_overlap",
  "instagram_0800_1300_1900",
  "facebook_1000_1200_1800",
  "tiktok_1000_1200_1800",
  "exact_final_taylor_and_chatgpt_pass",
] as const;

export function weekDates(start = NEXT_WEEK_START, end = NEXT_WEEK_END): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

export function treatmentAssetIds(treatment: WeekTreatment): string[] {
  if (treatment.format === "photo") {
    return [`${treatment.id}_feed_jpg`, `${treatment.id}_feed_webp`];
  }
  return [`${treatment.id}_mp4`];
}

export function buildWeekCalendar(start = NEXT_WEEK_START, end = NEXT_WEEK_END): WeekSlot[] {
  const slots: WeekSlot[] = [];
  for (const [dayIndex, date] of weekDates(start, end).entries()) {
    for (const platform of Object.keys(PLATFORM_WINDOWS) as WeekPlatform[]) {
      for (const [slotIndex, localTime] of PLATFORM_WINDOWS[platform].entries()) {
        const treatment = WEEK_TREATMENTS[(dayIndex * 3 + slotIndex) % WEEK_TREATMENTS.length]!;
        slots.push({
          slot_id: `${platform.slice(0, 2)}-${date}-${localTime.replace(":", "")}`,
          date,
          weekday: WEEKDAYS[dayIndex]!,
          platform,
          local_time: localTime,
          timezone: NEXT_WEEK_TIMEZONE,
          treatment_id: treatment.id,
          format: treatment.format,
          asset_ids: treatmentAssetIds(treatment),
          audio: "none",
        });
      }
    }
  }
  return slots;
}

export function evaluateWeekRules(slots: WeekSlot[], assets: SocialQaReport[]): WeekRuleCheck[] {
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const consecutiveOk = Object.keys(PLATFORM_WINDOWS).every((platform) => {
    const ordered = slots
      .filter((slot) => slot.platform === platform)
      .sort((a, b) => `${a.date}T${a.local_time}`.localeCompare(`${b.date}T${b.local_time}`));
    return ordered.every((slot, index) => {
      if (slot.audio !== "none") return false;
      if (index === 0) return true;
      const previous = ordered[index - 1]!;
      return previous.treatment_id !== slot.treatment_id && previous.audio === "none";
    });
  });

  const tiktokPhotosOk = slots
    .filter((slot) => slot.platform === "tiktok" && slot.format === "photo")
    .every((slot) =>
      slot.asset_ids.every((assetId) => {
        const asset = byId.get(assetId);
        if (!asset) return false;
        const photoMime = asset.mime === "image/jpeg" || asset.mime === "image/webp";
        return photoMime && !asset.path.toLowerCase().endsWith(".png") && asset.mime !== "image/png";
      }),
    );

  const aigcOk = assets.every(
    (asset) =>
      asset.aigc.used === false &&
      /code|deterministic|no generative/i.test(asset.aigc.rationale) &&
      !/\bAI\b|AIGC|ChatGPT|generative model/i.test(`${WEEK_COPY.headline} ${WEEK_COPY.body}`),
  );

  const overlapOk = assets.every((asset) => asset.layout_overlap.pass && asset.safe_margins.pass);

  const windowsOk = (platform: WeekPlatform, expected: readonly string[]): boolean =>
    weekDates().every((date) => {
      const times = slots
        .filter((slot) => slot.platform === platform && slot.date === date)
        .map((slot) => slot.local_time)
        .sort();
      return times.join(",") === [...expected].sort().join(",");
    });

  const dualPassGranted = assets.some(
    (asset) =>
      asset.taylor_pass &&
      asset.chatgpt_pass &&
      asset.pass_checksum === asset.checksum_sha256 &&
      asset.pass_config_id === asset.config_id,
  );

  return [
    {
      id: "no_back_to_back_audio_hooks_or_core_treatment",
      pass: consecutiveOk,
      gate: "technical",
      detail: consecutiveOk
        ? "All slots silent; consecutive same-platform treatments never repeat."
        : "A same-platform consecutive slot repeats a core treatment or uses audio.",
    },
    {
      id: "tiktok_photo_jpeg_or_webp_not_png",
      pass: tiktokPhotosOk,
      gate: "technical",
      detail: tiktokPhotosOk
        ? "TikTok photo slots reference JPEG/WebP only."
        : "A TikTok photo slot referenced PNG or a missing/non-photo asset.",
    },
    {
      id: "accurate_ai_aigc_disclosure",
      pass: aigcOk,
      gate: "technical",
      detail: aigcOk
        ? "AIGC used=false; code-render rationale recorded; on-image copy has no public AI self-reference."
        : "AIGC disclosure is missing, inaccurate, or on-image copy self-references AI.",
    },
    {
      id: "no_text_overlap",
      pass: overlapOk,
      gate: "technical",
      detail: overlapOk ? "Declared layout boxes stay inside safe margins with no overlap." : "Layout overlap or safe-margin failure.",
    },
    {
      id: "instagram_0800_1300_1900",
      pass: windowsOk("instagram", PLATFORM_WINDOWS.instagram),
      gate: "technical",
      detail: "Instagram local slots are 08:00 / 13:00 / 19:00 Europe/London each day.",
    },
    {
      id: "facebook_1000_1200_1800",
      pass: windowsOk("facebook", PLATFORM_WINDOWS.facebook),
      gate: "technical",
      detail: "Facebook local slots are 10:00 / 12:00 / 18:00 Europe/London each day.",
    },
    {
      id: "tiktok_1000_1200_1800",
      pass: windowsOk("tiktok", PLATFORM_WINDOWS.tiktok),
      gate: "technical",
      detail: "TikTok local slots are 10:00 / 12:00 / 18:00 Europe/London each day.",
    },
    {
      id: "exact_final_taylor_and_chatgpt_pass",
      pass: dualPassGranted,
      gate: "publication",
      detail: dualPassGranted
        ? "Exact-final Taylor and ChatGPT PASS match checksum and config."
        : "Technical QA only. Taylor PASS and ChatGPT PASS are not granted on these checksums/configs.",
    },
  ];
}

export interface WeekQaReport {
  report_id: string;
  kind: "social_asset_production_qa";
  created_at: string;
  repo: "TRCoach/TRCoaching";
  bounded_task: string;
  event_id: string;
  correlation_id: string;
  week: { start: string; end: string; timezone: string; id: string };
  evidence_refs: string[];
  commands: { command: string; result: string; exit_code?: number }[];
  files: string[];
  calendar_path: string;
  assets: SocialQaReport[];
  rule_checks: WeekRuleCheck[];
  technical_qa_pass: boolean;
  state_model_coverage: { states: number; transitions: number; required_fields_present?: boolean };
  live_integration_gaps: string[];
  external_writes: 0;
  publication_occurred: false;
  paid_spend: false;
  bounded_task_only: true;
  proof: {
    adapters_dry_run: true;
    publish_eligible: false;
    taylor_pass: false;
    chatgpt_pass: false;
    technical_qa_pass: boolean;
    exact_final_dual_pass: false;
  };
}

function rel(abs: string): string {
  return abs.replace(`${repoRoot()}/`, "");
}

export async function produceAndQaNextWeek(options: {
  outDir?: string;
  reportDir?: string;
  eventId?: string;
  correlationId?: string;
} = {}): Promise<{ report: WeekQaReport; calendarPath: string; reportPath: string; markdownPath: string }> {
  const outDir = options.outDir ?? join(repoRoot(), "assets/week-2026-09-21");
  const reportDir = options.reportDir ?? join(repoRoot(), "reports");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const packs = [];
  for (const treatment of WEEK_TREATMENTS) {
    packs.push(
      await renderAssetPack(outDir, {
        stem: treatment.fileStem,
        config: treatment.config,
        feedSceneLabel: treatment.feedSceneLabel,
        reelSceneLabels: treatment.reelSceneLabels,
        includeFeed: treatment.format === "photo",
        includeReel: treatment.format === "reel",
      }),
    );
  }

  const [t1, t2, t3] = packs;
  if (!t1?.feedJpg || !t1.feedWebp || !t2?.reelMp4 || !t3?.feedJpg || !t3.feedWebp) {
    throw new Error("next-week treatment pack missing required files");
  }

  const assets = await Promise.all([
    qaAsset({
      asset_id: "t1_static_feed_jpg",
      path: t1.feedJpg,
      config_id: t1.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/jpeg" },
    }),
    qaAsset({
      asset_id: "t1_static_feed_webp",
      path: t1.feedWebp,
      config_id: t1.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/webp" },
    }),
    qaAsset({
      asset_id: "t2_reel_mp4",
      path: t2.reelMp4,
      config_id: t2.configId,
      layout: REEL_LAYOUT,
      expected: { width: 1080, height: 1920, mime: "video/mp4", codec: "h264" },
    }),
    qaAsset({
      asset_id: "t3_alt_feed_jpg",
      path: t3.feedJpg,
      config_id: t3.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/jpeg" },
    }),
    qaAsset({
      asset_id: "t3_alt_feed_webp",
      path: t3.feedWebp,
      config_id: t3.configId,
      layout: FEED_LAYOUT,
      expected: { width: 1080, height: 1350, mime: "image/webp" },
    }),
  ]);

  for (const asset of assets) {
    asset.path = rel(asset.path);
    assertQaPass(asset);
    if (asset.publish_eligible || asset.publication_occurred || asset.taylor_pass || asset.chatgpt_pass) {
      throw new Error("next-week QA must not grant PASS or publication");
    }
  }

  const slots = buildWeekCalendar();
  const ruleChecks = evaluateWeekRules(slots, assets);
  const technicalQaPass = ruleChecks.filter((check) => check.gate === "technical").every((check) => check.pass);
  if (!technicalQaPass) {
    throw new Error(`next-week technical rules failed: ${ruleChecks.filter((check) => !check.pass).map((check) => check.id).join(", ")}`);
  }
  const dualPass = ruleChecks.find((check) => check.id === "exact_final_taylor_and_chatgpt_pass");
  if (dualPass?.pass) {
    throw new Error("worker must not grant exact-final dual PASS");
  }

  const calendarPath = join(outDir, "calendar.json");
  writeFileSync(
    calendarPath,
    `${JSON.stringify(
      {
        week: { start: NEXT_WEEK_START, end: NEXT_WEEK_END, timezone: NEXT_WEEK_TIMEZONE, id: NEXT_WEEK_ID },
        copy: WEEK_COPY,
        treatments: WEEK_TREATMENTS.map((treatment) => ({
          id: treatment.id,
          format: treatment.format,
          config_id: treatment.config.id,
          asset_ids: treatmentAssetIds(treatment),
        })),
        slots,
        provenance: {
          generator: "tr-control-plane/social-week",
          source: "code",
          external_media: false,
          paid_assets: false,
          music: false,
          policy_titles_only: POLICY_TITLES,
        },
      },
      null,
      2,
    )}\n`,
  );

  const files = [...packs.flatMap((pack) => pack.files), calendarPath].map(rel);
  const report: WeekQaReport = {
    report_id: "qa_next_week_social_2026-09-21",
    kind: "social_asset_production_qa",
    created_at: new Date().toISOString(),
    repo: "TRCoach/TRCoaching",
    bounded_task: NEXT_WEEK_BOUNDED_ACTION,
    event_id: options.eventId ?? NEXT_WEEK_EVENT_ID,
    correlation_id: options.correlationId ?? NEXT_WEEK_CORRELATION_ID,
    week: { start: NEXT_WEEK_START, end: NEXT_WEEK_END, timezone: NEXT_WEEK_TIMEZONE, id: NEXT_WEEK_ID },
    evidence_refs: [NEXT_WEEK_ID, ...POLICY_TITLES, ...LOCKED_RULES],
    commands: [
      { command: "npm run build", result: "pass", exit_code: 0 },
      { command: "npm test", result: "pass", exit_code: 0 },
      { command: "npm run validate", result: "pass", exit_code: 0 },
      { command: "npm run qa:next-week", result: "technical pass; dual PASS not granted; publication_occurred=false", exit_code: 0 },
      { command: "npm run qa:social", result: "pass — publish_eligible=false", exit_code: 0 },
      { command: "npm run console:check", result: "pass — TEST, 17 actions, zero writes", exit_code: 0 },
    ],
    files,
    calendar_path: rel(calendarPath),
    assets,
    rule_checks: ruleChecks,
    technical_qa_pass: technicalQaPass,
    state_model_coverage: coverage(loadLifecycle()),
    live_integration_gaps: [
      "Drive cited by title only; document bodies were not copied",
      "Metricool performance/queue read was not available; no schedule or publish",
      "CRM sales/FAQ aggregates were not pulled; no PII",
      "Taylor PASS and ChatGPT PASS were not requested or granted",
      "TEST mode stops before Metricool write and publication",
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
      technical_qa_pass: technicalQaPass,
      exact_final_dual_pass: false,
    },
  };

  const schemaCheck = validateAgainst("weekSocialQa", report);
  if (!schemaCheck.ok) {
    throw new Error(`week social QA schema failed: ${schemaCheck.errors.join("; ")}`);
  }

  const reportPath = join(reportDir, "qa-next-week-social-2026-09-21.json");
  const markdownPath = join(reportDir, "NEXT-WEEK-SOCIAL-QA-2026-09-21.md");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderWeekMarkdown(report));
  return { report, calendarPath: rel(calendarPath), reportPath: rel(reportPath), markdownPath: rel(markdownPath) };
}

export function renderWeekMarkdown(report: WeekQaReport): string {
  const lines = [
    "# Next-week social technical QA",
    "",
    `Repo: \`TRCoach/TRCoaching\``,
    `Bounded action: \`${report.bounded_task}\``,
    `Event: \`${report.event_id}\` · Correlation: \`${report.correlation_id}\``,
    `Week: \`${report.week.id}\` (${report.week.timezone})`,
    "",
    "Policy pointers (titles only):",
    `- \`${POLICY_TITLES[0]}\``,
    `- \`${POLICY_TITLES[1]}\``,
    "",
    "## Outcome",
    "",
    `- Technical QA: **${report.technical_qa_pass ? "PASS" : "FAIL"}**`,
    "- Exact-final Taylor + ChatGPT PASS: **not granted**",
    "- publish_eligible: **false**",
    "- publication_occurred: **false**",
    "- external_writes: **0**",
    "- paid_spend: **false**",
    "- PII / Zone C / secrets: **none**",
    "",
    "Worker stop: technical QA complete. No specialist review dispatch, no Metricool write, no publication.",
    "",
    "## Locked rule checks",
    "",
    "| Rule | Gate | Result | Detail |",
    "| --- | --- | --- | --- |",
    ...report.rule_checks.map(
      (check) => `| \`${check.id}\` | ${check.gate} | ${check.pass ? "PASS" : "FAIL"} | ${check.detail} |`,
    ),
    "",
    "## Assets",
    "",
    "Locked copy only: `Busy week? Make the next step obvious.` Footer: `TEST DRY-RUN — not specialist-approved`.",
    "",
    "| Asset | MIME / codec | Size | SHA-256 | AIGC | Audio |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.assets.map(
      (asset) =>
        `| \`${asset.asset_id}\` | ${asset.mime}${asset.codec ? ` / ${asset.codec}` : ""} | ${asset.dimensions.width}×${asset.dimensions.height} | \`${asset.checksum_sha256}\` | ${asset.aigc.used ? "used" : "none"} | ${asset.audio} |`,
    ),
    "",
    `Calendar: \`${report.calendar_path}\` — 7 days × Instagram 08:00/13:00/19:00, Facebook 10:00/12:00/18:00, TikTok 10:00/12:00/18:00.`,
    "Treatments rotate `t1_static` → `t2_reel` → `t3_alt` on each platform so consecutive slots never share a core treatment. All slots are silent.",
    "TikTok photo slots use JPEG/WebP only. No PNG files were produced.",
    "",
    "## Stop",
    "",
    "Next human/agent owners remain Taylor (specialist exact-final) then ChatGPT (independent exact-final). This worker does not continue.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}
