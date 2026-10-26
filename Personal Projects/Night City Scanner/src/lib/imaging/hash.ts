/** Hamming distance between two hex-encoded 64-bit hashes. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Perceptual hashes this close almost always mean the same page photographed twice. */
export const DUPLICATE_THRESHOLD = 6;

export function isNearDuplicate(a?: string, b?: string): boolean {
  return !!a && !!b && hammingHex(a, b) <= DUPLICATE_THRESHOLD;
}
