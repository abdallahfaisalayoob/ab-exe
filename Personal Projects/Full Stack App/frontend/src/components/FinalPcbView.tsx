import { CircuitBoard, GitCompareArrows } from "lucide-react";
import { assetUrl } from "../lib/api";
import { useSimulatorStore } from "../store/simulatorStore";

export function FinalPcbView() {
  const project = useSimulatorStore((state) => state.project);

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden rounded">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Final PCB</h2>
          <p className="mt-1 text-xs text-slate-500">Corrected geometry</p>
        </div>
        <CircuitBoard size={19} className="text-cyan-100" />
      </div>
      <div className="flex min-h-52 flex-1 items-center justify-center overflow-hidden bg-slate-950/50 p-3">
        {project ? (
          <img className="max-h-full w-full rounded object-contain" src={assetUrl(project.final_image_url)} alt="Corrected final PCB rendering" />
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <GitCompareArrows size={18} />
            Awaiting geometry
          </div>
        )}
      </div>
    </section>
  );
}
