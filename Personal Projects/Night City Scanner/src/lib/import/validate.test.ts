import { describe, expect, it } from 'vitest';
import { sniff, validateFile } from './validate';
import { makePng } from '../../test/fixtures';

const file = (bytes: number[] | Uint8Array, name: string) => Object.assign(new Blob([new Uint8Array(bytes)]), { name });

describe('import validation', () => {
  it('identifies formats by content', () => {
    expect(sniff(makePng(2, 2))).toBe('png');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(sniff(new TextEncoder().encode('%PDF-1.7\n%....'))).toBe('pdf');
    expect(sniff(new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypheic'), 0, 0]))).toBe('heic');
    expect(sniff(new TextEncoder().encode('<html><body>hello</body></html>'))).toBeNull();
  });

  it('rejects empty, unknown, disguised and unsupported files with a reason', async () => {
    expect(await validateFile(file([], 'a.jpg'))).toMatchObject({ ok: false, reason: expect.stringMatching(/empty/) });
    expect(await validateFile(file([...new TextEncoder().encode('MZ not an image at all')], 'photo.jpg'))).toMatchObject({ ok: false });
    expect(await validateFile(file([0x49, 0x49, 0x2a, 0, 1, 2, 3, 4, 5, 6, 7, 8], 'scan.tif'))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/TIFF/),
    });
  });

  it('accepts real images and PDFs', async () => {
    expect(await validateFile(file(makePng(4, 4), 'p.png'))).toEqual({ ok: true, kind: 'image', type: 'png' });
    expect(await validateFile(file([...new TextEncoder().encode('%PDF-1.4 hello world')], 'x.pdf'))).toEqual({ ok: true, kind: 'pdf', type: 'pdf' });
  });
});
