// The one doorway to the local core. In the desktop app this is Tauri IPC; in browser
// development it is the pu-dev bridge. Either way the same Rust code answers.
import { useUI } from "./store";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T = any>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("pu", { cmd, args });
  }
  const res = await fetch("/__pu/invoke", { method: "POST", body: JSON.stringify({ cmd, args }) });
  if (!res.ok) throw new Error("The local core is not reachable. Start it with `npm run bridge`.");
  const out = await res.json();
  if (!out.ok) throw new Error(out.error);
  return out.data as T;
}

type P = (string | number | null | boolean)[];
export const q = <T = any>(sql: string, params: P = []) => call<T[]>("db.query", { sql, params });
export const q1 = async <T = any>(sql: string, params: P = []) => (await q<T>(sql, params))[0] as T | undefined;

/** Write, then tell every live query to refresh. */
export async function run(sql: string, params: P = []) {
  const r = await call<{ changes: number; lastId: number }>("db.exec", { sql, params });
  useUI.getState().bump();
  return r;
}
export async function batch(stmts: { sql: string; params?: P }[]) {
  if (!stmts.length) return [];
  const r = await call<{ changes: number; lastId: number }[]>("db.batch", { stmts });
  useUI.getState().bump();
  return r;
}

export function fileUrl(path: string, thumb = false) {
  const route = (thumb ? "thumb" : "file") + "?path=" + encodeURIComponent(path);
  if (!isTauri) return "/__pu/" + route;
  return (navigator.userAgent.includes("Windows") ? "http://pu.localhost/" : "pu://localhost/") + route;
}

export function log(world: string, kind: string, title: string, ref?: { type: string; id: number }, detail?: string) {
  return call("db.exec", {
    sql: "INSERT INTO activity(ts, world, kind, title, ref_type, ref_id, detail) VALUES(?,?,?,?,?,?,?)",
    params: [Date.now(), world, kind, title, ref?.type ?? null, ref?.id ?? null, detail ?? null],
  }).catch(() => {});
}

// ── Native capabilities, each with an honest browser fallback ────────────────
export const native = {
  async pick(kind: "folder" | "files" | "sheet"): Promise<string[]> {
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({
        directory: kind === "folder",
        multiple: kind !== "sheet",
        filters: kind === "sheet" ? [{ name: "Spreadsheets", extensions: ["xlsx", "xls", "xlsm", "ods", "csv"] }] : undefined,
      });
      return r == null ? [] : Array.isArray(r) ? r : [r];
    }
    const p = window.prompt(`Development bridge: type the full path of the ${kind === "folder" ? "folder" : "file"} to use`);
    return p ? [p.trim()] : [];
  },
  async openPath(path: string) {
    if (!isTauri) throw new Error("Opening files in their default app is available in the desktop app.");
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_path", { path });
  },
  async reveal(path: string) {
    if (!isTauri) throw new Error("Showing files in Explorer is available in the desktop app.");
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reveal_path", { path });
  },
  async openUrl(url: string) {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
    } else window.open(url, "_blank", "noopener");
  },
  async copy(text: string) {
    if (isTauri) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
    } else await navigator.clipboard.writeText(text);
  },
  async paste(): Promise<string> {
    if (isTauri) {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return (await readText()) ?? "";
    }
    return navigator.clipboard.readText();
  },
  async notify(title: string, body: string): Promise<boolean> {
    try {
      if (isTauri) {
        const n = await import("@tauri-apps/plugin-notification");
        let ok = await n.isPermissionGranted();
        if (!ok) ok = (await n.requestPermission()) === "granted";
        if (ok) n.sendNotification({ title, body });
        return ok;
      }
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
        return true;
      }
    } catch { /* notifications are best-effort */ }
    return false;
  },
  async win(action: "minimize" | "maximize" | "close" | "fullscreen" | "drag") {
    if (!isTauri) {
      if (action === "fullscreen") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (action === "minimize") await w.minimize();
    else if (action === "maximize") await w.toggleMaximize();
    else if (action === "close") await w.close();
    else if (action === "drag") await w.startDragging();
    else await w.setFullscreen(!(await w.isFullscreen()));
  },
  async autostart(set?: boolean): Promise<boolean | null> {
    if (!isTauri) return null;
    const a = await import("@tauri-apps/plugin-autostart");
    if (set === true) await a.enable();
    if (set === false) await a.disable();
    return a.isEnabled();
  },
  /** Fires with absolute paths when files or folders are dropped on the window. */
  async onDrop(handler: (e: { type: "enter" | "over" | "drop" | "leave"; paths?: string[]; x?: number; y?: number }) => void) {
    if (!isTauri) return () => {};
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const scale = window.devicePixelRatio || 1;
    return getCurrentWebview().onDragDropEvent((ev) => {
      const p: any = ev.payload;
      handler({ type: p.type, paths: p.paths, x: p.position ? p.position.x / scale : undefined, y: p.position ? p.position.y / scale : undefined });
    });
  },
};
