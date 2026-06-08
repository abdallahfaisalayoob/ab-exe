import { ChevronLeft, ChevronRight, Cpu, FileImage, Loader2, PlayCircle, UploadCloud } from "lucide-react";
import { assetUrl } from "../lib/api";
import { useSimulatorStore } from "../store/simulatorStore";

export function UploadPanel() {
  const { project, samples, selectedSampleId, status, error, uploadFile, runDemo } = useSimulatorStore();
  const collapsed = useSimulatorStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useSimulatorStore((state) => state.toggleSidebar);
  const preview = project?.input_image_url;

  if (collapsed) {
    return (
      <aside className="panel flex min-h-0 flex-col items-center gap-3 rounded p-3">
        <button
          className="flex h-10 w-10 items-center justify-center rounded border border-slate-700/70 bg-slate-900/70 text-slate-100"
          onClick={toggleSidebar}
          title="Expand input sidebar"
        >
          <ChevronRight size={17} />
        </button>
        <FileImage size={20} className="text-cyan-100" />
        <button
          className="flex h-10 w-10 items-center justify-center rounded border border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
          onClick={() => {
            const first = samples[0]?.id;
            if (first) void runDemo(first);
          }}
          title="Load first demo"
        >
          <PlayCircle size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="panel flex min-h-0 flex-col overflow-hidden rounded">
      <div className="border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Input</h2>
            <p className="mt-1 text-xs text-slate-500">PNG, JPG, SVG, PDF</p>
          </div>
          <div className="flex items-center gap-2">
            <FileImage className="text-cyan-100" size={19} />
            <button
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-700/70 bg-slate-900/70 text-slate-300"
              onClick={toggleSidebar}
              title="Collapse input sidebar"
            >
              <ChevronLeft size={15} />
            </button>
          </div>
        </div>
      </div>

      <label className="mx-4 mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-slate-600 bg-slate-900/50 px-3 text-center transition hover:border-cyan-300/70">
        <UploadCloud className="mb-2 text-cyan-100" size={24} />
        <span className="text-sm font-medium text-slate-100">Upload PCB image</span>
        <span className="mt-1 text-xs text-slate-500">Image processing starts immediately</span>
        <input
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
      </label>

      <div className="px-4 pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Cpu size={14} />
          Demo jobs
        </div>
        <div className="grid gap-2">
          {samples.map((sample) => (
            <button
              key={sample.id}
              className={`rounded border px-3 py-2 text-left transition ${
                selectedSampleId === sample.id
                  ? "border-cyan-300/55 bg-cyan-300/10"
                  : "border-slate-700/70 bg-slate-900/40 hover:border-slate-500"
              }`}
              onClick={() => void runDemo(sample.id)}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-100">
                {sample.name}
                <PlayCircle size={15} className="text-cyan-100" />
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{sample.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 pt-4">
        <div className="flex h-full min-h-48 items-center justify-center overflow-hidden rounded border border-slate-700/70 bg-slate-950/60">
          {status === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <Loader2 size={18} className="animate-spin" />
              Processing
            </div>
          ) : preview ? (
            <img className="h-full w-full object-contain" src={assetUrl(preview)} alt="Original PCB input" />
          ) : (
            <span className="text-sm text-slate-600">No preview</span>
          )}
        </div>
        {error ? <div className="mt-3 rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-100">{error}</div> : null}
      </div>
    </aside>
  );
}
