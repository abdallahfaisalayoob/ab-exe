import { describe, expect, it } from 'vitest';
import { AutoLock, MAX_SUSPEND_MS, policyFor } from './autoLock';
import { lockoutDelayMs, formatWait, guardBeforeAttempt } from './bruteForce';
import type { LockTimeout } from '../../types/models';

function setup(timeout: LockTimeout) {
  let t = 0;
  let locks = 0;
  const al = new AutoLock({ onLock: () => locks++, policy: () => policyFor(timeout), now: () => t });
  return {
    al,
    advance: (ms: number) => (t += ms),
    get locks() {
      return locks;
    },
  };
}

describe('auto-lock', () => {
  it('"immediately" locks as soon as the app is hidden', () => {
    const s = setup(0);
    s.al.onHidden();
    expect(s.locks).toBe(1);
  });

  it('locks on return when the app was in the background longer than the timeout', () => {
    const s = setup(30_000);
    s.al.onHidden();
    s.advance(10_000);
    s.al.onVisible();
    expect(s.locks).toBe(0);
    s.al.onHidden();
    s.advance(31_000); // iOS froze our timers meanwhile: no tick ran
    s.al.onVisible();
    expect(s.locks).toBe(1);
  });

  it('locks after foreground inactivity, but never sooner than a minute', () => {
    const s = setup(30_000);
    s.advance(45_000);
    s.al.tick();
    expect(s.locks).toBe(0);
    s.advance(16_000);
    s.al.tick();
    expect(s.locks).toBe(1);
  });

  it('activity resets the idle timer; long operations hold it', () => {
    const s = setup(60_000);
    s.advance(50_000);
    s.al.activity();
    s.advance(50_000);
    s.al.tick();
    expect(s.locks).toBe(0);
    const release = s.al.hold();
    s.advance(10 * 60_000);
    s.al.tick();
    expect(s.locks).toBe(0);
    release();
    s.advance(61_000);
    s.al.tick();
    expect(s.locks).toBe(1);
  });

  it('a system picker suspends background locking, up to a cap', () => {
    const s = setup(0);
    const release = s.al.suspend();
    s.al.onHidden();
    s.advance(20_000);
    s.al.onVisible();
    release();
    expect(s.locks).toBe(0);
    // A suspension that is never released expires.
    s.al.suspend();
    s.advance(MAX_SUSPEND_MS + 1);
    s.al.onHidden();
    expect(s.locks).toBe(1);
  });
});

describe('brute-force policy', () => {
  it('allows four free attempts then backs off to a 15 minute ceiling', () => {
    expect([1, 2, 3, 4].map(lockoutDelayMs)).toEqual([0, 0, 0, 0]);
    expect(lockoutDelayMs(5)).toBe(30_000);
    expect(lockoutDelayMs(6)).toBe(60_000);
    expect(lockoutDelayMs(9)).toBe(900_000);
    expect(lockoutDelayMs(50)).toBe(900_000);
  });
  it('counts the attempt before it is checked', () => {
    expect(guardBeforeAttempt({ failures: 4, lockedUntil: 0 }, 100)).toEqual({ failures: 5, lockedUntil: 30_100 });
  });
  it('formats waits', () => {
    expect(formatWait(30_000)).toBe('30s');
    expect(formatWait(90_000)).toBe('1m 30s');
    expect(formatWait(900_000)).toBe('15m');
  });
});
