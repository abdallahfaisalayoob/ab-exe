import type { FilterPreset, ImagePage, Quad } from '../../types/models';
import { newId } from '../document/ids';
import type { BlobWrite } from '../storage/repo';
import { analyzeImage, processImage } from '../vision/cvClient';
import { isFullFrame, isUsableQuad } from '../vision/geometry';

/** ~A4 at 300 DPI on the long side: sharp prints without bloating storage. */
export const OUTPUT_MAX_LONG = 3508;
export const THUMB_MAX = 420;
/** Detections below this confidence fall back to the full frame. */
const MIN_CONFIDENCE = 0.18;

export interface PageWithBlobs {
  page: ImagePage;
  blobs: BlobWrite[];
}

/**
 * Edge detection lands on the boundary between page and background; pull
 * the corners in very slightly so no sliver of desk ends up on the page edge.
 */
function insetTowardsCentre(q: Quad, amount: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  }) as Quad;
}

/** Detect corners on a still image; null when nothing convincing is found. */
export async function detectCorners(blob: Blob): Promise<{ quad: Quad | null; width: number; height: number }> {
  const res = await analyzeImage(blob, 1100);
  const quad = res.quad && res.confidence >= MIN_CONFIDENCE && isUsableQuad(res.quad, 0.08) ? res.quad : null;
  return { quad: quad && !isFullFrame(quad) ? insetTowardsCentre(quad, 0.004) : null, width: res.width, height: res.height };
}

/**
 * (Re-)render a page from its original image. New blob ids are used for the
 * outputs so the old versions stay valid until the new record is committed.
 */
export async function renderPage(docId: string, page: ImagePage, original: Blob): Promise<PageWithBlobs> {
  const res = await processImage({
    blob: original,
    quad: page.corners,
    filter: page.filter,
    rotation: page.rotation,
    maxLong: OUTPUT_MAX_LONG,
    thumbMax: THUMB_MAX,
  });
  const processedBlobId = newId();
  const thumbBlobId = newId();
  const next: ImagePage = {
    ...page,
    processedBlobId,
    thumbBlobId,
    processedWidth: res.width,
    processedHeight: res.height,
    resolvedFilter: res.resolvedFilter,
    hash: res.hash ?? undefined,
    state: 'ready',
    error: undefined,
  };
  return {
    page: next,
    blobs: [
      { id: processedBlobId, docId, blob: res.blob },
      ...(res.thumb ? [{ id: thumbBlobId, docId, blob: res.thumb }] : []),
    ],
  };
}

/** A small, quick render for live filter previews in the editor. */
export async function previewRender(page: ImagePage, original: Blob, filter: FilterPreset, maxLong = 1000): Promise<Blob> {
  const res = await processImage({
    blob: original,
    quad: page.corners,
    filter,
    rotation: page.rotation,
    maxLong,
    thumbMax: 0,
  });
  return res.blob;
}

/**
 * Turn a captured/imported photo into a page: detect edges (optional),
 * flatten, enhance. The original is kept untouched so every later edit
 * re-renders from it with no generational quality loss.
 */
export async function pageFromImage(
  docId: string,
  original: Blob,
  opts: { detect: boolean; filter: FilterPreset; fallbackQuad?: Quad | null },
): Promise<PageWithBlobs> {
  // Analysis also yields the decoded (orientation-corrected) dimensions.
  const det = await detectCorners(original);
  // The still is analysed at higher resolution than the live preview, so prefer it.
  const quad = opts.detect ? (det.quad ?? opts.fallbackQuad ?? null) : null;
  const { width, height } = det;
  const originalBlobId = newId();
  const base: ImagePage = {
    id: newId(),
    kind: 'image',
    rotation: 0,
    thumbBlobId: null,
    originalBlobId,
    originalWidth: width,
    originalHeight: height,
    corners: quad,
    detectedCorners: quad,
    filter: opts.filter,
    processedBlobId: null,
    processedWidth: 0,
    processedHeight: 0,
    state: 'pending',
    ocr: null,
  };
  const rendered = await renderPage(docId, base, original);
  return { page: rendered.page, blobs: [{ id: originalBlobId, docId, blob: original }, ...rendered.blobs] };
}

/** A pending page whose processing failed; it keeps its original so it can be retried. */
export function failedPage(docId: string, original: Blob, filter: FilterPreset, error: string): PageWithBlobs {
  const originalBlobId = newId();
  return {
    page: {
      id: newId(),
      kind: 'image',
      rotation: 0,
      thumbBlobId: null,
      originalBlobId,
      originalWidth: 0,
      originalHeight: 0,
      corners: null,
      detectedCorners: null,
      filter,
      processedBlobId: null,
      processedWidth: 0,
      processedHeight: 0,
      state: 'error',
      error,
      ocr: null,
    },
    blobs: [{ id: originalBlobId, docId, blob: original }],
  };
}
