import { create } from "zustand";

export type World = "home" | "knowledge" | "academy" | "finance" | "projects" | "archive" | "tools";
export const WORLDS: { id: World; name: string; blurb: string }[] = [
  { id: "home", name: "Home", blurb: "Your command centre" },
  { id: "knowledge", name: "Knowledge", blurb: "Everything you have collected" },
  { id: "academy", name: "Academy", blurb: "Your semester, understood" },
  { id: "finance", name: "Finance", blurb: "Where your money stands" },
  { id: "projects", name: "Projects", blurb: "Work in motion" },
  { id: "archive", name: "Archive", blurb: "Your time machine" },
  { id: "tools", name: "Tools", blurb: "An engineer's bench" },
];

export interface Toast { id: number; text: string; kind?: "info" | "error" | "good"; action?: { label: string; run: () => void } }
/** A request for a world to open something specific (from the palette, Home, links…). */
export interface Intent { world: World; tab?: string; id?: number; query?: string; action?: string; payload?: any; n: number }
export interface HandoffRequest { fileIds: number[]; promptId?: number }

/** Global quick-create dialogs, reachable from any world and from the command palette. */
export type Quick = { type: "deadline" | "tx" | "project" | "capture" | "course"; init?: any };

interface UI {
  world: World;
  intent: Intent | null;
  rev: number;
  palette: boolean;
  activity: boolean;
  settings: boolean;
  handoff: HandoffRequest | null;
  quick: Quick | null;
  orion: false | "brief" | "wrap";
  /** Text handed to the command bar (by voice); `auto` runs the top command without a keypress. */
  seed: { text: string; auto: boolean } | null;
  listening: "off" | "recording" | "thinking";
  focus: { title: string; until: number; minutes: number } | null;
  ask: { title: string; value: string; resolve: (v: string | null) => void } | null;
  toasts: Toast[];
  go: (world: World, intent?: Omit<Intent, "world" | "n">) => void;
  clearIntent: () => void;
  bump: () => void;
  set: (p: Partial<UI>) => void;
  toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
}

let seq = 1;
export const useUI = create<UI>((set, get) => ({
  world: "home",
  intent: null,
  rev: 0,
  palette: false,
  activity: false,
  settings: false,
  handoff: null,
  quick: null,
  ask: null,
  orion: false,
  seed: null,
  listening: "off",
  focus: null,
  toasts: [],
  go: (world, intent) => set({ world, intent: intent ? { ...intent, world, n: seq++ } : null, palette: false, activity: false }),
  clearIntent: () => set({ intent: null }),
  bump: () => set({ rev: get().rev + 1 }),
  set: (p) => set(p),
  toast: (text, kind = "info", action) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind, action }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 9000 : 5200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, kind?: Toast["kind"], action?: Toast["action"]) => useUI.getState().toast(text, kind, action);
/** Wraps an async action so failures always surface as a readable message. */
export async function attempt<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okText) toast(okText, "good");
    return r;
  } catch (e: any) {
    toast(String(e?.message ?? e), "error");
    return undefined;
  }
}

/** A small in-app text prompt. Resolves with null when cancelled. */
export const ask = (title: string, value = "") => new Promise<string | null>((resolve) => useUI.setState({ ask: { title, value, resolve } }));
