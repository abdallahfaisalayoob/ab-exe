import { describe, expect, it } from 'vitest';
import { analyze, categorize, extractDates, extractIdentifiers, suggestTitle } from './intelligence';
import type { OcrResult, OcrWord } from '../../types/models';

const word = (text: string, x0: number, y0: number, h: number, conf = 92): OcrWord => ({
  text,
  x0,
  y0,
  x1: x0 + text.length * h * 0.5,
  y1: y0 + h,
  confidence: conf,
});

describe('OCR intelligence', () => {
  it('finds unambiguous dates and leaves ambiguous ones unresolved', () => {
    const d = extractDates('Issued 2026-03-14, due 25/04/2026 or 03/04/2026. Paid March 5, 2026 and 7th Jan 2025.');
    const byRaw = Object.fromEntries(d.map((x) => [x.raw, x.iso]));
    expect(byRaw['2026-03-14']).toBe('2026-03-14');
    expect(byRaw['25/04/2026']).toBe('2026-04-25');
    expect(byRaw['03/04/2026']).toBeNull();
    expect(byRaw['March 5, 2026']).toBe('2026-03-05');
    expect(byRaw['7th Jan 2025']).toBe('2025-01-07');
    expect(extractDates('2026-02-30')).toEqual([]);
  });

  it('extracts reference numbers but not ordinary words', () => {
    const ids = extractIdentifiers('Invoice No: INV-20391\nAccount Number 0012 3456\nReference: pending');
    expect(ids).toContainEqual({ label: 'Invoice', value: 'INV-20391' });
    expect(ids.find((i) => i.value === 'pending')).toBeUndefined();
  });

  it('categorizes only with at least two signals and reports the evidence', () => {
    expect(categorize('INVOICE  Bill To: Vi  Amount due: $20  Due date: 1 May')?.name).toBe('Invoice');
    expect(categorize('INVOICE  Bill To: x')?.evidence).toEqual(['invoice', 'bill to']);
    expect(categorize('just an invoice')).toBeNull();
  });

  it('suggests the largest heading near the top as a title', () => {
    const ocr: OcrResult = {
      text: '',
      confidence: 90,
      language: 'eng',
      at: 0,
      words: [
        word('ARASAKA', 0.1, 0.05, 0.05),
        word('TOWER', 0.5, 0.05, 0.05),
        ...Array.from({ length: 12 }, (_, i) => word('body', 0.1 + (i % 4) * 0.2, 0.2 + Math.floor(i / 4) * 0.03, 0.015)),
        word('BIGGER', 0.1, 0.8, 0.09),
      ],
    };
    expect(suggestTitle(ocr)).toBe('Arasaka Tower');
    // No line clearly taller than body text: no guess.
    const flat: OcrResult = { ...ocr, words: ocr.words.filter((w) => w.text === 'body') };
    expect(suggestTitle(flat)).toBeNull();
    expect(suggestTitle(null)).toBeNull();
  });

  it('builds a filename suggestion from real findings only', () => {
    expect(analyze(null, '').suggestedName).toBeNull();
    expect(analyze(null, 'Receipt  Total 20  Paid by card  2026-01-02').suggestedName).toBe('Receipt 2026-01-02');
  });
});
