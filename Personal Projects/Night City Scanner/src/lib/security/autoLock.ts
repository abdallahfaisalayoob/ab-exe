import type { LockTimeout } from '../../types/models';

/**
 * Decides when to lock. iOS freezes timers in background tabs and Home Screen
 * apps, so timers alone are unreliable. Instead we record *timestamps* when
 * the page is hidden or last used and compare them against the clock whenever
 * the page becomes visible again (visibilitychange / pageshow / focus), and
 * on a coarse interval while it is in the foreground.
 */
export interface LockPolicy {
  /** Lock if the app was in the background at least this long (0 = as soon as it is hidden). */
  backgroundMs: number;
  /** Lock after this much foreground inactivity. */
  idleMs: number;
}

/** Foreground idle lock never fires sooner than this, so scanning hands-free is possible. */
export const MIN_IDLE_MS = 60_000;

export function policyFor(timeout: LockTimeout): LockPolicy {
  return { backgroundMs: timeout, idleMs: Math.max(timeout, MIN_IDLE_MS) };
}

/** Cap on how long a system picker (camera, files, share sheet) may suspend auto-lock. */
export const MAX_SUSPEND_MS = 5 * 60_000;

export interface AutoLockOptions {
  onLock: () => void;
  policy: () => LockPolicy;
  now?: () => number;
}

export class AutoLock {
  private readonly now: () => number;
  private lastActivity: number;
  private hiddenAt: number | null = null;
  private suspendedUntil = 0;
  private holds = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private detach: (() => void) | null = null;

  constructor(private readonly opts: AutoLockOptions) {
    this.now = opts.now ?? Date.now;
    this.lastActivity = this.now();
  }

  /** Attach to the real page lifecycle. */
  start(): void {
    if (this.detach) return;
    const onVis = () => (document.visibilityState === 'hidden' ? this.onHidden() : this.onVisible());
    const onPageHide = () => this.onHidden();
    const onPageShow = () => this.onVisible();
    const onActivity = () => this.activity();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onPageShow);
    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    activityEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    this.timer = setInterval(() => this.tick(), 5_000);
    this.detach = () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onPageShow);
      activityEvents.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
    this.lastActivity = this.now();
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
    this.hiddenAt = null;
    this.suspendedUntil = 0;
    this.holds = 0;
  }

  activity(): void {
    this.lastActivity = this.now();
  }

  private suspended(): boolean {
    return this.now() < this.suspendedUntil;
  }

  /**
   * Opening the native camera, file picker or share sheet sends the page to
   * the background on iOS. Suspend background-locking while that happens so
   * the photo or file can still be saved; capped at MAX_SUSPEND_MS.
   */
  suspend(maxMs = MAX_SUSPEND_MS): () => void {
    this.suspendedUntil = this.now() + Math.min(maxMs, MAX_SUSPEND_MS);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.suspended()) {
        this.hiddenAt = null;
        this.lastActivity = this.now();
      }
      this.suspendedUntil = 0;
    };
  }

  /** Keep the foreground idle timer from firing during long work (PDF export, OCR). */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds = Math.max(0, this.holds - 1);
      this.lastActivity = this.now();
    };
  }

  onHidden(): void {
    if (this.hiddenAt === null) this.hiddenAt = this.now();
    if (!this.suspended() && this.opts.policy().backgroundMs === 0) this.fire();
  }

  onVisible(): void {
    const hiddenAt = this.hiddenAt;
    this.hiddenAt = null;
    if (this.suspended()) {
      this.lastActivity = this.now();
      return;
    }
    const policy = this.opts.policy();
    if (hiddenAt !== null && this.now() - hiddenAt >= policy.backgroundMs) {
      this.fire();
      return;
    }
    this.tick();
  }

  tick(): void {
    if (this.suspended()) return;
    const policy = this.opts.policy();
    const now = this.now();
    if (this.hiddenAt !== null) {
      if (now - this.hiddenAt >= policy.backgroundMs) this.fire();
      return;
    }
    if (this.holds === 0 && now - this.lastActivity >= policy.idleMs) this.fire();
  }

  private fire(): void {
    this.hiddenAt = null;
    this.holds = 0;
    this.suspendedUntil = 0;
    this.lastActivity = this.now();
    this.opts.onLock();
  }
}
