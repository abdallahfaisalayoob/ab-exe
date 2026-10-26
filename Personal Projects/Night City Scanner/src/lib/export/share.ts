/**
 * Getting files out of the app and into Apple Files.
 *
 * A web app cannot write into arbitrary Files folders. The two honest paths:
 *  1. Web Share API with files → the native iOS share sheet, where the user
 *     picks “Save to Files” (or AirDrop, Mail…). We only learn whether the
 *     sheet completed, not where the file went, so we record it as "shared".
 *  2. Download → Safari asks to download, and the file lands in Files ›
 *     Downloads (configurable in iOS Settings › Apps › Safari › Downloads).
 *
 * navigator.share() must run directly inside a tap handler (transient user
 * activation), so files are generated *before* the user taps Share.
 */
import { zipSync } from 'fflate';

export type ShareOutcome = 'shared' | 'cancelled';

export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export async function shareFiles(files: File[], title: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files, title });
    return 'shared';
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give Safari time to start reading the blob before revoking it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Bundle files into a .zip (stored, not recompressed: images are already compressed). */
export async function zipFiles(files: File[]): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }];
  const out = zipSync(entries);
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
