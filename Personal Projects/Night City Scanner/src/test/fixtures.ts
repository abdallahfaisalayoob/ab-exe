import { zlibSync } from 'fflate';
import type { DocumentRecord, ImagePage } from '../types/models';

/** Fast KDF cost for tests only; production always uses 600k iterations. */
export const TEST_ITERATIONS = 1_000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A real, valid grayscale PNG of the given size (solid gray level). */
export function makePng(width: number, height: number, level = 200): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) raw.fill(level, y * (width + 1) + 1, (y + 1) * (width + 1));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function imagePage(id: string, over: Partial<ImagePage> = {}): ImagePage {
  return {
    id,
    kind: 'image',
    rotation: 0,
    thumbBlobId: `${id}-thumb`,
    originalBlobId: `${id}-orig`,
    originalWidth: 1000,
    originalHeight: 1400,
    corners: null,
    detectedCorners: null,
    filter: 'auto',
    processedBlobId: `${id}-proc`,
    processedWidth: 1000,
    processedHeight: 1400,
    state: 'ready',
    ocr: null,
    ...over,
  };
}

export function docWith(pages: ImagePage[], over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    title: 'Test document',
    status: 'saved',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    pages,
    pdfSources: [],
    collectionId: null,
    exports: [],
    ...over,
  };
}
