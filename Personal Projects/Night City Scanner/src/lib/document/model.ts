import type { DocumentRecord, OcrResult, OcrWord, Page, Rotation } from '../../types/models';
import { defaultTitle } from './filename';

/**
 * Pure document operations. They never mutate their input and always return
 * a new record with `updatedAt` bumped, which keeps undo and persistence simple.
 */

export function createDocument(id: string, now: number, title = defaultTitle(new Date(now))): DocumentRecord {
  return {
    id,
    title,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    pages: [],
    pdfSources: [],
    collectionId: null,
    exports: [],
  };
}

const touch = (doc: DocumentRecord, now: number, patch: Partial<DocumentRecord>): DocumentRecord => ({
  ...doc,
  ...patch,
  updatedAt: Math.max(now, doc.updatedAt),
});

export function addPages(doc: DocumentRecord, pages: Page[], now: number, atIndex = doc.pages.length): DocumentRecord {
  const at = Math.max(0, Math.min(atIndex, doc.pages.length));
  return touch(doc, now, { pages: [...doc.pages.slice(0, at), ...pages, ...doc.pages.slice(at)] });
}

export function replacePage(doc: DocumentRecord, page: Page, now: number): DocumentRecord {
  if (!doc.pages.some((p) => p.id === page.id)) return doc;
  return touch(doc, now, { pages: doc.pages.map((p) => (p.id === page.id ? page : p)) });
}

export function removePage(doc: DocumentRecord, pageId: string, now: number): DocumentRecord {
  if (!doc.pages.some((p) => p.id === pageId)) return doc;
  const pages = doc.pages.filter((p) => p.id !== pageId);
  // Drop PDF sources no page uses any more.
  const used = new Set(pages.filter((p) => p.kind === 'pdf').map((p) => (p.kind === 'pdf' ? p.sourceId : '')));
  return touch(doc, now, { pages, pdfSources: doc.pdfSources.filter((s) => used.has(s.id)) });
}

export function movePage(doc: DocumentRecord, from: number, to: number, now: number): DocumentRecord {
  const n = doc.pages.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return doc;
  const pages = doc.pages.slice();
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  return touch(doc, now, { pages });
}

export function normalizeRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/**
 * Rotate a page. Image pages must be re-rendered afterwards (state -> pending);
 * their OCR boxes are rotated with them so the text layer stays aligned.
 */
export function rotatePage(doc: DocumentRecord, pageId: string, delta: number, now: number): DocumentRecord {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  const rotation = normalizeRotation(page.rotation + delta);
  let next: Page;
  if (page.kind === 'image') {
    next = {
      ...page,
      rotation,
      state: 'pending',
      ocr: page.ocr ? rotateOcr(page.ocr, normalizeRotation(delta)) : page.ocr,
    };
  } else {
    next = { ...page, rotation };
  }
  return replacePage(doc, next, now);
}

/** Rotate normalized word boxes clockwise by `deg`. */
export function rotateOcr(ocr: OcrResult, deg: Rotation): OcrResult {
  if (deg === 0) return ocr;
  const rot = (w: OcrWord): OcrWord => {
    switch (deg) {
      case 90:
        return { ...w, x0: 1 - w.y1, y0: w.x0, x1: 1 - w.y0, y1: w.x1 };
      case 180:
        return { ...w, x0: 1 - w.x1, y0: 1 - w.y1, x1: 1 - w.x0, y1: 1 - w.y0 };
      case 270:
        return { ...w, x0: w.y0, y0: 1 - w.x1, x1: w.y1, y1: 1 - w.x0 };
    }
  };
  return { ...ocr, words: ocr.words.map(rot) };
}

/** Duplicate a page right after the original. Images are shared, not copied. */
export function duplicatePage(doc: DocumentRecord, pageId: string, newPageId: string, now: number): DocumentRecord {
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return doc;
  const copy: Page = { ...doc.pages[idx], id: newPageId };
  return addPages(doc, [copy], now, idx + 1);
}

export function renameDocument(doc: DocumentRecord, title: string, now: number): DocumentRecord {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!clean || clean === doc.title) return doc;
  return touch(doc, now, { title: clean });
}

/** Every blob id a document still needs; anything else stored under it is garbage. */
export function referencedBlobIds(doc: DocumentRecord): Set<string> {
  const ids = new Set<string>();
  for (const p of doc.pages) {
    if (p.thumbBlobId) ids.add(p.thumbBlobId);
    if (p.kind === 'image') {
      ids.add(p.originalBlobId);
      if (p.processedBlobId) ids.add(p.processedBlobId);
    }
  }
  for (const s of doc.pdfSources) ids.add(s.blobId);
  return ids;
}

export function documentText(doc: DocumentRecord): string {
  return doc.pages
    .map((p) => (p.kind === 'image' && p.ocr ? p.ocr.text : ''))
    .filter(Boolean)
    .join('\n\n');
}

export type SortKey = 'updated' | 'created' | 'name';

export function sortDocuments(docs: DocumentRecord[], key: SortKey): DocumentRecord[] {
  const out = docs.slice();
  if (key === 'name') out.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
  else if (key === 'created') out.sort((a, b) => b.createdAt - a.createdAt);
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Case- and accent-insensitive search over titles and, optionally, OCR text. */
export function searchDocuments(docs: DocumentRecord[], query: string, includeText: boolean): DocumentRecord[] {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return docs;
  return docs.filter((d) => {
    const hay = fold(includeText ? `${d.title}\n${documentText(d)}` : d.title);
    return terms.every((t) => hay.includes(t));
  });
}
