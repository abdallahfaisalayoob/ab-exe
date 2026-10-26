/**
 * File validation by content ("magic bytes"), not by name or the MIME type
 * the browser guesses, so a renamed or malformed file is rejected early.
 */
export type SniffedType = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'bmp' | 'tiff' | 'pdf';

export const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
export const MAX_PDF_BYTES = 250 * 1024 * 1024;

export function sniff(head: Uint8Array): SniffedType | null {
  const b = head;
  const ascii = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (b.length < 12) {
    if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'pdf';
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (ascii(0, 2) === 'BM') return 'bmp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  // PDFs may have a little junk before the header; the spec allows 1024 bytes.
  const text = ascii(0, Math.min(b.length, 1024));
  if (text.includes('%PDF-')) return 'pdf';
  return null;
}

export const MIME: Record<SniffedType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
};

export type Validation =
  | { ok: true; kind: 'image' | 'pdf'; type: SniffedType }
  | { ok: false; reason: string };

export async function validateFile(file: Blob & { name?: string }): Promise<Validation> {
  const name = file.name ?? 'File';
  if (file.size === 0) return { ok: false, reason: `“${name}” is empty.` };
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const type = sniff(head);
  if (!type) return { ok: false, reason: `“${name}” is not a supported image or PDF.` };
  if (type === 'tiff') return { ok: false, reason: `“${name}” is a TIFF, which browsers cannot open. Convert it to JPEG or PDF first.` };
  if (type === 'pdf') {
    if (file.size > MAX_PDF_BYTES) return { ok: false, reason: `“${name}” is larger than 250 MB.` };
    return { ok: true, kind: 'pdf', type };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: `“${name}” is larger than 80 MB.` };
  return { ok: true, kind: 'image', type };
}
