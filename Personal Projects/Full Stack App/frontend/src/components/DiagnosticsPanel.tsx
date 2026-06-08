import { Activity, AlertTriangle, BrainCircuit, Thermometer, Wrench } from "lucide-react";
import { useSimulatorStore } from "../store/simulatorStore";
import type { Diagnostic, TelemetrySample } from "../types/simulator";
import { StatusPill } from "./StatusPill";

function iconFor(module: Diagnostic["module"]) {
  if (module === "maintenance") {
    return <Wrench size={16} />;
  }
  if (module === "optimization") {
    return <Activity size={16} />;
  }
  return <AlertTriangle size={16} />;
}

function currentFrame(): TelemetrySample | null {
  return useSimulatorStore.getState().currentFrame();
}

export function DiagnosticsPanel() {
  const project = useSimulatorStore((state) => state.project);
  const simTimeSec = useSimulatorStore((state) => state.simTimeSec);
  const frame = currentFrame();
  const diagnostics = project?.diagnostics ?? [];
  const logs = project?.logs ?? [];
  const history = (project?.simulation.frames ?? []).filter((sample) => sample.t_sec <= simTimeSec).slice(-48);

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      <section className="panel rounded">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Machine Status</h2>
            <p className="mt-1 font-mono text-xs text-slate-500">T {simTimeSec.toFixed(2)} s</p>
          </div>
          <Thermometer size={19} className="text-cyan-100" />
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          <Metric label="Temp" value={frame ? `${frame.temperature_c.toFixed(1)} C` : "32.0 C"} />
          <Metric label="Load" value={frame ? `${frame.motor_load_pct.toFixed(0)}%` : "0%"} />
          <Metric label="Vibration" value={frame ? frame.vibration.toFixed(2) : "0.00"} />
          <Metric label="Z wear" value={frame ? frame.z_wear_score.toFixed(2) : "0.18"} />
          <Metric label="RPM" value={frame ? `${(frame.spindle_rpm ?? 0).toFixed(0)}` : "0"} />
          <Metric label="Chip load" value={frame ? `${(frame.chip_load_mm ?? 0).toFixed(4)} mm` : "0.0000 mm"} />
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-slate-700/40 p-3">
          <Sparkline label="Temp" values={history.map((sample) => sample.temperature_c)} color="#31c6df" />
          <Sparkline label="Load" values={history.map((sample) => sample.motor_load_pct)} color="#e0a83a" />
          <Sparkline label="Vibe" values={history.map((sample) => sample.vibration)} color="#f05252" />
        </div>
      </section>

      <section className="panel min-h-0 flex-1 overflow-hidden rounded">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">AI Diagnostics</h2>
            <p className="mt-1 text-xs text-slate-500">Maintenance, optimization, faults</p>
          </div>
          <BrainCircuit size={19} className="text-cyan-100" />
        </div>
        <div className="scrollbar-thin max-h-[32vh] overflow-auto p-3">
          {diagnostics.length ? (
            <div className="space-y-2">
              {diagnostics.map((diagnostic) => (
                <article key={diagnostic.id} className="rounded border border-slate-700/70 bg-slate-950/45 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                      <span className="text-cyan-100">{iconFor(diagnostic.module)}</span>
                      {diagnostic.title}
                    </div>
                    <StatusPill severity={diagnostic.severity}>{Math.round(diagnostic.confidence * 100)}%</StatusPill>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{diagnostic.message}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-slate-600">No diagnostics</div>
          )}
        </div>
      </section>

      <section className="panel min-h-0 overflow-hidden rounded">
        <div className="border-b border-slate-700/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Logs</h2>
        </div>
        <div className="scrollbar-thin max-h-40 overflow-auto p-3 font-mono text-xs leading-5 text-slate-400">
          {logs.length ? logs.map((log, index) => <LogLine key={`${log}-${index}`} log={log} />) : <div>&gt; Waiting for job</div>}
        </div>
      </section>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-700/70 bg-slate-950/45 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm text-slate-100">{value}</div>
    </div>
  );
}

function Sparkline({ label, values, color }: { label: string; values: number[]; color: string }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = Math.max(0.001, max - min);
  const points = values.length
    ? values
        .map((value, index) => {
          const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
          const y = 28 - ((value - min) / span) * 24;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : "";
  return (
    <div className="rounded border border-slate-700/70 bg-slate-950/45 px-2 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <svg viewBox="0 0 100 30" className="h-8 w-full overflow-visible">
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function LogLine({ log }: { log: string }) {
  const color = log.toLowerCase().includes("fault")
    ? "text-red-200"
    : log.toLowerCase().includes("adaptive")
      ? "text-cyan-200"
      : log.toLowerCase().includes("laser")
        ? "text-amber-200"
        : "text-slate-400";
  return <div className={color}>{`> ${log}`}</div>;
}
