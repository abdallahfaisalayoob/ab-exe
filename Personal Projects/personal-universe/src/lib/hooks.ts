import { useCallback, useEffect, useRef, useState } from "react";
import { call, q, run } from "./backend";
import { useUI, World, Intent } from "./store";
import { create } from "zustand";

/** Live query: re-runs whenever its deps change or anything is written to the database. */
export function useQ<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const rev = useUI((s) => s.rev);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({ data: undefined, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const id = ++latest.current;
    fn().then(
      (data) => id === latest.current && setState({ data, loading: false, error: null }),
      (e) => id === latest.current && setState((s) => ({ ...s, loading: false, error: String(e?.message ?? e) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, tick, ...deps]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Rows for a SQL statement, live. */
export function useRows<T = any>(sql: string, params: (string | number | null)[] = [], enabled = true) {
  const r = useQ<T[]>(() => (enabled ? q<T>(sql, params) : Promise.resolve([])), [sql, JSON.stringify(params), enabled]);
  return r.data ?? [];
}

// ── Settings: a small JSON key-value store, cached in memory ────────────────
interface SettingsState { loaded: boolean; values: Record<string, any>; load: () => Promise<void>; put: (key: string, value: any) => Promise<void> }
export const useSettings = create<SettingsState>((set, get) => ({
  loaded: false,
  values: {},
  load: async () => {
    const rows = await q<{ key: string; value: string }>("SELECT key, value FROM settings");
    const values: Record<string, any> = {};
    for (const r of rows) try { values[r.key] = JSON.parse(r.value); } catch { /* ignore a corrupt entry */ }
    set({ loaded: true, values });
  },
  put: async (key, value) => {
    set({ values: { ...get().values, [key]: value } });
    await call("db.exec", { sql: "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: [key, JSON.stringify(value)] });
  },
}));
export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void] {
  const v = useSettings((s) => s.values[key]);
  const put = useSettings((s) => s.put);
  return [(v === undefined ? fallback : v) as T, (nv: T) => void put(key, nv)];
}
export const setting = <T,>(key: string, fallback: T): T => {
  const v = useSettings.getState().values[key];
  return v === undefined ? fallback : v;
};

/** Consumes a navigation intent addressed to this world, once. */
export function useIntent(world: World, handle: (i: Intent) => void) {
  const intent = useUI((s) => s.intent);
  const clear = useUI((s) => s.clearIntent);
  useEffect(() => {
    if (intent && intent.world === world) {
      handle(intent);
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.n]);
}

export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function useDebounced<T>(value: T, ms = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export { run };
