import { memo } from 'react';
import { FileText, MoreHorizontal } from 'lucide-react';
import type { DocumentRecord } from '../types/models';
import { BlobImage, formatDate, IconButton } from './kit';

/** Status in words and icons too, never color alone. */
export function DocStatus({ doc }: { doc: DocumentRecord }) {
  if (doc.status === 'draft') return <span className="badge badge--amber">Unfinished</span>;
  const last = doc.exports.at(-1);
  if (last && last.at >= doc.updatedAt - 1000) return <span className="badge badge--green">{last.method === 'shared' ? 'Shared' : 'Downloaded'}</span>;
  if (last) return <span className="badge badge--cyan">Edited since export</span>;
  return <span className="badge">In app only</span>;
}

export const DocCard = memo(function DocCard({ doc, onOpen, onMenu }: { doc: DocumentRecord; onOpen: () => void; onMenu?: () => void }) {
  const first = doc.pages[0];
  return (
    <div className="doc-card">
      <button type="button" className="doc-card__main" onClick={onOpen} aria-label={`Open ${doc.title}, ${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'}`}>
        <div className="doc-card__thumb">
          {first?.thumbBlobId ? <BlobImage blobId={first.thumbBlobId} alt="" /> : <FileText size={22} aria-hidden />}
        </div>
        <div className="doc-card__text">
          <div className="doc-card__title ellipsis">{doc.title}</div>
          <div className="doc-card__meta">
            <span className="mono">{doc.pages.length}p</span>
            <span aria-hidden>·</span>
            <span>{formatDate(doc.updatedAt)}</span>
          </div>
          <DocStatus doc={doc} />
        </div>
      </button>
      {onMenu && (
        <IconButton label={`More actions for ${doc.title}`} onClick={onMenu}>
          <MoreHorizontal size={22} />
        </IconButton>
      )}
    </div>
  );
});
