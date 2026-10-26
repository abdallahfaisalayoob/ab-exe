import { PDFDocument } from 'pdf-lib';
import type { PdfPage, PdfSource } from '../../types/models';
import { newId } from '../document/ids';
import { pageFromImage, type PageWithBlobs } from '../imaging/pipeline';
import type { BlobWrite } from '../storage/repo';
import { AppError } from '../storage/errors';
import { isPasswordError, openPdf, renderPdfPage } from '../pdf/pdfjs';
import type { FilterPreset, Page } from '../../types/models';
import { MIME, validateFile } from './validate';

export interface ImportItem {
  pages: Page[];
  blobs: BlobWrite[];
  source?: PdfSource;
}

export interface ImportOutcome {
  imported: number;
  problems: string[];
}

async function canDecode(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob);
    const ok = bmp.width > 0 && bmp.height > 0;
    bmp.close();
    return ok;
  } catch {
    return false;
  }
}

/** Import one PDF: pages are referenced, not rasterized, so export copies them losslessly. */
export async function importPdf(docId: string, file: Blob, name: string): Promise<{ pages: PdfPage[]; blobs: BlobWrite[]; source: PdfSource }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let lib: PDFDocument;
  try {
    lib = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypted/i.test((err as Error)?.message ?? '')) {
      throw new AppError(`“${name}” is password-protected. Remove the password in another app, then import it.`);
    }
    throw new AppError(`“${name}” could not be read as a PDF (it may be damaged).`, { cause: err });
  }
  const count = lib.getPageCount();
  if (!count) throw new AppError(`“${name}” has no pages.`);

  let viewer;
  try {
    viewer = await openPdf(bytes);
  } catch (err) {
    if (isPasswordError(err)) throw new AppError(`“${name}” is password-protected.`);
    throw err;
  }
  const sourceId = newId();
  const blobId = newId();
  const pages: PdfPage[] = [];
  const blobs: BlobWrite[] = [{ id: blobId, docId, blob: new Blob([bytes], { type: 'application/pdf' }) }];
  try {
    for (let i = 0; i < count; i++) {
      const p = lib.getPage(i);
      const { width, height } = p.getSize();
      const thumbBlobId = newId();
      let thumb: Blob | null = null;
      try {
        thumb = await renderPdfPage(viewer, i, 420);
      } catch {
        thumb = null; // the page still exports correctly even if the preview fails
      }
      if (thumb) blobs.push({ id: thumbBlobId, docId, blob: thumb });
      pages.push({ id: newId(), kind: 'pdf', sourceId, pageIndex: i, width, height, rotation: 0, thumbBlobId: thumb ? thumbBlobId : null });
    }
  } finally {
    await viewer.destroy();
  }
  return { pages, blobs, source: { id: sourceId, blobId, name, pageCount: count } };
}

/**
 * Import any mix of images and PDFs into a document. Each file is handled
 * independently and handed to `save` as soon as it is processed (so memory
 * stays bounded); one bad file is reported and skipped, never aborting the rest.
 */
export async function importFiles(
  docId: string,
  files: File[],
  opts: { detect: boolean; filter: FilterPreset },
  save: (item: ImportItem) => Promise<void>,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<ImportOutcome> {
  const out: ImportOutcome = { imported: 0, problems: [] };
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, file.name);
    const v = await validateFile(file);
    if (!v.ok) {
      out.problems.push(v.reason);
      continue;
    }
    try {
      if (v.kind === 'pdf') {
        const r = await importPdf(docId, file, file.name);
        await save({ pages: r.pages, blobs: r.blobs, source: r.source });
      } else {
        // Re-tag with the sniffed type: iOS sometimes reports an empty MIME type.
        const blob = file.type ? file : new Blob([file], { type: MIME[v.type] });
        if (!(await canDecode(blob))) {
          out.problems.push(`“${file.name}” could not be decoded by this browser.`);
          continue;
        }
        const r: PageWithBlobs = await pageFromImage(docId, blob, opts);
        await save({ pages: [r.page], blobs: r.blobs });
      }
      out.imported++;
    } catch (err) {
      out.problems.push(
        err instanceof AppError || (err as Error)?.name === 'StorageError'
          ? (err as Error).message
          : `“${file.name}” could not be imported.`,
      );
      // Storage is full: further files would fail the same way.
      if ((err as { code?: string })?.code === 'quota') break;
    }
  }
  onProgress?.(files.length, files.length, '');
  return out;
}
