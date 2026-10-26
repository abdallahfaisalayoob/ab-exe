const pad = (n: number) => String(n).padStart(2, '0');

/** "Scan 2026-10-26 14.05" — sortable and safe on every filesystem. */
export function defaultTitle(d: Date): string {
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Turn a document title into a safe file base name: strips characters that
 * iOS Files, Windows or macOS reject, control characters and trailing dots.
 */
export function sanitizeFilename(input: string, fallback = 'Scan'): string {
  let s = input
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.toLowerCase().endsWith('.pdf')) s = s.slice(0, -4).trim();
  if (s.length > 120) s = s.slice(0, 120).trim();
  if (!s || RESERVED.test(s)) s = fallback;
  return s;
}

export function pdfFilename(title: string): string {
  return `${sanitizeFilename(title)}.pdf`;
}

export function pageImageFilename(title: string, index: number, total: number, ext: 'jpg' | 'png'): string {
  const width = Math.max(2, String(total).length);
  return `${sanitizeFilename(title)} - p${String(index + 1).padStart(width, '0')}.${ext}`;
}

export function zipFilename(title: string): string {
  return `${sanitizeFilename(title)} - pages.zip`;
}

/** Make `name` unique among `taken` by appending " (2)", " (3)"… before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function extensionForType(type: string): 'jpg' | 'png' {
  return type === 'image/png' ? 'png' : 'jpg';
}
