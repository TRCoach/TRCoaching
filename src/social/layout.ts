import type { LayoutSpec, Rect } from "../types.js";

export type { LayoutSpec, Rect };

export const BENCHMARK_COPY = {
  headline: "Busy week?",
  body: "Make the next step obvious.",
  disclaimer: "BENCHMARK ONLY — not production-approved",
};

export const BENCHMARK_CONFIG_ID = "scene-benchmark-v1";

export const FEED_LAYOUT: LayoutSpec = {
  width: 1080,
  height: 1350,
  safe: { top: 80, right: 80, bottom: 80, left: 80 },
  boxes: [
    { id: "title", x: 80, y: 200, w: 920, h: 180 },
    { id: "body", x: 80, y: 400, w: 920, h: 160 },
    { id: "scene", x: 180, y: 620, w: 720, h: 420 },
    { id: "footer", x: 80, y: 1180, w: 920, h: 80 },
  ],
};

export const REEL_LAYOUT: LayoutSpec = {
  width: 1080,
  height: 1920,
  safe: { top: 160, right: 80, bottom: 160, left: 80 },
  boxes: [
    { id: "title", x: 80, y: 280, w: 920, h: 220 },
    { id: "body", x: 80, y: 540, w: 920, h: 200 },
    { id: "scene", x: 160, y: 820, w: 760, h: 640 },
    { id: "footer", x: 80, y: 1640, w: 920, h: 100 },
  ],
};

function right(box: Rect): number {
  return box.x + box.w;
}
function bottom(box: Rect): number {
  return box.y + box.h;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
}

export function layoutOverlaps(layout: LayoutSpec): string[] {
  const hits: string[] = [];
  for (let i = 0; i < layout.boxes.length; i += 1) {
    for (let j = i + 1; j < layout.boxes.length; j += 1) {
      const a = layout.boxes[i]!;
      const b = layout.boxes[j]!;
      if (overlaps(a, b)) hits.push(`${a.id}/${b.id}`);
    }
  }
  return hits;
}

export function boxesWithinSafe(layout: LayoutSpec): boolean {
  const { safe, width, height } = layout;
  return layout.boxes.every(
    (box) =>
      box.x >= safe.left &&
      box.y >= safe.top &&
      right(box) <= width - safe.right &&
      bottom(box) <= height - safe.bottom,
  );
}
