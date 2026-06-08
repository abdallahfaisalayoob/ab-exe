import type { Geometry, Point, ProjectResponse, SimulationResult, TelemetrySample, ToolMove, Toolpath } from "../types/simulator";

export interface EngravingSettings {
  text: string;
  fontSizeMm: number;
  intensity: number;
  previewEnabled: boolean;
}

export interface EngravingSegment {
  start: Point;
  end: Point;
}

export interface EngravingPlan {
  id: string;
  text: string;
  origin: Point;
  widthMm: number;
  heightMm: number;
  clearanceMm: number;
  safeScore: number;
  segments: EngravingSegment[];
}

type Segment = [[number, number], [number, number]];

const GLYPHS: Record<string, Segment[]> = {
  A: [
    [[0, 1], [0.5, 0]],
    [[1, 1], [0.5, 0]],
    [[0.22, 0.58], [0.78, 0.58]],
  ],
  B: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.64, 0.05]],
    [[0.64, 0.05], [0.82, 0.24]],
    [[0.82, 0.24], [0.62, 0.46]],
    [[0.62, 0.46], [0, 0.5]],
    [[0, 0.5], [0.68, 0.54]],
    [[0.68, 0.54], [0.86, 0.76]],
    [[0.86, 0.76], [0.62, 0.96]],
    [[0.62, 0.96], [0, 1]],
  ],
  C: [
    [[0.85, 0.12], [0.52, 0]],
    [[0.52, 0], [0.12, 0.16]],
    [[0.12, 0.16], [0, 0.5]],
    [[0, 0.5], [0.12, 0.84]],
    [[0.12, 0.84], [0.52, 1]],
    [[0.52, 1], [0.88, 0.86]],
  ],
  D: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.62, 0.08]],
    [[0.62, 0.08], [0.9, 0.5]],
    [[0.9, 0.5], [0.62, 0.92]],
    [[0.62, 0.92], [0, 1]],
  ],
  E: [
    [[0.85, 0], [0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0.5], [0.68, 0.5]],
    [[0, 1], [0.88, 1]],
  ],
  F: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.88, 0]],
    [[0, 0.5], [0.68, 0.5]],
  ],
  G: [
    [[0.88, 0.16], [0.58, 0]],
    [[0.58, 0], [0.14, 0.12]],
    [[0.14, 0.12], [0, 0.5]],
    [[0, 0.5], [0.14, 0.88]],
    [[0.14, 0.88], [0.58, 1]],
    [[0.58, 1], [0.9, 0.78]],
    [[0.9, 0.78], [0.9, 0.58]],
    [[0.9, 0.58], [0.55, 0.58]],
  ],
  H: [
    [[0, 0], [0, 1]],
    [[1, 0], [1, 1]],
    [[0, 0.5], [1, 0.5]],
  ],
  I: [
    [[0.2, 0], [0.8, 0]],
    [[0.5, 0], [0.5, 1]],
    [[0.2, 1], [0.8, 1]],
  ],
  J: [
    [[0.2, 0], [0.92, 0]],
    [[0.62, 0], [0.62, 0.78]],
    [[0.62, 0.78], [0.42, 1]],
    [[0.42, 1], [0.08, 0.88]],
  ],
  K: [
    [[0, 0], [0, 1]],
    [[0.95, 0], [0, 0.52]],
    [[0, 0.52], [0.98, 1]],
  ],
  L: [
    [[0, 0], [0, 1]],
    [[0, 1], [0.88, 1]],
  ],
  M: [
    [[0, 1], [0, 0]],
    [[0, 0], [0.5, 0.48]],
    [[0.5, 0.48], [1, 0]],
    [[1, 0], [1, 1]],
  ],
  N: [
    [[0, 1], [0, 0]],
    [[0, 0], [1, 1]],
    [[1, 1], [1, 0]],
  ],
  O: [
    [[0.5, 0], [0.88, 0.16]],
    [[0.88, 0.16], [1, 0.5]],
    [[1, 0.5], [0.88, 0.84]],
    [[0.88, 0.84], [0.5, 1]],
    [[0.5, 1], [0.12, 0.84]],
    [[0.12, 0.84], [0, 0.5]],
    [[0, 0.5], [0.12, 0.16]],
    [[0.12, 0.16], [0.5, 0]],
  ],
  P: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.68, 0.06]],
    [[0.68, 0.06], [0.86, 0.28]],
    [[0.86, 0.28], [0.66, 0.5]],
    [[0.66, 0.5], [0, 0.52]],
  ],
  R: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.68, 0.06]],
    [[0.68, 0.06], [0.86, 0.28]],
    [[0.86, 0.28], [0.66, 0.5]],
    [[0.66, 0.5], [0, 0.52]],
    [[0.35, 0.52], [0.92, 1]],
  ],
  S: [
    [[0.88, 0.12], [0.56, 0]],
    [[0.56, 0], [0.12, 0.12]],
    [[0.12, 0.12], [0.08, 0.42]],
    [[0.08, 0.42], [0.78, 0.56]],
    [[0.78, 0.56], [0.9, 0.84]],
    [[0.9, 0.84], [0.52, 1]],
    [[0.52, 1], [0.1, 0.86]],
  ],
  T: [
    [[0, 0], [1, 0]],
    [[0.5, 0], [0.5, 1]],
  ],
  U: [
    [[0, 0], [0, 0.78]],
    [[0, 0.78], [0.22, 1]],
    [[0.22, 1], [0.78, 1]],
    [[0.78, 1], [1, 0.78]],
    [[1, 0.78], [1, 0]],
  ],
  V: [
    [[0, 0], [0.5, 1]],
    [[0.5, 1], [1, 0]],
  ],
  W: [
    [[0, 0], [0.22, 1]],
    [[0.22, 1], [0.5, 0.54]],
    [[0.5, 0.54], [0.78, 1]],
    [[0.78, 1], [1, 0]],
  ],
  X: [
    [[0, 0], [1, 1]],
    [[1, 0], [0, 1]],
  ],
  Y: [
    [[0, 0], [0.5, 0.48]],
    [[1, 0], [0.5, 0.48]],
    [[0.5, 0.48], [0.5, 1]],
  ],
  Z: [
    [[0, 0], [1, 0]],
    [[1, 0], [0, 1]],
    [[0, 1], [1, 1]],
  ],
  "0": [
    [[0.5, 0], [0.9, 0.15]],
    [[0.9, 0.15], [0.9, 0.85]],
    [[0.9, 0.85], [0.5, 1]],
    [[0.5, 1], [0.1, 0.85]],
    [[0.1, 0.85], [0.1, 0.15]],
    [[0.1, 0.15], [0.5, 0]],
  ],
  "1": [
    [[0.5, 0], [0.5, 1]],
    [[0.32, 0.2], [0.5, 0]],
    [[0.28, 1], [0.72, 1]],
  ],
  "2": [
    [[0.12, 0.2], [0.45, 0]],
    [[0.45, 0], [0.88, 0.18]],
    [[0.88, 0.18], [0.1, 1]],
    [[0.1, 1], [0.92, 1]],
  ],
  "3": [
    [[0.1, 0.12], [0.5, 0]],
    [[0.5, 0], [0.88, 0.22]],
    [[0.88, 0.22], [0.52, 0.5]],
    [[0.52, 0.5], [0.9, 0.8]],
    [[0.9, 0.8], [0.5, 1]],
    [[0.5, 1], [0.1, 0.88]],
  ],
  "4": [
    [[0.8, 1], [0.8, 0]],
    [[0.8, 0], [0.08, 0.65]],
    [[0.08, 0.65], [0.95, 0.65]],
  ],
  "5": [
    [[0.88, 0], [0.16, 0]],
    [[0.16, 0], [0.12, 0.46]],
    [[0.12, 0.46], [0.74, 0.48]],
    [[0.74, 0.48], [0.9, 0.8]],
    [[0.9, 0.8], [0.5, 1]],
    [[0.5, 1], [0.1, 0.86]],
  ],
  "6": [
    [[0.82, 0.12], [0.44, 0]],
    [[0.44, 0], [0.1, 0.38]],
    [[0.1, 0.38], [0.18, 0.85]],
    [[0.18, 0.85], [0.52, 1]],
    [[0.52, 1], [0.88, 0.78]],
    [[0.88, 0.78], [0.72, 0.52]],
    [[0.72, 0.52], [0.18, 0.54]],
  ],
  "7": [
    [[0.08, 0], [0.92, 0]],
    [[0.92, 0], [0.32, 1]],
  ],
  "8": [
    [[0.5, 0], [0.85, 0.18]],
    [[0.85, 0.18], [0.62, 0.5]],
    [[0.62, 0.5], [0.88, 0.82]],
    [[0.88, 0.82], [0.5, 1]],
    [[0.5, 1], [0.12, 0.82]],
    [[0.12, 0.82], [0.38, 0.5]],
    [[0.38, 0.5], [0.15, 0.18]],
    [[0.15, 0.18], [0.5, 0]],
    [[0.38, 0.5], [0.62, 0.5]],
  ],
  "9": [
    [[0.82, 0.46], [0.28, 0.46]],
    [[0.28, 0.46], [0.12, 0.22]],
    [[0.12, 0.22], [0.5, 0]],
    [[0.5, 0], [0.86, 0.16]],
    [[0.86, 0.16], [0.9, 0.68]],
    [[0.9, 0.68], [0.52, 1]],
  ],
  "-": [[[0.2, 0.55], [0.8, 0.55]]],
  ".": [[[0.48, 0.95], [0.52, 0.95]]],
};

