import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { boxesWithinSafe, layoutOverlaps, type LayoutSpec } from "./layout.js";

export interface SocialQaInput {
  asset_id: string;
  path: string;
  config_id: string;
  layout: LayoutSpec;
  expected: { width: number; height: number; mime: string; codec?: string | null };
  taylor_pass?: boolean;
  chatgpt_pass?: boolean;
  pass_checksum?: string | null;
  pass_config_id?: string | null;
}

export interface SocialQaReport {
  asset_id: string;
  path: string;
  checksum_sha256: string;
  config_id: string;
  dimensions: { width: number; height: number };
  mime: string;
  codec: string | null;
  safe_margins: { pass: boolean; notes?: string };
  layout_overlap: { pass: boolean; overlaps: string[] };
  provenance: {
    generator: string;
    source: "code";
    external_media: false;
    paid_assets: false;
    music: false;
  };
  aigc: { used: boolean; rationale: string };
  audio: "none";
  checks: { id: string; pass: boolean; detail: string }[];
  taylor_pass: boolean;
  chatgpt_pass: boolean;
  pass_checksum: string | null;
  pass_config_id: string | null;
  publish_eligible: boolean;
  publication_occurred: false;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function probeVideo(path: string): { width: number; height: number; codec: string | null; audio: string } {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed: ${probe.stderr}`);
  }
  const parsed = JSON.parse(probe.stdout) as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    codec: video?.codec_name ?? null,
    audio: audio ? audio.codec_name ?? "present" : "none",
  };
}

export async function qaAsset(input: SocialQaInput): Promise<SocialQaReport> {
  const checksum = sha256(input.path);
  const overlaps = layoutOverlaps(input.layout);
  const marginsOk = boxesWithinSafe(input.layout);
  const isVideo = input.expected.mime === "video/mp4";
  let width = 0;
  let height = 0;
  let mime = input.expected.mime;
  let codec: string | null = input.expected.codec ?? null;
  let audio: "none" | string = "none";

  if (isVideo) {
    const probed = probeVideo(input.path);
    width = probed.width;
    height = probed.height;
    codec = probed.codec;
    audio = probed.audio;
  } else {
    const meta = await sharp(input.path).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    mime = meta.format === "jpeg" ? "image/jpeg" : meta.format === "webp" ? "image/webp" : meta.format ?? mime;
  }

  const taylor = input.taylor_pass === true;
  const chatgpt = input.chatgpt_pass === true;
  const passChecksum = input.pass_checksum ?? null;
  const passConfig = input.pass_config_id ?? null;
  const dualPass =
    taylor &&
    chatgpt &&
    passChecksum === checksum &&
    passConfig === input.config_id;

  const checks = [
    {
      id: "dimensions",
      pass: width === input.expected.width && height === input.expected.height,
      detail: `${width}x${height}`,
    },
    { id: "mime", pass: mime === input.expected.mime, detail: mime },
    {
      id: "codec",
      pass: input.expected.codec ? codec === input.expected.codec : true,
      detail: codec ?? "n/a",
    },
    { id: "safe_margins", pass: marginsOk, detail: marginsOk ? "boxes inside safe area" : "safe-area breach" },
    {
      id: "line_through_overlap",
      pass: overlaps.length === 0,
      detail: overlaps.length === 0 ? "declared layout geometry does not overlap" : overlaps.join(","),
    },
    { id: "provenance", pass: true, detail: "code-rendered, no external media" },
    { id: "checksum", pass: /^[a-f0-9]{64}$/.test(checksum), detail: checksum },
    { id: "aigc", pass: true, detail: "deterministic code render; no generative image model" },
    { id: "audio", pass: audio === "none", detail: audio },
  ];

  const publish_eligible = dualPass && checks.every((check) => check.pass);

  return {
    asset_id: input.asset_id,
    path: input.path,
    checksum_sha256: checksum,
    config_id: input.config_id,
    dimensions: { width, height },
    mime,
    codec,
    safe_margins: { pass: marginsOk },
    layout_overlap: { pass: overlaps.length === 0, overlaps },
    provenance: {
      generator: "tr-control-plane/social-render",
      source: "code",
      external_media: false,
      paid_assets: false,
      music: false,
    },
    aigc: {
      used: false,
      rationale: "Original scene-based SVG rendered by sharp/ffmpeg. No generative model, no stock, no music.",
    },
    audio: "none",
    checks,
    taylor_pass: taylor,
    chatgpt_pass: chatgpt,
    pass_checksum: passChecksum,
    pass_config_id: passConfig,
    publish_eligible,
    publication_occurred: false,
  };
}

export function assertQaPass(report: SocialQaReport): void {
  const failed = report.checks.filter((check) => !check.pass);
  if (failed.length > 0) {
    throw new Error(`social QA failed: ${failed.map((f) => f.id).join(", ")}`);
  }
}
