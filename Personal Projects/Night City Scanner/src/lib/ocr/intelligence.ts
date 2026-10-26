import type { OcrResult } from '../../types/models';

/**
 * Lightweight document understanding computed only from OCR output: dates,
 * reference numbers, a keyword-based category and a title guess. Every
 * suggestion carries the evidence it came from and is only ever offered,
 * never applied silently.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIndex = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));

export interface FoundDate {
  raw: string;
  /** ISO yyyy-mm-dd when the date is unambiguous, else null. */
  iso: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const iso = (y: number, m: number, d: number) => (validYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null);

export function extractDates(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  const seen = new Set<string>();
  const add = (raw: string, value: string | null) => {
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ raw, iso: value });
  };
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) add(m[0], v);
  }
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon},?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m[0], iso(+m[3], monthIndex(m[2]) + 1, +m[1]));
  }
  for (const m of text.matchAll(new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m[0], iso(+m[3], monthIndex(m[1]) + 1, +m[2]));
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    // 03/04/2024 is ambiguous (day-first vs month-first); only resolve when one reading is impossible.
    if (a > 12 && b <= 12) add(m[0], iso(y, b, a));
    else if (b > 12 && a <= 12) add(m[0], iso(y, a, b));
    else if (validYmd(y, a, b) || validYmd(y, b, a)) add(m[0], a === b ? iso(y, a, b) : null);
  }
  return found;
}

export interface FoundIdentifier {
  label: string;
  value: string;
}

export function extractIdentifiers(text: string): FoundIdentifier[] {
  const out: FoundIdentifier[] = [];
  const re =
    /\b(invoice|inv|receipt|order|account|acct|reference|ref|policy|customer|member|ticket|case|claim|tracking|booking|confirmation)\s*(?:no\.?|number|num|#|id)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/]{3,24})\b/gi;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const value = m[2];
    if (!/\d/.test(value)) continue; // identifiers contain digits; avoids matching plain words
    const key = `${m[1].toLowerCase()}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), value });
  }
  return out.slice(0, 8);
}

const CATEGORIES: Array<{ name: string; words: string[] }> = [
  { name: 'Invoice', words: ['invoice', 'bill to', 'amount due', 'due date', 'invoice number', 'payment terms', 'subtotal', 'vat'] },
  { name: 'Receipt', words: ['receipt', 'thank you for', 'cashier', 'change', 'subtotal', 'total', 'paid', 'card ending', 'transaction'] },
  { name: 'Bank statement', words: ['statement', 'account number', 'opening balance', 'closing balance', 'balance', 'iban', 'sort code', 'deposits', 'withdrawals'] },
  { name: 'Contract', words: ['agreement', 'hereby', 'party', 'parties', 'terms and conditions', 'signature', 'witness', 'obligations', 'termination'] },
  { name: 'Letter', words: ['dear', 'sincerely', 'regards', 'yours faithfully', 'yours truly'] },
  { name: 'Medical', words: ['patient', 'diagnosis', 'prescription', 'clinic', 'hospital', 'dosage', 'doctor', 'medical', 'pharmacy'] },
  { name: 'Tax', words: ['tax return', 'taxable', 'tax year', 'income tax', 'withholding', 'revenue', 'tax id', 'ntn'] },
  { name: 'Utility bill', words: ['electricity', 'kwh', 'meter', 'gas', 'water', 'billing period', 'units consumed', 'tariff'] },
  { name: 'Certificate', words: ['certificate', 'certify', 'awarded', 'certified', 'completion', 'achievement'] },
  { name: 'Academic', words: ['transcript', 'semester', 'gpa', 'cgpa', 'course', 'university', 'student', 'grade', 'credit hours'] },
];

export interface Category {
  name: string;
  evidence: string[];
}

export function categorize(text: string): Category | null {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  let best: Category | null = null;
  let bestScore = 0;
  for (const c of CATEGORIES) {
    const evidence = c.words.filter((w) => new RegExp(`[^a-z]${w.replace(/ /g, '\\s')}[^a-z]`).test(hay));
    // Require at least two distinct signals to avoid labelling on a single word.
    const score = evidence.length;
    if (score >= 2 && score > bestScore) {
      best = { name: c.name, evidence };
      bestScore = score;
    }
  }
  return best;
}

/**
 * Guess a title: the line with the tallest text in the top part of the first
 * page, ignoring low-confidence and mostly non-letter lines.
 */
export function suggestTitle(ocr: OcrResult | null | undefined): string | null {
  if (!ocr?.words.length) return null;
  const lines = new Map<number, { words: typeof ocr.words; top: number }>();
  // Group words into lines by vertical centre.
  const sorted = ocr.words.filter((w) => w.confidence >= 60 && w.y0 < 0.45).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    let key: number | null = null;
    for (const [k, l] of lines) {
      const h = l.words[0].y1 - l.words[0].y0;
      if (Math.abs(k - cy) < h * 0.5) {
        key = k;
        break;
      }
    }
    if (key === null) lines.set(cy, { words: [w], top: w.y0 });
    else lines.get(key)!.words.push(w);
  }
  // Body-text height across the whole page, to tell real headings apart.
  const heights = ocr.words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)];
  let best: { text: string; h: number } | null = null;
  for (const l of lines.values()) {
    const text = l.words
      .sort((a, b) => a.x0 - b.x0)
      .map((w) => w.text)
      .join(' ')
      .replace(/[^\p{L}\p{N}\s&'.,()-]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters / Math.max(1, text.length) < 0.5 || text.length > 70) continue;
    const h = l.words.reduce((s, w) => s + (w.y1 - w.y0), 0) / l.words.length;
    if (!best || h > best.h * 1.05) best = { text, h };
  }
  // A heading must stand out from body text; otherwise don't guess.
  if (!best || best.h < bodyHeight * 1.3) return null;
  const t = best.text;
  // Title-case shouty headings.
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : t;
}

export interface Insights {
  title: string | null;
  category: Category | null;
  dates: FoundDate[];
  identifiers: FoundIdentifier[];
  suggestedName: string | null;
}

export function analyze(firstPage: OcrResult | null | undefined, fullText: string): Insights {
  const title = suggestTitle(firstPage);
  const category = categorize(fullText);
  const dates = extractDates(fullText);
  const identifiers = extractIdentifiers(fullText);
  const date = dates.find((d) => d.iso)?.iso ?? null;
  const parts = [category?.name, title && title !== category?.name ? title : null, date].filter(Boolean) as string[];
  return { title, category, dates, identifiers, suggestedName: parts.length ? parts.join(' ').slice(0, 100) : null };
}
