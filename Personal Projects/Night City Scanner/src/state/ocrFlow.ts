import { getState } from './store';
import { holdAwake, mutateDoc } from './actions';
import { getBlob } from '../lib/storage/repo';
import { replacePage } from '../lib/document/model';
import type { ImagePage } from '../types/models';

export interface OcrProgress {
  page: number;
  total: number;
  fraction: number;
}

/**
 * Run on-device OCR for every processed image page that has no text yet,
 * one page at a time. Results are saved per page, so an interruption keeps
 * what was already recognized.
 */
export async function runOcr(docId: string, onProgress: (p: OcrProgress) => void, signal?: AbortSignal): Promise<{ done: number; failed: number }> {
  const { recognize, shutdownOcr } = await import('../lib/ocr/ocr');
  const release = holdAwake();
  let done = 0;
  let failed = 0;
  try {
    const doc = getState().docs[docId];
    const todo = (doc?.pages ?? []).filter((p): p is ImagePage => p.kind === 'image' && p.state === 'ready' && !!p.processedBlobId && !p.ocr);
    for (let i = 0; i < todo.length; i++) {
      if (signal?.aborted) break;
      const page = todo[i];
      onProgress({ page: i + 1, total: todo.length, fraction: i / todo.length });
      try {
        const blob = await getBlob(page.processedBlobId!);
        const ocr = await recognize(blob, page.processedWidth, page.processedHeight, (f) =>
          onProgress({ page: i + 1, total: todo.length, fraction: (i + f) / todo.length }),
        );
        await mutateDoc(docId, (d) => {
          const cur = d.pages.find((p) => p.id === page.id);
          // Only attach if the page image is still the one we read.
          if (!cur || cur.kind !== 'image' || cur.processedBlobId !== page.processedBlobId) return d;
          return replacePage(d, { ...cur, ocr }, Date.now());
        });
        done++;
      } catch (err) {
        if ((err as { code?: string })?.code === 'locked') throw err;
        failed++;
      }
    }
  } finally {
    release();
    void shutdownOcr();
  }
  return { done, failed };
}
