import { useEffect, useMemo, useRef } from "react";
import { useSimulatorStore } from "../store/simulatorStore";
import type { Geometry, Point, TelemetrySample, ToolMove } from "../types/simulator";

function fit(boardWidth: number, boardHeight: number, canvasWidth: number, canvasHeight: number) {
  const padding = 30;
  const scale = Math.min((canvasWidth - padding * 2) / boardWidth, (canvasHeight - padding * 2) / boardHeight);
  const offsetX = (canvasWidth - boardWidth * scale) / 2;
  const offsetY = (canvasHeight - boardHeight * scale) / 2;
  return { scale, offsetX, offsetY };
}

function pt(point: Point, scale: number, offsetX: number, offsetY: number) {
  return {
    x: offsetX + point.x * scale,
    y: offsetY + point.y * scale,
  };
}

function drawPath(ctx: CanvasRenderingContext2D, move: ToolMove, scale: number, offsetX: number, offsetY: number) {
  const start = pt(move.start, scale, offsetX, offsetY);
  const end = pt(move.end, scale, offsetX, offsetY);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = move.mode === "cut" ? "rgba(49, 198, 223, 0.85)" : move.mode === "drill" ? "rgba(224, 168, 58, 0.85)" : "rgba(148, 163, 184, 0.22)";
  ctx.lineWidth = move.mode === "cut" ? 2.5 : 1.1;
  ctx.setLineDash(move.mode === "travel" ? [5, 7] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGeometry(ctx: CanvasRenderingContext2D, geometry: Geometry, scale: number, offsetX: number, offsetY: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const trace of geometry.traces) {
    ctx.beginPath();
    trace.points.forEach((point, index) => {
      const pixel = pt(point, scale, offsetX, offsetY);
      if (index === 0) {
        ctx.moveTo(pixel.x, pixel.y);
      } else {
        ctx.lineTo(pixel.x, pixel.y);
      }
    });
    ctx.strokeStyle = "rgba(224, 168, 58, 0.28)";
    ctx.lineWidth = Math.max(2, trace.width_mm * scale);
    ctx.stroke();
  }

  for (const pad of geometry.pads) {
    const center = pt(pad.center, scale, offsetX, offsetY);
    ctx.beginPath();
    ctx.arc(center.x, center.y, pad.radius_mm * scale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(224, 168, 58, 0.58)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(center.x, center.y, pad.drill_radius_mm * scale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 11, 13, 0.92)";
    ctx.fill();
  }
}

function drawTool(ctx: CanvasRenderingContext2D, frame: TelemetrySample, scale: number, offsetX: number, offsetY: number) {
  const position = pt(frame.position, scale, offsetX, offsetY);
  const active = frame.mode === "cut" || frame.mode === "drill" || frame.mode === "plunge";
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.beginPath();
  ctx.arc(0, 0, active ? 9 : 7, 0, Math.PI * 2);
  ctx.fillStyle = active ? "rgba(49, 198, 223, 0.32)" : "rgba(226, 232, 240, 0.16)";
  ctx.fill();
  ctx.strokeStyle = active ? "#31c6df" : "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(13, 0);
  ctx.moveTo(0, -13);
  ctx.lineTo(0, 13);
  ctx.strokeStyle = "rgba(226, 232, 240, 0.65)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const project = useSimulatorStore((state) => state.project);
  const status = useSimulatorStore((state) => state.status);
  const simTimeSec = useSimulatorStore((state) => state.simTimeSec);
  const advance = useSimulatorStore((state) => state.advance);
  const frame = useSimulatorStore((state) => state.currentFrame());

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      advance(delta);
      raf = requestAnimationFrame(loop);
    };
    if (status === "running") {
      raf = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(raf);
  }, [advance, status]);

  const completedMoves = useMemo(() => {
    if (!project) {
      return [];
    }
    let elapsed = 0;
    return project.toolpath.moves.filter((move) => {
      elapsed += move.duration_ms / 1000;
      return elapsed <= simTimeSec;
    });
  }, [project, simTimeSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#101519";
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!project) {
      ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Load a demo or upload a PCB image", rect.width / 2, rect.height / 2);
      return;
    }

    const geometry = project.geometry;
    const { scale, offsetX, offsetY } = fit(geometry.board.width_mm, geometry.board.height_mm, rect.width, rect.height);
    ctx.fillStyle = "#17452f";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.38)";
    ctx.lineWidth = 1;
    ctx.fillRect(offsetX, offsetY, geometry.board.width_mm * scale, geometry.board.height_mm * scale);
    ctx.strokeRect(offsetX, offsetY, geometry.board.width_mm * scale, geometry.board.height_mm * scale);

    drawGeometry(ctx, geometry, scale, offsetX, offsetY);
    for (const move of project.toolpath.moves) {
      drawPath(ctx, move, scale, offsetX, offsetY);
    }
    for (const move of completedMoves) {
      if (move.mode === "cut" || move.mode === "drill") {
        drawPath(ctx, move, scale, offsetX, offsetY);
      }
    }
    if (frame) {
      drawTool(ctx, frame, scale, offsetX, offsetY);
    }
  }, [project, completedMoves, frame]);

  return (
    <section className="panel machine-grid flex min-h-0 flex-1 flex-col overflow-hidden rounded">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Live CNC Simulation</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {frame ? `X ${frame.position.x.toFixed(2)}  Y ${frame.position.y.toFixed(2)}  Z ${(frame.position.z ?? 0).toFixed(2)}` : "X 0.00  Y 0.00  Z 5.00"}
          </p>
        </div>
        <div className="text-right font-mono text-xs text-slate-400">
          <div>{frame ? frame.mode.toUpperCase() : "IDLE"}</div>
          <div className="text-cyan-100">{frame ? `${frame.feed_rate_mm_min.toFixed(0)} mm/min` : "0 mm/min"}</div>
        </div>
      </div>
      <canvas ref={canvasRef} className="h-full min-h-[360px] w-full flex-1" />
    </section>
  );
}
