import { StorageError } from '../storage/errors';

/**
 * Holds the unwrapped data-encryption key while the app is unlocked. It lives
 * only in memory: a reload, a lock, or closing the app discards it, and the
 * key itself is non-extractable so page scripts cannot read its bytes.
 */
let sessionKey: CryptoKey | null = null;
const listeners = new Set<(unlocked: boolean) => void>();

export function setSessionKey(key: CryptoKey): void {
  sessionKey = key;
  listeners.forEach((l) => l(true));
}

export function clearSessionKey(): void {
  sessionKey = null;
  listeners.forEach((l) => l(false));
}

export function hasSessionKey(): boolean {
  return sessionKey !== null;
}

export function requireKey(): CryptoKey {
  if (!sessionKey) throw new StorageError('locked');
  return sessionKey;
}

export function onSessionChange(fn: (unlocked: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
