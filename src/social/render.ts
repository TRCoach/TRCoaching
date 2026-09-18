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

export interface RenderedPack {
  configId: string;
  files: string[];
  feedJpg?: string;
  feedWebp?: string;
  reelMp4?: string;
  storyboard?: string;
  frames: string[];
}

export interface RenderedAssets {
  feedJpg: string;
  feedWebp: string;
  reelMp4: string;
  storyboard: string;
  frames: string[];
  configId: string;
}

export interface RenderPackOptions {
  stem: string;
  config?: SocialRenderConfig;
  feedSceneLabel?: string;
  reelSceneLabels?: readonly [string, string, string];
  includeFeed?: boolean;
  includeReel?: boolean;
}

export async function renderAssetPack(outDir: string, options: RenderPackOptions): Promise<RenderedPack> {
  const config = options.config ?? DEFAULT_CONFIG;
  const includeFeed = options.includeFeed !== false;
  const includeReel = options.includeReel !== false;
  mkdirSync(outDir, { recursive: true });

  const files: string[] = [];
  let feedJpg: string | undefined;
  let feedWebp: string | undefined;
  if (includeFeed) {
    const feedSvg = svgFor(FEED_LAYOUT, config, options.feedSceneLabel ?? "SCENE 01");
    feedJpg = join(outDir, `${options.stem}-feed.jpg`);
    feedWebp = join(outDir, `${options.stem}-feed.webp`);
    await sharp(Buffer.from(feedSvg)).jpeg({ quality: 88, chromaSubsampling: "4:2:0" }).toFile(feedJpg);
    await sharp(Buffer.from(feedSvg)).webp({ quality: 88 }).toFile(feedWebp);
    files.push(feedJpg, feedWebp);
  }

  const labels = options.reelSceneLabels ?? (["SCENE 01", "SCENE 02", "SCENE 03"] as const);
  const frameSpecs = includeReel
    ? labels.map((label, index) => ({
        name: `${options.stem === "busy-week" ? "reel" : `${options.stem}-reel`}-scene-0${index + 1}.jpg`,
        label,
      }))
    : [];
  const frames: string[] = [];
  for (const spec of frameSpecs) {
    const path = join(outDir, spec.name);
    const svg = svgFor(REEL_LAYOUT, config, spec.label);
    await sharp(Buffer.from(svg)).jpeg({ quality: 88, chromaSubsampling: "4:2:0" }).toFile(path);
    frames.push(path);
    files.push(path);
  }

  let reelMp4: string | undefined;
  let storyboard: string | undefined;
  if (includeReel) {
    reelMp4 = join(outDir, options.stem === "busy-week" ? "busy-week-reel.mp4" : `${options.stem}-reel.mp4`);
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
    files.push(reelMp4);

    storyboard = join(
      outDir,
      options.stem === "busy-week" ? "busy-week-storyboard.json" : `${options.stem}-storyboard.json`,
    );
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
            file: options.stem === "busy-week" ? "busy-week-reel.mp4" : `${options.stem}-reel.mp4`,
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
    files.push(storyboard);
  }

  return { configId: config.id, files, feedJpg, feedWebp, reelMp4, storyboard, frames };
}

export async function renderBenchmarkAssets(outDir: string, config = DEFAULT_CONFIG): Promise<RenderedAssets> {
  const pack = await renderAssetPack(outDir, { stem: "busy-week", config });
  if (!pack.feedJpg || !pack.feedWebp || !pack.reelMp4 || !pack.storyboard) {
    throw new Error("benchmark pack missing required files");
  }
  return {
    feedJpg: pack.feedJpg,
    feedWebp: pack.feedWebp,
    reelMp4: pack.reelMp4,
    storyboard: pack.storyboard,
    frames: pack.frames,
    configId: pack.configId,
  };
}
