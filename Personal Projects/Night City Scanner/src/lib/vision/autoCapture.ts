import type { CaptureSensitivity, Quad } from '../../types/models';
import { maxCornerShift, quadArea, quadDistance } from './geometry';

/**
 * Auto-capture decides from successive detections when the document is held
 * steady. It fires once, then re-arms only after the document moves away or
 * leaves the frame, which prevents repeated captures of the same page.
 */
export interface StabilityConfig {
  /** Consecutive steady detections required. */
  frames: number;
  /** Max motion of any corner between frames (fraction of frame) to count as steady. */
  maxMotion: number;
  /** Minimum fraction of the frame the document must cover. */
  minArea: number;
  /** Motion (fraction of diagonal) away from the last capture that re-arms. */
  rearmMotion: number;
  /** Minimum time between automatic captures. */
  cooldownMs: number;
}

export const SENSITIVITY: Record<CaptureSensitivity, StabilityConfig> = {
  relaxed: { frames: 12, maxMotion: 0.008, minArea: 0.2, rearmMotion: 0.08, cooldownMs: 2200 },
  balanced: { frames: 8, maxMotion: 0.012, minArea: 0.16, rearmMotion: 0.07, cooldownMs: 1600 },
  quick: { frames: 5, maxMotion: 0.018, minArea: 0.12, rearmMotion: 0.06, cooldownMs: 1200 },
};

export type CaptureState = 'searching' | 'small' | 'detected' | 'steadying' | 'capture' | 'waiting';

export interface StabilityReading {
  state: CaptureState;
  /** 0..1 progress towards an automatic capture. */
  progress: number;
}

export class StabilityTracker {
  private prev: Quad | null = null;
  private steady = 0;
  private armed = true;
  private lastCaptureQuad: Quad | null = null;
  private lastCaptureAt = -Infinity;
  private missing = 0;

  constructor(private cfg: StabilityConfig) {}

  configure(cfg: StabilityConfig): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.prev = null;
    this.steady = 0;
  }

  /** Record that a capture happened (automatic or manual) with this quad. */
  markCaptured(q: Quad | null, now: number): void {
    this.armed = false;
    this.lastCaptureQuad = q;
    this.lastCaptureAt = now;
    this.steady = 0;
  }

  push(q: Quad | null, now: number): StabilityReading {
    if (!q) {
      this.prev = null;
      this.steady = 0;
      if (++this.missing >= 4) this.armed = true; // document left the frame
      return { state: 'searching', progress: 0 };
    }
    this.missing = 0;
    if (!this.armed && this.lastCaptureQuad && quadDistance(q, this.lastCaptureQuad) > this.cfg.rearmMotion) {
      this.armed = true;
    }
    const steadyNow = this.prev !== null && maxCornerShift(q, this.prev) <= this.cfg.maxMotion;
    this.prev = q;
    if (quadArea(q) < this.cfg.minArea) {
      this.steady = 0;
      return { state: 'small', progress: 0 };
    }
    if (!this.armed || now - this.lastCaptureAt < this.cfg.cooldownMs) {
      this.steady = 0;
      return { state: 'waiting', progress: 0 };
    }
    this.steady = steadyNow ? this.steady + 1 : 0;
    if (this.steady >= this.cfg.frames) {
      return { state: 'capture', progress: 1 };
    }
    return { state: this.steady > 0 ? 'steadying' : 'detected', progress: this.steady / this.cfg.frames };
  }
}