const FALLBACK: Segment[] = [
  [[0.1, 0.1], [0.9, 0.1]],
  [[0.9, 0.1], [0.9, 0.9]],
  [[0.9, 0.9], [0.1, 0.9]],
  [[0.1, 0.9], [0.1, 0.1]],
];

function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function obstacleRects(geometry: Geometry, clearance: number): Rect[] {
  const rects: Rect[] = [];
  for (const trace of geometry.traces) {
    for (let i = 0; i < trace.points.length - 1; i += 1) {
      const a = trace.points[i];
      const b = trace.points[i + 1];
      const pad = trace.width_mm / 2 + clearance;
      rects.push({
        x: Math.min(a.x, b.x) - pad,
        y: Math.min(a.y, b.y) - pad,
        w: Math.abs(a.x - b.x) + pad * 2,
        h: Math.abs(a.y - b.y) + pad * 2,
      });
    }
  }
  for (const pad of geometry.pads) {
    const r = pad.radius_mm + clearance;
    rects.push({ x: pad.center.x - r, y: pad.center.y - r, w: r * 2, h: r * 2 });
  }
  for (const drill of geometry.drills) {
    const r = drill.radius_mm + clearance;
    rects.push({ x: drill.center.x - r, y: drill.center.y - r, w: r * 2, h: r * 2 });
  }
  return rects;
}

