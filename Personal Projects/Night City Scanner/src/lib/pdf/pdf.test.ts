import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdf } from './generate';
import { placeImage } from './layout';
import { toWinAnsi } from './textLayer';
import { docWith, imagePage, makePng } from '../../test/fixtures';
import { StorageError } from '../storage/errors';
import type { PdfExportOptions } from '../../types/models';

const opts = (o: Partial<PdfExportOptions> = {}): PdfExportOptions => ({
  pageSize: 'fit',
  margin: 'none',
  quality: 'max',
  searchable: true,
  ...o,
});

function store(map: Record<string, Uint8Array>) {
  return {
    getBlob: async (id: string) => {
      const b = map[id];
      if (!b) throw new StorageError('missing');
      return new Blob([b as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    },
  };
}

describe('layout', () => {
  it('fits images inside A4 without cropping and centers them', () => {
    const p = placeImage(1000, 1414, 'a4', 'none');
    expect(p.pageWidth).toBeCloseTo(595.28);
    expect(p.width).toBeLessThanOrEqual(595.28 + 1e-6);
    expect(p.height).toBeLessThanOrEqual(841.89 + 1e-6);
    expect(p.width / p.height).toBeCloseTo(1000 / 1414);
  });
  it('uses landscape pages for landscape images and honours margins', () => {
    const p = placeImage(3000, 2000, 'letter', 'medium');
    expect(p.pageWidth).toBe(792);
    expect(p.pageHeight).toBe(612);
    expect(p.x).toBeGreaterThanOrEqual(36);
    expect(p.y).toBeGreaterThanOrEqual(36 - 1e-9);
  });
  it('keeps the original proportions in "fit" mode', () => {
    const p = placeImage(800, 400, 'fit', 'none');
    expect(p.pageWidth / p.pageHeight).toBeCloseTo(2);
  });
});

describe('PDF generation', () => {
  it('creates one real PDF page per scanned page, in document order', async () => {
    // Distinct aspect ratios identify each page in the output.
    const sizes: Array<[number, number]> = [[100, 200], [300, 100], [100, 100]];
    const pages = sizes.map((_, i) => imagePage(`p${i}`));
    const blobs = Object.fromEntries(sizes.map(([w, h], i) => [`p${i}-proc`, makePng(w, h)]));
    const doc = docWith([pages[2], pages[0], pages[1]]);
    const bytes = await buildPdf(doc, opts(), store(blobs));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const out = await PDFDocument.load(bytes);
    const ratios = out.getPages().map((p) => +(p.getWidth() / p.getHeight()).toFixed(2));
    expect(ratios).toEqual([1, 0.5, 3]);
    expect(out.getTitle()).toBe('Test document');
  });

  it('contains no watermark or extra text when there is no OCR', async () => {
    const doc = docWith([imagePage('a')]);
    const bytes = await buildPdf(doc, opts({ pageSize: 'a4' }), store({ 'a-proc': makePng(50, 70) }));
    const pdf = await getDocument({ data: bytes.slice() }).promise;
    const text = await (await pdf.getPage(1)).getTextContent();
    expect(text.items).toHaveLength(0);
  });

  it('adds an invisible, searchable OCR text layer', async () => {
    const page = imagePage('a', {
      ocr: {
        text: 'Invoice 2026',
        words: [
          { text: 'Invoice', x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15, confidence: 95 },
          { text: '2026', x0: 0.45, y0: 0.1, x1: 0.6, y1: 0.15, confidence: 95 },
        ],
        confidence: 95,
        language: 'eng',
        at: 0,
      },
    });
    const bytes = await buildPdf(docWith([page]), opts(), store({ 'a-proc': makePng(200, 280) }));
    const pdf = await getDocument({ data: bytes.slice() }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items as Array<{ str: string }>;
    expect(items.map((i) => i.str).join('')).toContain('Invoice');
    const without = await buildPdf(docWith([page]), opts({ searchable: false }), store({ 'a-proc': makePng(200, 280) }));
    const pdf2 = await getDocument({ data: without.slice() }).promise;
    expect((await (await pdf2.getPage(1)).getTextContent()).items).toHaveLength(0);
  });

  it('refuses to export pages that are still processing', async () => {
    const doc = docWith([imagePage('a'), imagePage('b', { state: 'pending' })]);
    await expect(buildPdf(doc, opts(), store({}))).rejects.toThrow(/Page 2 is still processing/);
  });

  it('names pages whose images are missing instead of producing a broken PDF', async () => {
    const doc = docWith([imagePage('a'), imagePage('b')]);
    await expect(buildPdf(doc, opts(), store({ 'a-proc': makePng(10, 10) }))).rejects.toThrow(/Page 2 could not be read/);
  });

  it('copies imported PDF pages with rotation', async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 300]);
    src.addPage([400, 300]);
    const srcBytes = await src.save();
    const doc = docWith([], {
      pdfSources: [{ id: 's', blobId: 's-blob', name: 'in.pdf', pageCount: 2 }],
      pages: [
        { id: 'x', kind: 'pdf', sourceId: 's', pageIndex: 1, width: 400, height: 300, rotation: 90, thumbBlobId: null },
        { id: 'y', kind: 'pdf', sourceId: 's', pageIndex: 0, width: 200, height: 300, rotation: 0, thumbBlobId: null },
      ],
    });
    const bytes = await buildPdf(doc, opts(), store({ 's-blob': srcBytes }));
    const out = await PDFDocument.load(bytes);
    expect(out.getPages().map((p) => [p.getWidth(), p.getRotation().angle])).toEqual([
      [400, 90],
      [200, 0],
    ]);
  });

  it('maps text to the standard-font character set', () => {
    expect(toWinAnsi('“Café” — 5€ ✓')).toBe('"Café" - 5€ ?');
  });
});
