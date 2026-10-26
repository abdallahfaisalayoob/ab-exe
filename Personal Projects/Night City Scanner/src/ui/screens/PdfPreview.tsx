import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openPdf, renderPdfPage } from '../../lib/pdf/pdfjs';
import { IconButton, Spinner } from '../kit';

/** Renders the generated PDF itself (not the source images) so what you see is what you export. */
export function PdfPreview({ bytes, title, onClose }: { bytes: Uint8Array; title: string; onClose: () => void }) {
  const [pages, setPages] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    let pdf: PDFDocumentProxy | null = null;
    (async () => {
      try {
        pdf = await openPdf(bytes);
        if (!alive) return;
        setCount(pdf.numPages);
        const width = Math.min(1400, Math.round(window.innerWidth * (window.devicePixelRatio || 1)));
        for (let i = 0; i < pdf.numPages && alive; i++) {
          const blob = await renderPdfPage(pdf, i, width);
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          if (alive) setPages((p) => [...p, url]);
        }
      } catch {
        if (alive) setError('The preview could not be rendered. The PDF itself may still be fine.');
      }
    })();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKey);
      void pdf?.destroy();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, [bytes, onClose]);

  return (
    <div className="preview" role="dialog" aria-modal="true" aria-label={`Preview of ${title}`}>
      <header className="topbar">
        <div className="topbar__side" />
        <h2 className="topbar__title">
          Preview · {pages.length}/{count || '…'}
        </h2>
        <div className="topbar__side topbar__side--end">
          <IconButton label="Close preview" onClick={onClose}>
            <X size={22} />
          </IconButton>
        </div>
      </header>
      <div className="preview__pages">
        {pages.map((u, i) => (
          <figure key={u} className="preview__page">
            <img src={u} alt={`Page ${i + 1}`} />
            <figcaption className="faint mono">{i + 1}</figcaption>
          </figure>
        ))}
        {!error && pages.length < count && (
          <div className="center-pad">
            <Spinner label="Rendering pages" />
          </div>
        )}
        {!count && !error && (
          <div className="center-pad">
            <Spinner label="Opening PDF" />
          </div>
        )}
        {error && <p className="muted center-pad">{error}</p>}
      </div>
    </div>
  );
}