function textDimensions(text: string, fontSizeMm: number) {
  const charWidth = fontSizeMm * 0.62;
  const spacing = fontSizeMm * 0.18;
  const count = Math.max(1, text.length);
  return {
    width: count * charWidth + (count - 1) * spacing,
    height: fontSizeMm,
    charWidth,
    spacing,
  };
}

export function planEngraving(geometry: Geometry, settings: EngravingSettings): EngravingPlan | null {
  const text = settings.text.trim().toUpperCase();
  if (!text) {
    return null;
  }
  const dims = textDimensions(text, settings.fontSizeMm);
  const clearance = Math.max(1.6, settings.fontSizeMm * 0.18);
  const obstacles = obstacleRects(geometry, clearance);
  const margin = 4;
  if (dims.width + margin * 2 > geometry.board.width_mm || dims.height + margin * 2 > geometry.board.height_mm) {
    return null;
  }

  let best: { rect: Rect; score: number } | null = null;
  const step = Math.max(1.4, settings.fontSizeMm * 0.22);
  for (let y = margin; y <= geometry.board.height_mm - dims.height - margin; y += step) {
    for (let x = margin; x <= geometry.board.width_mm - dims.width - margin; x += step) {
      const rect = { x, y, w: dims.width, h: dims.height };
      if (obstacles.some((obstacle) => rectsIntersect(rect, obstacle))) {
        continue;
      }
      const center = { x: x + dims.width / 2, y: y + dims.height / 2 };
      const clearanceScore = obstacles.reduce((score, obstacle) => {
        const ox = Math.max(obstacle.x, Math.min(center.x, obstacle.x + obstacle.w));
        const oy = Math.max(obstacle.y, Math.min(center.y, obstacle.y + obstacle.h));
        return Math.min(score, Math.hypot(center.x - ox, center.y - oy));
      }, 40);
      const edgeScore = Math.min(x, y, geometry.board.width_mm - x - dims.width, geometry.board.height_mm - y - dims.height);
      const score = clearanceScore * 1.8 + edgeScore + x * 0.02 + y * 0.01;
      if (!best || score > best.score) {
        best = { rect, score };
      }
    }
  }

  if (!best) {
    return null;
  }

  const segments = vectorizeText(text, settings.fontSizeMm, { x: best.rect.x, y: best.rect.y });
  return {
    id: `${text}-${settings.fontSizeMm}-${Math.round(best.rect.x * 10)}-${Math.round(best.rect.y * 10)}`,
    text,
    origin: { x: best.rect.x, y: best.rect.y },
    widthMm: dims.width,
    heightMm: dims.height,
    clearanceMm: clearance,
    safeScore: Math.round(best.score * 10) / 10,
    segments,
  };
}

