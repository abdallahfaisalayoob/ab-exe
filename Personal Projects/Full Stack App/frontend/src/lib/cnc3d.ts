import type { BoardBounds, Point, TelemetrySample, ToolMove } from "../types/simulator";

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface BoardScale {
  scale: number;
  width: number;
  depth: number;
  thickness: number;
  topY: number;
}

export interface ExecutedMoveSegment {
  id: string;
  mode: ToolMove["mode"];
  start: Point;
  end: Point;
  sourceId?: string | null;
  progress: number;
}

export function boardScale(board: BoardBounds): BoardScale {
  const scale = 10 / Math.max(board.width_mm, board.height_mm);
  return {
    scale,
    width: board.width_mm * scale,
    depth: board.height_mm * scale,
    thickness: 0.16,
    topY: 0,
  };
}

export function toWorld(point: Point, board: BoardBounds, zOffsetMm = 0): WorldPoint {
  const mapped = boardScale(board);
  return {
    x: (point.x - board.width_mm / 2) * mapped.scale,
    y: mapped.topY + ((point.z ?? 0) + zOffsetMm) * mapped.scale,
    z: (point.y - board.height_mm / 2) * mapped.scale,
  };
}

export function sampleTelemetry(frames: TelemetrySample[], timeSec: number): TelemetrySample | null {
  if (!frames.length) {
    return null;
  }
  if (timeSec <= frames[0].t_sec) {
    return frames[0];
  }
  const last = frames[frames.length - 1];
  if (timeSec >= last.t_sec) {
    return last;
  }

  let low = 0;
  let high = frames.length - 1;
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].t_sec <= timeSec) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const a = frames[low];
  const b = frames[high];
  const span = Math.max(0.001, b.t_sec - a.t_sec);
  const t = Math.max(0, Math.min(1, (timeSec - a.t_sec) / span));
  return {
    ...b,
    t_sec: timeSec,
    progress: a.progress + (b.progress - a.progress) * t,
    position: {
      x: a.position.x + (b.position.x - a.position.x) * t,
      y: a.position.y + (b.position.y - a.position.y) * t,
      z: (a.position.z ?? 0) + ((b.position.z ?? 0) - (a.position.z ?? 0)) * t,
    },
    feed_rate_mm_min: a.feed_rate_mm_min + (b.feed_rate_mm_min - a.feed_rate_mm_min) * t,
    vibration: a.vibration + (b.vibration - a.vibration) * t,
    temperature_c: a.temperature_c + (b.temperature_c - a.temperature_c) * t,
    motor_load_pct: a.motor_load_pct + (b.motor_load_pct - a.motor_load_pct) * t,
    z_wear_score: a.z_wear_score + (b.z_wear_score - a.z_wear_score) * t,
  };
}

export function executedSegments(moves: ToolMove[], timeSec: number): ExecutedMoveSegment[] {
  const segments: ExecutedMoveSegment[] = [];
  let elapsed = 0;

  for (const move of moves) {
    const duration = Math.max(0.001, move.duration_ms / 1000);
    const startTime = elapsed;
    const endTime = elapsed + duration;
    elapsed = endTime;

    if (timeSec < startTime) {
      break;
    }

    const progress = Math.max(0, Math.min(1, (timeSec - startTime) / duration));
    const segmentEnd =
      progress >= 1
        ? move.end
        : {
            x: move.start.x + (move.end.x - move.start.x) * progress,
            y: move.start.y + (move.end.y - move.start.y) * progress,
            z: (move.start.z ?? 0) + ((move.end.z ?? 0) - (move.start.z ?? 0)) * progress,
          };

    segments.push({
      id: move.id,
      mode: move.mode,
      start: move.start,
      end: segmentEnd,
      sourceId: move.source_id,
      progress,
    });

    if (progress < 1) {
      break;
    }
  }

  return segments.filter((segment) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const dz = (segment.end.z ?? 0) - (segment.start.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.001;
  });
}
