import { PDFDocument, StandardFonts, degrees, type PDFFont } from 'pdf-lib';
import type { DocumentRecord, PdfExportOptions } from '../../types/models';
import { AppError, StorageError } from '../storage/errors';
import { QUALITY_SPECS, placeImage, type ReencodeSpec } from './layout';
import { textLayerOperators } from './textLayer';

export interface PdfDeps {
  getBlob(id: string): Promise<Blob>;
  /** Downscale/re-compress an image; injected so tests can run without a canvas. */
  reencode?(blob: Blob, spec: ReencodeSpec): Promise<Blob>;
  /** Called between pages so the UI can update and memory can be reclaimed. */
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/**
 * Build a genuine multi-page PDF. Pages are processed one at a time (never
 * all images in memory at once). Image pages are embedded as JPEG/PNG; pages
 * that came from an imported PDF are copied as-is, keeping their vector text.
 * No watermark, footer, or branding is added.
 */
export async function buildPdf(doc: DocumentRecord, opts: PdfExportOptions, deps: PdfDeps): Promise<Uint8Array> {
  const pages = doc.pages;
  if (!pages.length) throw new AppError('This document has no pages to export.');
  const notReady = pages.flatMap((p, i) => (p.kind === 'image' && (p.state !== 'ready' || !p.processedBlobId) ? [i + 1] : []));
  if (notReady.length) {
    throw new AppError(`Page ${notReady.join(', ')} ${notReady.length > 1 ? 'are' : 'is'} still processing or failed. Fix or remove ${notReady.length > 1 ? 'them' : 'it'} first.`);
  }

  const pdf = await PDFDocument.create();
  const now = new Date();
  pdf.setTitle(doc.title, { showInWindowTitleBar: true });
  pdf.setCreator('Night City Scanner');
  pdf.setProducer('Night City Scanner');
  pdf.setCreationDate(new Date(doc.createdAt));
  pdf.setModificationDate(now);

  const spec = QUALITY_SPECS[opts.quality];
  let font: PDFFont | null = null;
  const sources = new Map<string, PDFDocument>();
  const missing: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    if (deps.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const page = pages[i];
    try {
      if (page.kind === 'pdf') {
        let src = sources.get(page.sourceId);
        if (!src) {
          const meta = doc.pdfSources.find((s) => s.id === page.sourceId);
          if (!meta) throw new StorageError('missing');
          const bytes = new Uint8Array(await (await deps.getBlob(meta.blobId)).arrayBuffer());
          src = await PDFDocument.load(bytes, { updateMetadata: false });
          sources.set(page.sourceId, src);
        }
        const [copied] = await pdf.copyPages(src, [page.pageIndex]);
        const added = pdf.addPage(copied);
        if (page.rotation) added.setRotation(degrees((added.getRotation().angle + page.rotation) % 360));
      } else {
        let blob = await deps.getBlob(page.processedBlobId!);
        if (spec && deps.reencode) blob = await deps.reencode(blob, spec);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const image = isPng(bytes) ? await pdf.embedPng(bytes) : isJpeg(bytes) ? await pdf.embedJpg(bytes) : null;
        if (!image) throw new AppError(`Page ${i + 1} has an unsupported image format.`);
        const place = placeImage(image.width, image.height, opts.pageSize, opts.margin);
        const out = pdf.addPage([place.pageWidth, place.pageHeight]);
        out.drawImage(image, { x: place.x, y: place.y, width: place.width, height: place.height });
        if (opts.searchable && page.ocr?.words.length) {
          font ??= await pdf.embedFont(StandardFonts.Helvetica);
          const ops = textLayerOperators(out, font, page.ocr.words, place);
          if (ops.length) out.pushOperators(...ops);
        }
      }
    } catch (err) {
      if (err instanceof StorageError && (err.code === 'missing' || err.code === 'corrupt')) {
        missing.push(i + 1);
        continue;
      }
      if (err instanceof AppError || (err as Error)?.name === 'AbortError') throw err;
      throw new AppError(`Could not add page ${i + 1} to the PDF.`, { cause: err });
    }
    deps.onProgress?.(i + 1, pages.length);
    // Yield so the UI can repaint between pages.
    await new Promise((r) => setTimeout(r, 0));
  }

  if (missing.length) {
    throw new AppError(
      `Page ${missing.join(', ')} could not be read from storage (missing or damaged). Remove or retake ${missing.length > 1 ? 'those pages' : 'that page'} and export again.`,
    );
  }
  return pdf.save({ useObjectStreams: true });
}

/** Canvas-based downscale + JPEG/PNG re-encode used for "balanced"/"small" exports. */
export async function canvasReencode(blob: Blob, spec: ReencodeSpec): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const f = Math.min(1, spec.maxLong / Math.max(bmp.width, bmp.height));
    if (f === 1 && blob.type === 'image/png') return blob;
    const w = Math.max(1, Math.round(bmp.width * f));
    const h = Math.max(1, Math.round(bmp.height * f));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, spec.quality));
    canvas.width = canvas.height = 0;
    if (!out) throw new AppError('Could not compress a page image.');
    return out;
  } finally {
    bmp.close();
  }
}
