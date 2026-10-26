import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../storage/errors';

/**
 * PDF rendering via Mozilla pdf.js (legacy build for broader Safari support),
 * loaded on demand. Used for previews and for thumbnails of imported PDFs.
 */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let lib: Promise<PdfJs> | null = null;

function load(): Promise<PdfJs> {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })().catch((err) => {
    lib = null;
    throw new AppError('The PDF viewer could not be loaded.', { cause: err });
  });
  return lib;
}

export async function openPdf(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await load();
  const base = new URL('vendor/pdfjs/', document.baseURI).href;
  const task = pdfjs.getDocument({
    data: data.slice(), // pdf.js transfers (detaches) the buffer it is given
    password,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    enableXfa: false,
  });
  return task.promise;
}

export function isPasswordError(err: unknown): boolean {
  return (err as { name?: string })?.name === 'PasswordException';
}

/** Render one page (0-based) to a JPEG at roughly `targetWidth` CSS pixels. */
export async function renderPdfPage(pdf: PDFDocumentProxy, index: number, targetWidth: number, extraRotation = 0): Promise<Blob> {
  const page = await pdf.getPage(index + 1);
  try {
    const unit = page.getViewport({ scale: 1, rotation: (page.rotate + extraRotation) % 360 });
    // Stay well under iOS Safari's canvas area limit (~16.7 MP).
    const scale = Math.min(targetWidth / unit.width, Math.sqrt(12_000_000 / (unit.width * unit.height)));
    const viewport = page.getViewport({ scale, rotation: (page.rotate + extraRotation) % 360 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    canvas.width = canvas.height = 0;
    if (!blob) throw new AppError('Could not render the PDF page.');
    return blob;
  } finally {
    page.cleanup();
  }
}
