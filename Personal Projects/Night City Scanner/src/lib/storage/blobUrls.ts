import { getBlob } from './repo';

/**
 * Decrypted images are shown through short-lived object URLs. They are kept
 * in a small LRU cache and all revoked when the app locks, so no decrypted
 * content stays reachable after locking.
 */
const MAX = 80;
const cache = new Map<string, Promise<string>>();

export function blobUrl(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const p = getBlob(id).then((b) => URL.createObjectURL(b));
  p.catch(() => cache.delete(id));
  cache.set(id, p);
  while (cache.size > MAX) {
    const [oldest, url] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldest);
    url.then((u) => setTimeout(() => URL.revokeObjectURL(u), 5_000)).catch(() => undefined);
  }
  return p;
}

export function forgetBlobUrl(id: string): void {
  const p = cache.get(id);
  cache.delete(id);
  p?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
}

export function clearBlobUrls(): void {
  for (const p of cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  cache.clear();
}
