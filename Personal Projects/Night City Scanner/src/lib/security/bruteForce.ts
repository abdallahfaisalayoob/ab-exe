/**
 * Progressive delay after failed unlock attempts. The first four mistakes are
 * free; after that the wait grows to a 15-minute ceiling and never becomes a
 * permanent lockout.
 *
 * This is client-side rate limiting: it slows guessing through the UI, but
 * someone with access to the browser's storage can bypass it. The real
 * protection against offline guessing is the PBKDF2 cost plus passcode length.
 */
const STEPS_MS = [30_000, 60_000, 120_000, 300_000, 900_000];
export const FREE_ATTEMPTS = 4;

export function lockoutDelayMs(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return STEPS_MS[Math.min(failures - FREE_ATTEMPTS - 1, STEPS_MS.length - 1)];
}

export interface GuardState {
  failures: number;
  /** Epoch ms before which no attempt is accepted. */
  lockedUntil: number;
}

export const EMPTY_GUARD: GuardState = { failures: 0, lockedUntil: 0 };

/** State to persist *before* checking a passcode (so a reload mid-check still counts). */
export function guardBeforeAttempt(state: GuardState, now: number): GuardState {
  const failures = state.failures + 1;
  const delay = lockoutDelayMs(failures);
  return { failures, lockedUntil: delay ? now + delay : 0 };
}

export function remainingLockMs(state: GuardState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}

export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
