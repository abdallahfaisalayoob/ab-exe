import { Gauge, LocateFixed, Type, Zap } from "lucide-react";
import { useEffect } from "react";
import { useSimulatorStore } from "../store/simulatorStore";
import { StatusPill } from "./StatusPill";

export function LaserEngravingPanel() {
  const project = useSimulatorStore((state) => state.project);
  const settings = useSimulatorStore((state) => state.engravingSettings);
  const plan = useSimulatorStore((state) => state.engravingPlan);
  const appliedId = useSimulatorStore((state) => state.appliedEngravingId);
  const setSettings = useSimulatorStore((state) => state.setEngravingSettings);
  const refreshPlan = useSimulatorStore((state) => state.refreshEngravingPlan);
  const applyEngraving = useSimulatorStore((state) => state.applyEngraving);
  const bitDiameterMm = useSimulatorStore((state) => state.bitDiameterMm);
  const spindleRpm = useSimulatorStore((state) => state.spindleRpm);
  const setBitDiameter = useSimulatorStore((state) => state.setBitDiameter);
  const setSpindleRpm = useSimulatorStore((state) => state.setSpindleRpm);

  useEffect(() => {
    refreshPlan();
  }, [project?.project_id, refreshPlan]);

  const applied = Boolean(plan && appliedId === plan.id);

  return (
    <section className="panel rounded">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Laser Engraving</h2>
          <p className="mt-1 text-xs text-slate-500">Auto-placed safe text vectors</p>
        </div>
        <Zap size={19} className="text-cyan-100" />
      </div>

      <div className="grid gap-3 p-3">
        <label className="grid gap-1 text-xs text-slate-400">
          Text
          <div className="flex items-center gap-2 rounded border border-slate-700/70 bg-slate-950/45 px-2">
            <Type size={14} className="text-slate-500" />
            <input
              className="h-9 min-w-0 flex-1 bg-transparent font-mono text-sm text-slate-100 outline-none"
              value={settings.text}
              maxLength={18}
              onChange={(event) => setSettings({ text: event.target.value })}
              placeholder="ABDALLAH"
            />
          </div>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-slate-400">
            Size
            <input
              className="h-9 rounded border border-slate-700/70 bg-slate-950/45 px-2 font-mono text-sm text-slate-100 outline-none"
              type="number"
              min="3"
              max="14"
              step="0.5"
              value={settings.fontSizeMm}
              onChange={(event) => setSettings({ fontSizeMm: Number(event.target.value) })}
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            Intensity
            <input
              className="h-9 rounded border border-slate-700/70 bg-slate-950/45 px-2 font-mono text-sm text-slate-100 outline-none"
              type="number"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.intensity}
              onChange={(event) => setSettings({ intensity: Number(event.target.value) })}
            />
          </label>
        </div>

        <label className="flex items-center justify-between rounded border border-slate-700/70 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
          Preview overlay
          <input
            type="checkbox"
            className="accent-cyan-300"
            checked={settings.previewEnabled}
            onChange={(event) => setSettings({ previewEnabled: event.target.checked })}
          />
        </label>

        <div className="rounded border border-slate-700/70 bg-slate-950/45 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <LocateFixed size={14} className="text-cyan-100" />
              Safe placement
            </div>
            {plan ? <StatusPill severity="info">{plan.safeScore.toFixed(0)}</StatusPill> : <StatusPill severity="warning">NO AREA</StatusPill>}
          </div>
          <p className="font-mono text-xs leading-5 text-slate-400">
            {plan
              ? `X${plan.origin.x.toFixed(1)} Y${plan.origin.y.toFixed(1)} | ${plan.widthMm.toFixed(1)} x ${plan.heightMm.toFixed(1)} mm | ${plan.segments.length} strokes`
              : "No safe region found. Reduce text size or choose a shorter label."}
          </p>
        </div>

        <button
          className="h-9 rounded border border-cyan-300/40 bg-cyan-300/12 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!project || !plan || applied}
          onClick={applyEngraving}
          title="Append laser engraving moves to the simulation"
        >
          {applied ? "Engraving Applied" : "Add To Simulation"}
        </button>

        <div className="rounded border border-slate-700/70 bg-slate-950/45 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300">
            <Gauge size={14} className="text-cyan-100" />
            Tool setup
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-slate-500" title="Visual bit width for isolation and removal simulation">
              Bit mm
              <input
                className="h-8 rounded border border-slate-700/70 bg-slate-950/60 px-2 font-mono text-xs text-slate-100 outline-none"
                type="number"
                min="0.2"
                max="2.4"
                step="0.1"
                value={bitDiameterMm}
                onChange={(event) => setBitDiameter(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-500" title="Displayed spindle speed for chip-load telemetry">
              RPM
              <input
                className="h-8 rounded border border-slate-700/70 bg-slate-950/60 px-2 font-mono text-xs text-slate-100 outline-none"
                type="number"
                min="3000"
                max="24000"
                step="500"
                value={spindleRpm}
                onChange={(event) => setSpindleRpm(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
