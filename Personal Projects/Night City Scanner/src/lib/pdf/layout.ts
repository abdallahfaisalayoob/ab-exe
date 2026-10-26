import type { MarginSize, PageSize } from '../../types/models';

/** PDF points (1/72 inch). */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

export const MARGINS: Record<MarginSize, number> = { none: 0, small: 18, medium: 36 };

/** Long side of a page that keeps the image's own proportions (A4's long side). */
const FIT_LONG_SIDE = 841.89;

export interface Placement {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place an image on a page: scale uniformly to fit inside the margins and
 * center it. The image is never cropped or stretched. Landscape images get
 * a landscape page.
 */
export function placeImage(imgW: number, imgH: number, size: PageSize, margin: MarginSize): Placement {
  const m = MARGINS[margin];
  if (imgW <= 0 || imgH <= 0) throw new Error('Image has no size');
  if (size === 'fit') {
    const s = FIT_LONG_SIDE / Math.max(imgW, imgH);
    const width = imgW * s;
    const height = imgH * s;
    return { pageWidth: width + 2 * m, pageHeight: height + 2 * m, x: m, y: m, width, height };
  }
  const base = PAGE_SIZES[size];
  const landscape = imgW > imgH;
  const pageWidth = landscape ? base.height : base.width;
  const pageHeight = landscape ? base.width : base.height;
  const availW = pageWidth - 2 * m;
  const availH = pageHeight - 2 * m;
  const s = Math.min(availW / imgW, availH / imgH);
  const width = imgW * s;
  const height = imgH * s;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export interface ReencodeSpec {
  maxLong: number;
  quality: number;
}

/** null = embed the stored page image untouched (no re-compression). */
export const QUALITY_SPECS: Record<'max' | 'balanced' | 'small', ReencodeSpec | null> = {
  max: null,
  balanced: { maxLong: 2480, quality: 0.82 },
  small: { maxLong: 1650, quality: 0.62 },
};
