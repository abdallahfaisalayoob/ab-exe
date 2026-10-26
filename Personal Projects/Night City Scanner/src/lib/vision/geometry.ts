import type { Point, Quad } from '../../types/models';

/** Order four arbitrary points as top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(pts: Point[]): Quad {
  if (pts.length !== 4) throw new Error('orderCorners needs exactly 4 points');
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  // Sort by angle around the centroid (clockwise in screen coordinates, starting at -135°).
  const sorted = pts
    .map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((u, v) => u.a - v.a)
    .map((o) => o.p);
  // Start from the point with the smallest x+y (top-left).
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  const q = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  return [q[0], q[1], q[2], q[3]];
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-12) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Output size of the flattened page in pixels: the longest opposing edges of
 * the quad measured in source pixels, scaled down to fit `maxLong`.
 */
export function warpSize(q: Quad, imgW: number, imgH: number, maxLong: number): { width: number; height: number } {
  const px = q.map((p) => ({ x: p.x * imgW, y: p.y * imgH })) as Quad;
  let w = Math.max(dist(px[0], px[1]), dist(px[3], px[2]));
  let h = Math.max(dist(px[0], px[3]), dist(px[1], px[2]));
  const scale = Math.min(1, maxLong / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  return { width: w, height: h };
}

/** Mean corner displacement relative to the unit diagonal — used for stability checks. */
export function quadDistance(a: Quad, b: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += dist(a[i], b[i]);
  return s / 4 / Math.SQRT2;
}

/** Largest single-corner displacement (normalized units) — strict steadiness measure. */
export function maxCornerShift(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, dist(a[i], b[i]));
  return m;
}

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function insetQuad(inset: number): Quad {
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 1 - inset },
    { x: inset, y: 1 - inset },
  ];
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function clampQuad(q: Quad): Quad {
  return q.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })) as Quad;
}

/** A quad is usable if it is convex and covers a meaningful part of the image. */
export function isUsableQuad(q: Quad | null | undefined, minArea = 0.04): q is Quad {
  return !!q && q.length === 4 && isConvex(q) && quadArea(q) >= minArea;
}

/** Whether a quad is (almost) the whole frame, i.e. cropping would change nothing. */
export function isFullFrame(q: Quad, tol = 0.004): boolean {
  return quadDistance(q, FULL_QUAD) < tol;
}
