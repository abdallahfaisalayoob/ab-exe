import { create } from "zustand";
import { fetchSamples, loadDemo, uploadDesign } from "../lib/api";
import { appendEngravingToProject, planEngraving, type EngravingPlan, type EngravingSettings } from "../lib/engraving";
import type { ProjectResponse, SampleProject, TelemetrySample } from "../types/simulator";

type SimStatus = "idle" | "loading" | "ready" | "running" | "paused" | "complete" | "error";

interface SimulatorState {
  project: ProjectResponse | null;
  samples: SampleProject[];
  selectedSampleId: string | null;
  status: SimStatus;
  error: string | null;
  speed: number;
  simTimeSec: number;
  bitDiameterMm: number;
  spindleRpm: number;
  fluteCount: number;
  sidebarCollapsed: boolean;
  engravingSettings: EngravingSettings;
  engravingPlan: EngravingPlan | null;
  appliedEngravingId: string | null;
  loadSamples: () => Promise<void>;
  runDemo: (sampleId: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  start: () => void;
  pause: () => void;
  reset: () => void;
  step: () => void;
  setSpeed: (speed: number) => void;
  setBitDiameter: (bitDiameterMm: number) => void;
  setSpindleRpm: (spindleRpm: number) => void;
  toggleSidebar: () => void;
  setEngravingSettings: (settings: Partial<EngravingSettings>) => void;
  refreshEngravingPlan: () => void;
  applyEngraving: () => void;
  scrub: (progress: number) => void;
  advance: (deltaSec: number) => void;
  currentFrame: () => TelemetrySample | null;
}

function frameAt(project: ProjectResponse | null, timeSec: number): TelemetrySample | null {
  const frames = project?.simulation.frames ?? [];
  if (!frames.length) {
    return null;
  }
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].t_sec < timeSec) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return frames[Math.max(0, Math.min(low, frames.length - 1))];
}

async function withLoading(set: (partial: Partial<SimulatorState>) => void, work: () => Promise<ProjectResponse>) {
  set({ status: "loading", error: null, simTimeSec: 0 });
  try {
    const project = await work();
    set({ project, status: "ready", error: null, simTimeSec: 0, appliedEngravingId: null });
  } catch (error) {
    set({ status: "error", error: error instanceof Error ? error.message : "Unknown error" });
  }
}

export const useSimulatorStore = create<SimulatorState>((set, get) => ({
  project: null,
  samples: [],
  selectedSampleId: null,
  status: "idle",
  error: null,
  speed: 1,
  simTimeSec: 0,
  bitDiameterMm: 0.8,
  spindleRpm: 12000,
  fluteCount: 1,
  sidebarCollapsed: false,
  engravingSettings: {
    text: "ABDALLAH",
    fontSizeMm: 7,
    intensity: 0.72,
    previewEnabled: true,
  },
  engravingPlan: null,
  appliedEngravingId: null,
  async loadSamples() {
    try {
      const samples = await fetchSamples();
      set({ samples, selectedSampleId: samples[0]?.id ?? null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not load samples" });
    }
  },
  async runDemo(sampleId: string) {
    set({ selectedSampleId: sampleId });
    await withLoading(set, () => loadDemo(sampleId));
    get().refreshEngravingPlan();
  },
  async uploadFile(file: File) {
    await withLoading(set, () => uploadDesign(file));
    get().refreshEngravingPlan();
  },
  start() {
    if (get().project) {
      set({ status: "running" });
    }
  },
  pause() {
    if (get().status === "running") {
      set({ status: "paused" });
    }
  },
  reset() {
    set({ simTimeSec: 0, status: get().project ? "ready" : "idle" });
  },
  step() {
    const project = get().project;
    if (!project) {
      return;
    }
    const frames = project.simulation.frames;
    const current = frameAt(project, get().simTimeSec);
    const index = current ? frames.findIndex((frame) => frame.t_sec === current.t_sec) : 0;
    const next = frames[Math.min(frames.length - 1, Math.max(0, index + 1))];
    set({ simTimeSec: next?.t_sec ?? 0, status: "paused" });
  },
  setSpeed(speed: number) {
    set({ speed });
  },
  setBitDiameter(bitDiameterMm: number) {
    set({ bitDiameterMm });
  },
  setSpindleRpm(spindleRpm: number) {
    set({ spindleRpm });
  },
  toggleSidebar() {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
  },
  setEngravingSettings(settings: Partial<EngravingSettings>) {
    const engravingSettings = { ...get().engravingSettings, ...settings };
    set({ engravingSettings });
    get().refreshEngravingPlan();
  },
  refreshEngravingPlan() {
    const project = get().project;
    if (!project) {
      set({ engravingPlan: null });
      return;
    }
    set({ engravingPlan: planEngraving(project.geometry, get().engravingSettings) });
  },
  applyEngraving() {
    const project = get().project;
    const plan = get().engravingPlan;
    if (!project || !plan || get().appliedEngravingId === plan.id) {
      return;
    }
    const updated = appendEngravingToProject(project, plan, get().engravingSettings);
    set({ project: updated, appliedEngravingId: plan.id, status: "ready", simTimeSec: 0 });
  },
  scrub(progress: number) {
    const project = get().project;
    if (!project) {
      return;
    }
    const total = project.simulation.total_time_sec;
    set({ simTimeSec: Math.max(0, Math.min(total, total * progress)), status: "paused" });
  },
  advance(deltaSec: number) {
    const project = get().project;
    if (!project || get().status !== "running") {
      return;
    }
    const total = project.simulation.total_time_sec;
    const next = Math.min(total, get().simTimeSec + deltaSec * get().speed);
    set({ simTimeSec: next, status: next >= total ? "complete" : "running" });
  },
  currentFrame() {
    return frameAt(get().project, get().simTimeSec);
  },
}));
