import { describe, expect, it } from 'vitest';
import { isConvex, isFullFrame, orderCorners, quadArea, quadDistance, warpSize, FULL_QUAD } from './geometry';
import { SENSITIVITY, StabilityTracker } from './autoCapture';
import type { Quad } from '../../types/models';

const q = (pts: number[]): Quad => orderCorners([0, 1, 2, 3].map((i) => ({ x: pts[i * 2], y: pts[i * 2 + 1] })));

describe('geometry', () => {
  it('orders shuffled corners TL, TR, BR, BL', () => {
    const out = q([0.9, 0.8, 0.1, 0.1, 0.1, 0.9, 0.8, 0.15]);
    expect(out).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.15 },
      { x: 0.9, y: 0.8 },
      { x: 0.1, y: 0.9 },
    ]);
  });
  it('computes area and convexity', () => {
    expect(quadArea(FULL_QUAD)).toBeCloseTo(1);
    expect(isConvex(FULL_QUAD)).toBe(true);
    const bow: Quad = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(isConvex(bow)).toBe(false);
    expect(isFullFrame(FULL_QUAD)).toBe(true);
  });
  it('sizes the flattened output from the longest edges and caps it', () => {
    const quad = q([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(warpSize(quad, 2000, 3000, 5000)).toEqual({ width: 2000, height: 3000 });
    expect(warpSize(quad, 2000, 3000, 1500)).toEqual({ width: 1000, height: 1500 });
  });
});

describe('auto-capture stability', () => {
  const doc = q([0.2, 0.2, 0.8, 0.2, 0.8, 0.85, 0.2, 0.85]);
  const cfg = SENSITIVITY.quick;

  it('captures only after the document is steady for N frames', () => {
    const t = new StabilityTracker(cfg);
    const states = Array.from({ length: cfg.frames + 1 }, (_, i) => t.push(doc, 10_000 + i * 100).state);
    expect(states.slice(0, -1)).not.toContain('capture');
    expect(states.at(-1)).toBe('capture');
  });

  it('does not capture while moving or when the page is too small', () => {
    const t = new StabilityTracker(cfg);
    for (let i = 0; i < 20; i++) {
      const jitter = (i % 2) * 0.05;
      const r = t.push(q([0.2 + jitter, 0.2, 0.8, 0.2, 0.8, 0.85, 0.2, 0.85]), 10_000 + i * 100);
      expect(r.state).not.toBe('capture');
    }
    const tiny = q([0.45, 0.45, 0.55, 0.45, 0.55, 0.55, 0.45, 0.55]);
    expect(t.push(tiny, 20_000).state).toBe('small');
  });

  it('never captures the same page twice until it moves away', () => {
    const t = new StabilityTracker(cfg);
    let now = 10_000;
    for (let i = 0; i <= cfg.frames; i++) t.push(doc, (now += 100));
    t.markCaptured(doc, now);
    for (let i = 0; i < 60; i++) expect(t.push(doc, (now += 100)).state).not.toBe('capture');
    // Next page: document leaves the frame, then a new one arrives.
    for (let i = 0; i < 5; i++) t.push(null, (now += 100));
    let fired = false;
    for (let i = 0; i <= cfg.frames; i++) fired ||= t.push(doc, (now += 100)).state === 'capture';
    expect(fired).toBe(true);
    expect(quadDistance(doc, doc)).toBe(0);
  });
});
