import { Box, CircleDot, Orbit, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sampleTelemetry } from "../lib/cnc3d";
import { useSimulatorStore } from "../store/simulatorStore";
import { CNCScene, type CameraPreset } from "./cnc3d/CNCScene";

export function Simulation3DPanel() {
  const project = useSimulatorStore((state) => state.project);
  const status = useSimulatorStore((state) => state.status);
  const simTimeSec = useSimulatorStore((state) => state.simTimeSec);
  const advance = useSimulatorStore((state) => state.advance);
  const bitDiameterMm = useSimulatorStore((state) => state.bitDiameterMm);
  const engravingPlan = useSimulatorStore((state) => state.engravingPlan);
  const engravingPreview = useSimulatorStore((state) => state.engravingSettings.previewEnabled);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("iso");
  const [cameraPresetSignal, setCameraPresetSignal] = useState(0);

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

  const frame = useMemo(() => sampleTelemetry(project?.simulation.frames ?? [], simTimeSec), [project?.simulation.frames, simTimeSec]);
  const setView = (preset: CameraPreset) => {
    setCameraPreset(preset);
    setCameraPresetSignal((value) => value + 1);
  };

  return (
    <section className="panel machine-grid flex min-h-0 flex-1 flex-col overflow-hidden rounded">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Live 3D CNC Simulation</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {frame ? `X ${frame.position.x.toFixed(2)}  Y ${frame.position.y.toFixed(2)}  Z ${(frame.position.z ?? 0).toFixed(2)}` : "X 0.00  Y 0.00  Z 5.00"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right font-mono text-xs text-slate-400">
            <div>{frame ? frame.mode.toUpperCase() : "IDLE"}</div>
            <div className="text-cyan-100">{frame ? `${frame.feed_rate_mm_min.toFixed(0)} mm/min` : "0 mm/min"}</div>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded border border-slate-600/70 bg-slate-800/70 px-3 text-xs text-slate-100 transition hover:border-cyan-300/60 disabled:opacity-40"
            disabled={!project}
            onClick={() => setResetViewSignal((value) => value + 1)}
            title="Reset camera view"
          >
            <RotateCcw size={14} />
            View
          </button>
          <div className="flex rounded border border-slate-700/70 bg-slate-900/70 p-1">
            <button className="h-7 rounded px-2 text-xs text-slate-200 hover:bg-slate-700/70" disabled={!project} onClick={() => setView("top")} title="Top view">
              <Square size={14} />
            </button>
            <button className="h-7 rounded px-2 text-xs text-slate-200 hover:bg-slate-700/70" disabled={!project} onClick={() => setView("iso")} title="Isometric view">
              <Box size={14} />
            </button>
            <button className="h-7 rounded px-2 text-xs text-slate-200 hover:bg-slate-700/70" disabled={!project} onClick={() => setView("front")} title="Front view">
              <CircleDot size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="relative min-h-[420px] flex-1">
        {project ? (
          <CNCScene
            geometry={project.geometry}
            toolpath={project.toolpath}
            frame={frame}
            simTimeSec={simTimeSec}
            resetViewSignal={resetViewSignal}
            cameraPreset={cameraPreset}
            cameraPresetSignal={cameraPresetSignal}
            bitDiameterMm={bitDiameterMm}
            engravingPlan={engravingPlan}
            showEngravingPreview={engravingPreview}
          />
        ) : (
          <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-slate-600">
            Load a demo or upload a PCB image
          </div>
        )}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded border border-slate-700/60 bg-slate-950/65 px-3 py-2 text-xs text-slate-400">
          <Orbit size={14} className="text-cyan-100" />
          Drag to rotate. Scroll to zoom.
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 rounded border border-slate-700/60 bg-slate-950/65 px-3 py-2 font-mono text-xs text-slate-300">
          white dashed travel | red cut | blue drill | amber engraving
        </div>
      </div>
    </section>
  );
}
