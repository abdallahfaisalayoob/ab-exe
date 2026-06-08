import { Gauge, Pause, Play, RotateCcw, StepForward, Upload } from "lucide-react";
import { useRef } from "react";
import { useSimulatorStore } from "../store/simulatorStore";
import { StatusPill } from "./StatusPill";

export function TopBar() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { status, project, speed, uploadFile, start, pause, reset, step, setSpeed } = useSimulatorStore();
  const simTimeSec = useSimulatorStore((state) => state.simTimeSec);
  const canRun = Boolean(project) && status !== "loading";
  const isRunning = status === "running";
  const progress = project ? Math.min(1, simTimeSec / Math.max(0.001, project.simulation.total_time_sec)) : 0;

  return (
    <header className="border-b border-slate-700/40 bg-machine-950/88">
      <div className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 ${isRunning ? "animate-pulse" : ""}`}>
            <Gauge size={21} />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-normal text-slate-100">Virtual CNC PCB Simulator</h1>
            <p className="text-xs text-slate-400">{project ? project.file_name : "No active job"}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatusPill severity={status === "error" ? "critical" : status === "running" ? "info" : "ok"}>{status.toUpperCase()}</StatusPill>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept=".png,.jpg,.jpeg,.svg,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadFile(file);
              event.currentTarget.value = "";
            }
          }}
        />
        <button
          className="inline-flex h-10 items-center gap-2 rounded border border-slate-600/70 bg-slate-800/70 px-3 text-sm text-slate-100 transition hover:border-cyan-300/60 hover:text-cyan-100"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={16} />
          Upload
        </button>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-emerald-300/40 bg-emerald-300/12 text-emerald-100 transition disabled:opacity-40"
          disabled={!canRun}
          onClick={isRunning ? pause : start}
          title={isRunning ? "Pause" : "Start"}
        >
          {isRunning ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-600/70 bg-slate-800/70 text-slate-100 transition disabled:opacity-40"
          disabled={!canRun}
          onClick={step}
          title="Step"
        >
          <StepForward size={17} />
        </button>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-600/70 bg-slate-800/70 text-slate-100 transition disabled:opacity-40"
          disabled={!project}
          onClick={reset}
          title="Reset"
        >
          <RotateCcw size={17} />
        </button>
        <label className="flex h-10 items-center gap-2 rounded border border-slate-600/70 bg-slate-800/70 px-3 text-xs text-slate-300">
          Speed
          <input
            className="h-1.5 w-28 accent-cyan-300"
            type="range"
            min="0.25"
            max="5"
            step="0.25"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
          <span className="w-9 text-right font-mono text-cyan-100">{speed.toFixed(2)}x</span>
        </label>
        </div>
      </div>
      <div className="h-1 bg-slate-900">
        <div className="h-full bg-cyan-300 transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
      </div>
    </header>
  );
}
