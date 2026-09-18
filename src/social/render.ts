import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import type { LayoutSpec, SocialRenderConfig } from "../types.js";
import { BENCHMARK_CONFIG_ID, BENCHMARK_COPY, FEED_LAYOUT, REEL_LAYOUT } from "./layout.js";

export const DEFAULT_CONFIG: SocialRenderConfig = {
  id: BENCHMARK_CONFIG_ID,
  copy: BENCHMARK_COPY,
  palette: {
    background: "#F4F1EA",
    ink: "#1A1A1A",
    accent: "#C45C26",
    muted: "#6B6560",
  },
};

function svgFor(layout: LayoutSpec, config: SocialRenderConfig, sceneLabel: string): string {
  const title = layout.boxes.find((b) => b.id === "title")!;
  const body = layout.boxes.find((b) => b.id === "body")!;
  const scene = layout.boxes.find((b) => b.id === "scene")!;
  const footer = layout.boxes.find((b) => b.id === "footer")!;
  const { palette, copy } = config;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
  <rect width="100%" height="100%" fill="${palette.background}"/>
  <rect x="${scene.x}" y="${scene.y}" width="${scene.w}" height="${scene.h}" rx="28" fill="${palette.accent}"/>
  <text x="${title.x}" y="${title.y + 110}" fill="${palette.ink}" font-family="DejaVu Sans, Arial, sans-serif" font-size="72" font-weight="700">${escapeXml(copy.headline)}</text>
  <text x="${body.x}" y="${body.y + 90}" fill="${palette.ink}" font-family="DejaVu Sans, Arial, sans-serif" font-size="42">${escapeXml(copy.body)}</text>
  <text x="${scene.x + 40}" y="${scene.y + 80}" fill="${palette.background}" font-family="DejaVu Sans, Arial, sans-serif" font-size="28">${escapeXml(sceneLabel)}</text>
  <text x="${footer.x}" y="${footer.y + 50}" fill="${palette.muted}" font-family="DejaVu Sans, Arial, sans-serif" font-size="26">${escapeXml(copy.disclaimer)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface RenderedAssets {
  feedJpg: string;
  feedWebp: string;
  reelMp4: string;
  storyboard: string;
  frames: string[];
  configId: string;
}

export async function renderBenchmarkAssets(outDir: string, config = DEFAULT_CONFIG): Promise<RenderedAssets> {
  mkdirSync(outDir, { recursive: true });
  const feedSvg = svgFor(FEED_LAYOUT, config, "SCENE 01");
  const feedJpg = join(outDir, "busy-week-feed.jpg");
  const feedWebp = join(outDir, "busy-week-feed.webp");
  await sharp(Buffer.from(feedSvg)).jpeg({ quality: 88, chromaSubsampling: "4:2:0" }).toFile(feedJpg);
  await sharp(Buffer.from(feedSvg)).webp({ quality: 88 }).toFile(feedWebp);

  const frameSpecs = [
    { name: "reel-scene-01.jpg", label: "SCENE 01" },
    { name: "reel-scene-02.jpg", label: "SCENE 02" },
    { name: "reel-scene-03.jpg", label: "SCENE 03" },
  ];
  const frames: string[] = [];
  for (const spec of frameSpecs) {
    const path = join(outDir, spec.name);
    const svg = svgFor(REEL_LAYOUT, config, spec.label);
    await sharp(Buffer.from(svg)).jpeg({ quality: 88, chromaSubsampling: "4:2:0" }).toFile(path);
    frames.push(path);
  }

  const reelMp4 = join(outDir, "busy-week-reel.mp4");
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-t",
      "1",
      "-i",
      frames[0]!,
      "-loop",
      "1",
      "-t",
      "1",
      "-i",
      frames[1]!,
      "-loop",
      "1",
      "-t",
      "1",
      "-i",
      frames[2]!,
      "-filter_complex",
      "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      reelMp4,
    ],
    { encoding: "utf8" },
  );
  if (ffmpeg.status !== 0) {
    throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout || "unknown"}`);
  }

  const storyboard = join(outDir, "busy-week-storyboard.json");
  writeFileSync(
    storyboard,
    `${JSON.stringify(
      {
        kind: "deterministic_storyboard",
        config_id: config.id,
        copy: config.copy,
        frames: frameSpecs.map((spec, index) => ({
          index,
          file: spec.name,
          duration_seconds: 1,
          label: spec.label,
        })),
        video: {
          file: "busy-week-reel.mp4",
          width: 1080,
          height: 1920,
          codec: "h264",
          audio: "none",
          note: "H.264 checksums may vary across ffmpeg builds; storyboard JSON and source frames are the deterministic video-equivalent.",
        },
        provenance: {
          generator: "tr-control-plane/social-render",
          source: "code",
          external_media: false,
          paid_assets: false,
          music: false,
        },
      },
      null,
      2,
    )}\n`,
  );

  return { feedJpg, feedWebp, reelMp4, storyboard, frames, configId: config.id };
}