export function vectorizeText(text: string, fontSizeMm: number, origin: Point): EngravingSegment[] {
  const clean = text.trim().toUpperCase();
  const dims = textDimensions(clean, fontSizeMm);
  const segments: EngravingSegment[] = [];
  let cursor = origin.x;

  for (const char of clean) {
    if (char === " ") {
      cursor += dims.charWidth + dims.spacing;
      continue;
    }
    const glyph = GLYPHS[char] ?? FALLBACK;
    for (const [a, b] of glyph) {
      segments.push({
        start: { x: cursor + a[0] * dims.charWidth, y: origin.y + a[1] * dims.height },
        end: { x: cursor + b[0] * dims.charWidth, y: origin.y + b[1] * dims.height },
      });
    }
    cursor += dims.charWidth + dims.spacing;
  }

  return segments;
}

function distance(a: Point, b: Point, includeZ = false) {
  const dz = includeZ ? (a.z ?? 0) - (b.z ?? 0) : 0;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + dz ** 2);
}

function moveDuration(distanceMm: number, feedMmMin: number) {
  return (distanceMm / Math.max(1, feedMmMin)) * 60_000;
}

function addMove(
  moves: ToolMove[],
  mode: ToolMove["mode"],
  start: Point,
  end: Point,
  feed: number,
  intensity: number,
  sourceId: string
) {
  const distanceMm = distance(start, end, true);
  if (distanceMm < 0.001) {
    return end;
  }
  const adaptive = mode === "engrave" ? feed * (1 - intensity * 0.18) : feed;
  const gcodeMode = mode === "travel" || mode === "retract" ? "G0" : "G1";
  moves.push({
    id: `engrave-${moves.length + 1}`,
    mode,
    start,
    end,
    feed_rate_mm_min: feed,
    adaptive_feed_rate_mm_min: adaptive,
    laser_on: mode === "engrave",
    drill_on: false,
    duration_ms: moveDuration(distanceMm, adaptive),
    distance_mm: distanceMm,
    load_factor: mode === "engrave" ? 0.34 + intensity * 0.24 : 0.18,
    source_id: sourceId,
    spindle_rpm: 0,
    bit_diameter_mm: 0.18,
    compensation_offset_mm: 0,
    chip_load_mm: 0,
    corner_slowdown: false,
    gcode: `${gcodeMode} X${end.x.toFixed(3)} Y${end.y.toFixed(3)} Z${(end.z ?? 0).toFixed(3)} F${adaptive.toFixed(1)}`,
  });
  return end;
}

