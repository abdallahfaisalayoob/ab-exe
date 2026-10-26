import {
  PDFFont,
  PDFPage,
  beginText,
  endText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFOperator,
} from 'pdf-lib';
import type { OcrWord } from '../../types/models';
import type { Placement } from './layout';

/**
 * Standard PDF fonts only cover WinAnsi (Latin-1-like) characters; anything
 * else is replaced so the text layer never breaks PDF generation.
 */
export function toWinAnsi(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF€]/g, '?');
}

/**
 * Build invisible text operators (text render mode 3) positioned over each
 * recognized word, so the PDF is searchable and selectable while showing
 * only the scanned image.
 */
export function textLayerOperators(
  page: PDFPage,
  font: PDFFont,
  words: OcrWord[],
  place: Placement,
): PDFOperator[] {
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const ops: PDFOperator[] = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let added = 0;
  for (const w of words) {
    const text = toWinAnsi(w.text.trim());
    if (!text) continue;
    const boxW = (w.x1 - w.x0) * place.width;
    const boxH = (w.y1 - w.y0) * place.height;
    if (boxW <= 0.5 || boxH <= 0.5) continue;
    const size = Math.max(1, boxH * 0.88);
    const natural = font.widthOfTextAtSize(text, size);
    if (natural <= 0) continue;
    const squeeze = Math.max(10, Math.min(1000, (boxW / natural) * 100));
    const x = place.x + w.x0 * place.width;
    // PDF y grows upwards; place the baseline ~20% above the box bottom.
    const y = place.y + (1 - w.y1) * place.height + boxH * 0.2;
    ops.push(
      setFontAndSize(fontKey, size),
      setCharacterSqueeze(squeeze),
      setTextMatrix(1, 0, 0, 1, x, y),
      showText(font.encodeText(`${text} `)),
    );
    added++;
  }
  ops.push(endText());
  return added ? ops : [];
}
