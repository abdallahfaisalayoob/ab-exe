import { describe, expect, it } from 'vitest';
import {
  addPages,
  createDocument,
  duplicatePage,
  movePage,
  referencedBlobIds,
  removePage,
  renameDocument,
  rotateOcr,
  rotatePage,
  searchDocuments,
  sortDocuments,
} from './model';
import { docWith, imagePage } from '../../test/fixtures';
import type { OcrResult } from '../../types/models';

const ids = (d: { pages: { id: string }[] }) => d.pages.map((p) => p.id);

describe('document model', () => {
  it('creates an empty draft with a dated title', () => {
    const d = createDocument('x', new Date(2026, 9, 26, 9, 5).getTime());
    expect(d).toMatchObject({ id: 'x', status: 'draft', pages: [], title: 'Scan 2026-10-26 09.05' });
  });

  it('adds pages at the end or at an index', () => {
    let d = docWith([]);
    d = addPages(d, [imagePage('a'), imagePage('b')], 1);
    d = addPages(d, [imagePage('c')], 2, 1);
    expect(ids(d)).toEqual(['a', 'c', 'b']);
  });

  it('deletes only the requested page', () => {
    const d = removePage(docWith([imagePage('a'), imagePage('b'), imagePage('c')]), 'b', 5);
    expect(ids(d)).toEqual(['a', 'c']);
    expect(removePage(d, 'zzz', 6)).toBe(d);
  });

  it('reorders pages', () => {
    const d = docWith([imagePage('a'), imagePage('b'), imagePage('c'), imagePage('d')]);
    expect(ids(movePage(d, 0, 2, 1))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(movePage(d, 3, 0, 1))).toEqual(['d', 'a', 'b', 'c']);
    expect(movePage(d, 0, 9, 1)).toBe(d);
  });

  it('rotates pages, marks them for re-render and keeps the original untouched', () => {
    const d = docWith([imagePage('a')]);
    const r = rotatePage(d, 'a', 90, 2);
    expect(r.pages[0]).toMatchObject({ rotation: 90, state: 'pending' });
    expect(rotatePage(r, 'a', -180, 3).pages[0].rotation).toBe(270);
    expect(d.pages[0].rotation).toBe(0);
  });

  it('rotates OCR boxes with the page', () => {
    const ocr: OcrResult = { text: 'x', words: [{ text: 'x', x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4, confidence: 90 }], confidence: 90, language: 'eng', at: 0 };
    expect(rotateOcr(ocr, 90).words[0]).toMatchObject({ x0: 0.6, y0: 0.1, x1: 0.8, y1: 0.3 });
    const back = rotateOcr(rotateOcr(ocr, 90), 270).words[0];
    expect(back.x0).toBeCloseTo(0.1);
    expect(back.y1).toBeCloseTo(0.4);
  });

  it('duplicates a page without copying images', () => {
    const d = duplicatePage(docWith([imagePage('a'), imagePage('b')]), 'a', 'a2', 1);
    expect(ids(d)).toEqual(['a', 'a2', 'b']);
    expect(d.pages[1].thumbBlobId).toBe(d.pages[0].thumbBlobId);
  });

  it('tracks which stored blobs are still needed', () => {
    const d = docWith([imagePage('a')]);
    expect([...referencedBlobIds(d)].sort()).toEqual(['a-orig', 'a-proc', 'a-thumb']);
  });

  it('renames with whitespace cleanup and ignores blanks', () => {
    const d = docWith([]);
    expect(renameDocument(d, '  Rent   contract ', 1).title).toBe('Rent contract');
    expect(renameDocument(d, '   ', 1)).toBe(d);
  });

  it('sorts and searches', () => {
    const a = docWith([], { id: 'a', title: 'Zeta', createdAt: 1, updatedAt: 5 });
    const b = docWith([], { id: 'b', title: 'alpha 10', createdAt: 2, updatedAt: 3 });
    const c = docWith([imagePage('p', { ocr: { text: 'Résumé of Vi', words: [], confidence: 80, language: 'eng', at: 0 } })], {
      id: 'c',
      title: 'alpha 9',
      createdAt: 3,
      updatedAt: 4,
    });
    expect(sortDocuments([a, b, c], 'name').map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(sortDocuments([a, b, c], 'created').map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(sortDocuments([a, b, c], 'updated').map((d) => d.id)).toEqual(['a', 'c', 'b']);
    expect(searchDocuments([a, b, c], 'ALPHA', false).map((d) => d.id)).toEqual(['b', 'c']);
    expect(searchDocuments([a, b, c], 'resume', false)).toEqual([]);
    expect(searchDocuments([a, b, c], 'resume vi', true).map((d) => d.id)).toEqual(['c']);
  });
});