export function engravingMoves(plan: EngravingPlan, settings: EngravingSettings): ToolMove[] {
  const moves: ToolMove[] = [];
  const safeZ = 5;
  const laserZ = -0.02 - settings.intensity * 0.12;
  let current: Point = { x: 0, y: 0, z: safeZ };
  const feed = 520 - settings.intensity * 170;

  for (const segment of plan.segments) {
    const startSafe = { x: segment.start.x, y: segment.start.y, z: safeZ };
    current = addMove(moves, "travel", current, startSafe, 2200, settings.intensity, plan.id);
    const startDown = { x: segment.start.x, y: segment.start.y, z: laserZ };
    current = addMove(moves, "plunge", current, startDown, 420, settings.intensity, plan.id);
    const endDown = { x: segment.end.x, y: segment.end.y, z: laserZ };
    current = addMove(moves, "engrave", current, endDown, feed, settings.intensity, plan.id);
    const retract = { x: endDown.x, y: endDown.y, z: safeZ };
    current = addMove(moves, "retract", current, retract, 900, settings.intensity, plan.id);
  }

  return moves;
}

function simulateEngraving(existing: SimulationResult, moves: ToolMove[]): SimulationResult {
  const frames: TelemetrySample[] = [...existing.frames];
  const startTime = frames.length ? frames[frames.length - 1].t_sec : 0;
  let elapsed = startTime;
  let temperature = frames.length ? frames[frames.length - 1].temperature_c : 34;

  for (const move of moves) {
    const duration = Math.max(0.04, move.duration_ms / 1000);
    const samples = Math.max(2, Math.min(14, Math.ceil(duration * 8)));
    for (let index = 0; index < samples; index += 1) {
      const ratio = index / Math.max(1, samples - 1);
      const t = elapsed + duration * ratio;
      const load = move.mode === "engrave" ? 38 + move.load_factor * 30 : move.mode === "plunge" ? 42 : 18;
      temperature += 0.006 + load * 0.0003;
      frames.push({
        t_sec: t,
        progress: 0,
        position: {
          x: move.start.x + (move.end.x - move.start.x) * ratio,
          y: move.start.y + (move.end.y - move.start.y) * ratio,
          z: (move.start.z ?? 0) + ((move.end.z ?? 0) - (move.start.z ?? 0)) * ratio,
        },
        mode: move.mode,
        feed_rate_mm_min: move.adaptive_feed_rate_mm_min,
        vibration: move.mode === "engrave" ? 0.28 + move.load_factor * 0.08 : 0.16,
        temperature_c: temperature,
        motor_load_pct: load,
        z_wear_score: frames.length ? frames[frames.length - 1].z_wear_score : 0.22,
        spindle_rpm: move.spindle_rpm ?? 0,
        chip_load_mm: move.chip_load_mm ?? 0,
        feed_override_pct: (move.adaptive_feed_rate_mm_min / Math.max(1, move.feed_rate_mm_min)) * 100,
      });
    }
    elapsed += duration;
  }

  const total = Math.max(0.001, elapsed);
  return {
    total_time_sec: total,
    frames: frames.map((frame) => ({ ...frame, progress: Math.min(1, frame.t_sec / total) })),
  };
}

export function appendEngravingToProject(project: ProjectResponse, plan: EngravingPlan, settings: EngravingSettings): ProjectResponse {
  const moves = engravingMoves(plan, settings);
  const toolpath: Toolpath = {
    ...project.toolpath,
    moves: [...project.toolpath.moves, ...moves],
    total_travel_mm: project.toolpath.total_travel_mm + moves.filter((move) => move.mode !== "engrave").reduce((sum, move) => sum + move.distance_mm, 0),
    cutting_mm: project.toolpath.cutting_mm + moves.filter((move) => move.mode === "engrave").reduce((sum, move) => sum + move.distance_mm, 0),
    estimated_time_sec: project.toolpath.estimated_time_sec + moves.reduce((sum, move) => sum + move.duration_ms / 1000, 0),
    gcode: [...project.toolpath.gcode, `(LASER_ENGRAVE_TEXT=${plan.text})`, ...moves.map((move) => move.gcode), "M5"],
  };

  return {
    ...project,
    toolpath,
    simulation: simulateEngraving(project.simulation, moves),
    logs: [
      ...project.logs,
      `Laser engraving placed "${plan.text}" at X${plan.origin.x.toFixed(1)} Y${plan.origin.y.toFixed(1)} with ${plan.clearanceMm.toFixed(1)} mm clearance.`,
      `Generated ${moves.length} laser engraving CNC moves from single-line SVG stroke vectors.`,
    ],
  };
}
