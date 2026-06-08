import { useMemo } from "react";
import { useSimulatorStore } from "../store/simulatorStore";

export function Timeline() {
  const project = useSimulatorStore((state) => state.project);
  const simTimeSec = useSimulatorStore((state) => state.simTimeSec);
  const scrub = useSimulatorStore((state) => state.scrub);

  const progress = project ? Math.min(1, simTimeSec / Math.max(0.001, project.simulation.total_time_sec)) : 0;
  const segments = useMemo(() => {
    if (!project) {
      return [];
    }
    const total = Math.max(1, project.toolpath.moves.reduce((sum, move) => sum + move.duration_ms, 0));
    let left = 0;
    return project.toolpath.moves.slice(0, 90).map((move) => {
      const width = (move.duration_ms / total) * 100;
      const segment = { id: move.id, left, width, mode: move.mode };
      left += width;
      return segment;
    });
  }, [project]);

  return (
    <footer className="border-t border-slate-700/40 bg-machine-950/80 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span className="font-mono">{project ? `${simTimeSec.toFixed(2)} / ${project.simulation.total_time_sec.toFixed(2)} s` : "0.00 / 0.00 s"}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="relative h-8 overflow-hidden rounded border border-slate-700/70 bg-slate-950">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={`absolute top-0 h-full ${
              segment.mode === "cut"
                ? "bg-cyan-300/35"
                : segment.mode === "drill"
                  ? "bg-amber-300/40"
                  : segment.mode === "plunge"
                    ? "bg-blue-300/25"
                    : "bg-slate-600/24"
            }`}
            style={{ left: `${segment.left}%`, width: `${Math.max(0.15, segment.width)}%` }}
          />
        ))}
        <div className="absolute inset-y-0 left-0 border-r-2 border-cyan-100 bg-cyan-100/10" style={{ width: `${progress * 100}%` }} />
        <input
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          disabled={!project}
          onChange={(event) => scrub(Number(event.target.value))}
        />
      </div>
    </footer>
  );
}
