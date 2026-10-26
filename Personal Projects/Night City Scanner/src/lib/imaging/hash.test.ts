import { describe, expect, it } from 'vitest';
import { hammingHex, isNearDuplicate } from './hash';

describe('perceptual hash comparison', () => {
  it('counts differing bits', () => {
    expect(hammingHex('ff00', 'ff00')).toBe(0);
    expect(hammingHex('ff00', '0f01')).toBe(5);
    expect(hammingHex('ff', 'ffff')).toBe(Infinity);
  });
  it('flags near-identical pages only', () => {
    expect(isNearDuplicate('ffffffffffffffff', 'fffffffffffffff0')).toBe(true);
    expect(isNearDuplicate('ffffffffffffffff', '0000000000000000')).toBe(false);
    expect(isNearDuplicate(undefined, 'ff')).toBe(false);
  });
});
