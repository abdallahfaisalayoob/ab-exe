import { describe, expect, it } from 'vitest';
import { pageImageFilename, pdfFilename, sanitizeFilename, uniqueName, zipFilename } from './filename';

describe('filenames', () => {
  it('strips characters Files/Windows reject', () => {
    expect(sanitizeFilename('Tax: 2025/26 <final>?')).toBe('Tax- 2025-26 -final--');
    expect(sanitizeFilename('  ..hidden.. ')).toBe('hidden');
    expect(sanitizeFilename('a\u0000b\nc')).toBe('abc');
  });
  it('falls back for empty or reserved names', () => {
    expect(sanitizeFilename('')).toBe('Scan');
    expect(sanitizeFilename('///')).toBe('---');
    expect(sanitizeFilename('CON')).toBe('Scan');
  });
  it('does not double the extension and caps length', () => {
    expect(pdfFilename('Lease.pdf')).toBe('Lease.pdf');
    expect(pdfFilename('x'.repeat(300)).length).toBe(124);
  });
  it('numbers page images with zero padding', () => {
    expect(pageImageFilename('Lease', 0, 3, 'jpg')).toBe('Lease - p01.jpg');
    expect(pageImageFilename('Lease', 99, 120, 'png')).toBe('Lease - p100.png');
    expect(zipFilename('Lease')).toBe('Lease - pages.zip');
  });
  it('makes names unique', () => {
    expect(uniqueName('a.pdf', new Set(['a.pdf', 'a (2).pdf']))).toBe('a (3).pdf');
  });
});
