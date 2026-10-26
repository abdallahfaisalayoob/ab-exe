import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Crop,
  FileUp,
  Plus,
  RotateCcw,
  RotateCw,
  ScanText,
  Share,
  Sparkles,
  Trash2,
  TriangleAlert,
  Check,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import type { DocumentRecord, Page } from '../../types/models';
import { useApp } from '../../state/store';
import {
  deletePageWithUndo,
  findDuplicate,
  goBack,
  goHome,
  markSaved,
  mutateDoc,
  navigate,
  reportError,
  reprocessPage,
  resumePending,
  toast,
} from '../../state/actions';
import { importIntoDocument, type ImportProgress } from '../../state/importFlow';
import { runOcr, type OcrProgress } from '../../state/ocrFlow';
import { duplicatePage, documentText, movePage, renameDocument, rotatePage } from '../../lib/document/model';
import { newId } from '../../lib/document/ids';
import { analyze } from '../../lib/ocr/intelligence';
import { BlobImage, Button, Notice, Sheet, TopBar, formatDate } from '../kit';
import { BusyOverlay } from '../BusyOverlay';
import { DocStatus } from '../DocCard';
import { useDoc, useFilePicker } from '../hooks';
import { ExportSheet } from './ExportSheet';

export default function ReviewScreen({ docId }: { docId: string }) {
  const doc = useDoc(docId);
  const loaded = useApp((s) => s.libraryLoaded);
  const stack = useApp((s) => s.stack);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [ocr, setOcr] = useState<OcrProgress | null>(null);
  const [renaming, setRenaming] = useState(false);
  const pick = useFilePicker();

  useEffect(() => {
    if (doc) resumePending(docId);
    // Only on open: later pending pages are handled by whoever edits them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, !!doc]);

  const sensors = useSensors(
    // Mouse for desktop; touch needs a press-and-hold so normal scrolling still works.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const duplicate = useMemo(() => (doc ? findDuplicate(doc) : null), [doc]);

  if (!doc) {
    return (
      <main className="screen">
        <TopBar title="Document" onBack={goBack} />
        <div className="content">{loaded ? <p className="muted">This document no longer exists.</p> : null}</div>
      </main>
    );
  }

  const ids = doc.pages.map((p) => p.id);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    mutateDoc(docId, (d) => movePage(d, from, to, Date.now())).catch((err) => reportError(err, 'Could not reorder pages.'));
  };

  const busyPages = doc.pages.filter((p) => p.kind === 'image' && p.state === 'pending').length;
  const errorPages = doc.pages.filter((p) => p.kind === 'image' && p.state === 'error').length;
  const imagePages = doc.pages.filter((p) => p.kind === 'image');
  const ocrDone = imagePages.filter((p) => p.kind === 'image' && p.ocr).length;

  const done = async () => {
    try {
      await markSaved(docId);
      toast('success', 'Saved in the app (encrypted). Export to keep a copy in Files.');
      if (stack.at(-1)?.name === 'home' || stack.length <= 1) goHome();
      else goBack();
    } catch (err) {
      reportError(err, 'Could not save the document.');
    }
  };

  const doImport = async () => {
    setAddOpen(false);
    const files = await pick({ accept: 'image/*,application/pdf,.pdf,.heic,.heif', multiple: true });
    if (!files.length) return;
    setImporting({ done: 0, total: files.length, name: '' });
    try {
      await importIntoDocument(files, docId, setImporting);
    } catch (err) {
      reportError(err, 'Import failed.');
    } finally {
      setImporting(null);
    }
  };

  const doOcr = async () => {
    setOcr({ page: 0, total: 0, fraction: 0 });
    try {
      const r = await runOcr(docId, setOcr);
      if (r.failed) toast('error', `Text recognition failed on ${r.failed} page${r.failed === 1 ? '' : 's'}.`);
      else if (r.done) toast('success', `Recognized text on ${r.done} page${r.done === 1 ? '' : 's'}.`);
      setTextOpen(true);
    } catch (err) {
      reportError(err, 'Text recognition is unavailable.');
    } finally {
      setOcr(null);
    }
  };

  return (
    <main className="screen review">
      <TopBar
        title={doc.status === 'draft' ? 'Review scan' : 'Document'}
        onBack={goBack}
        end={
          doc.status === 'draft' ? (
            <Button size="sm" variant="ghost" onClick={done} icon={<Check size={18} />}>
              Save
            </Button>
          ) : null
        }
      />
      <div className="content stack">
        <div className="review__head">
          {renaming ? (
            <RenameField
              doc={doc}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <button type="button" className="review__title" onClick={() => setRenaming(true)} aria-label={`Rename ${doc.title}`}>
              <span className="ellipsis">{doc.title}</span>
              <Pencil size={16} aria-hidden />
            </button>
          )}
          <div className="row faint" style={{ fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
            <span className="mono">
              {doc.pages.length} page{doc.pages.length === 1 ? '' : 's'}
            </span>
            <span aria-hidden>·</span>
            <span>Edited {formatDate(doc.updatedAt, true)}</span>
            <DocStatus doc={doc} />
          </div>
        </div>

        {duplicate && (
          <Notice tone="warn" icon={<TriangleAlert size={18} />}>
            A page looks very similar to one in <strong>{duplicate.title}</strong>. It may be a duplicate.
          </Notice>
        )}
        {errorPages > 0 && (
          <Notice tone="danger" icon={<TriangleAlert size={18} />}>
            {errorPages} page{errorPages === 1 ? '' : 's'} could not be processed. Tap {errorPages === 1 ? 'it' : 'one'} to retry, retake or delete.
          </Notice>
        )}

        <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Tap a page for options. Press and hold, then drag to reorder.
        </p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ol className="page-grid">
              {doc.pages.map((p, i) => (
                <SortablePage key={p.id} page={p} index={i} onOpen={() => setActionsFor(p.id)} />
              ))}
              <li>
                <button type="button" className="page-add" onClick={() => setAddOpen(true)}>
                  <Plus size={28} />
                  <span>Add pages</span>
                </button>
              </li>
            </ol>
          </SortableContext>
        </DndContext>
      </div>

      <div className="bottombar">
        <Button onClick={() => (ocrDone && ocrDone === imagePages.length ? setTextOpen(true) : doOcr())} disabled={!imagePages.length || busyPages > 0} icon={<ScanText size={20} />}>
          {ocrDone && ocrDone === imagePages.length ? 'Text' : 'Recognize text'}
        </Button>
        <Button variant="primary" className="grow" onClick={() => setExportOpen(true)} disabled={!doc.pages.length} icon={<Share size={20} />}>
          Export
        </Button>
      </div>

      {actionsFor && <PageActions doc={doc} pageId={actionsFor} onClose={() => setActionsFor(null)} />}
      {addOpen && (
        <Sheet title="Add pages" onClose={() => setAddOpen(false)}>
          <div className="stack">
            <Button
              size="lg"
              variant="primary"
              block
              icon={<Camera size={20} />}
              onClick={() => {
                setAddOpen(false);
                navigate({ name: 'camera', docId });
              }}
            >
              Scan more pages
            </Button>
            <Button size="lg" block icon={<FileUp size={20} />} onClick={doImport}>
              Import photos or PDFs
            </Button>
          </div>
        </Sheet>
      )}
      {exportOpen && <ExportSheet doc={doc} onClose={() => setExportOpen(false)} />}
      {textOpen && <TextSheet doc={doc} onClose={() => setTextOpen(false)} onRunOcr={doOcr} />}
      {importing && <BusyOverlay title="Importing" detail={importing.name} progress={importing.total ? importing.done / importing.total : null} />}
      {ocr && <BusyOverlay title="Recognizing text" detail={ocr.total ? `Page ${ocr.page} of ${ocr.total} · on this device` : 'Loading the OCR engine…'} progress={ocr.total ? ocr.fraction : null} />}
    </main>
  );
}

function RenameField({ doc, onDone }: { doc: DocumentRecord; onDone: () => void }) {
  const [value, setValue] = useState(doc.title);
  const save = () => {
    mutateDoc(doc.id, (d) => renameDocument(d, value, Date.now())).catch((err) => reportError(err, 'Could not rename the document.'));
    onDone();
  };
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input className="input grow" value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={120} aria-label="Document name" enterKeyHint="done" onBlur={save} />
    </form>
  );
}

function PageThumb({ page, index }: { page: Page; index: number }) {
  return (
    <div className="thumb">
      <BlobImage blobId={page.thumbBlobId} alt={`Page ${index + 1}`} />
      {page.kind === 'image' && page.state === 'pending' && (
        <div className="thumb__state">
          <span className="spinner" aria-hidden />
          <span>Processing</span>
        </div>
      )}
      {page.kind === 'image' && page.state === 'error' && (
        <div className="thumb__state thumb__state--error">
          <TriangleAlert size={20} aria-hidden />
          <span>{page.error ?? 'Failed'}</span>
        </div>
      )}
    </div>
  );
}

function SortablePage({ page, index, onOpen }: { page: Page; index: number; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  return (
    <li
      ref={setNodeRef}
      className={`page-tile ${isDragging ? 'page-tile--drag' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className="page-tile__btn" onClick={onOpen} {...attributes} {...listeners} aria-label={`Page ${index + 1}. Tap for options, or hold to drag.`}>
        <PageThumb page={page} index={index} />
        <span className="page-tile__num mono">{index + 1}</span>
        {page.kind === 'pdf' && <span className="page-tile__tag badge">PDF</span>}
        {page.kind === 'image' && page.ocr && <span className="page-tile__tag badge badge--cyan">Text</span>}
      </button>
    </li>
  );
}

function PageActions({ doc, pageId, onClose }: { doc: DocumentRecord; pageId: string; onClose: () => void }) {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  const page = doc.pages[index];
  if (!page) return null;
  const run = (fn: (d: DocumentRecord) => DocumentRecord, close = false) => {
    mutateDoc(doc.id, fn)
      .then(() => {
        if (page.kind === 'image') {
          const next = useApp.getState().docs[doc.id]?.pages.find((p) => p.id === pageId);
          if (next?.kind === 'image' && next.state === 'pending') void reprocessPage(doc.id, pageId);
        }
      })
      .catch((err) => reportError(err, 'Could not update the page.'));
    if (close) onClose();
  };
  const last = doc.pages.length - 1;
  return (
    <Sheet title={`Page ${index + 1} of ${doc.pages.length}`} onClose={onClose}>
      <div className="page-actions">
        <div className="page-actions__preview">
          <PageThumb page={page} index={index} />
        </div>
        <div className="action-grid">
          {page.kind === 'image' && (
            <button
              type="button"
              className="action"
              onClick={() => {
                onClose();
                navigate({ name: 'editor', docId: doc.id, pageId });
              }}
            >
              <Crop size={22} />
              <span>Crop & filter</span>
            </button>
          )}
          <button type="button" className="action" onClick={() => run((d) => rotatePage(d, pageId, -90, Date.now()))}>
            <RotateCcw size={22} />
            <span>Rotate left</span>
          </button>
          <button type="button" className="action" onClick={() => run((d) => rotatePage(d, pageId, 90, Date.now()))}>
            <RotateCw size={22} />
            <span>Rotate right</span>
          </button>
          <button type="button" className="action" disabled={index === 0} onClick={() => run((d) => movePage(d, index, index - 1, Date.now()))}>
            <ArrowUp size={22} />
            <span>Move earlier</span>
          </button>
          <button type="button" className="action" disabled={index === last} onClick={() => run((d) => movePage(d, index, index + 1, Date.now()))}>
            <ArrowDown size={22} />
            <span>Move later</span>
          </button>
          <button type="button" className="action" onClick={() => run((d) => duplicatePage(d, pageId, newId(), Date.now()), true)}>
            <Copy size={22} />
            <span>Duplicate</span>
          </button>
          {page.kind === 'image' && (
            <button
              type="button"
              className="action"
              onClick={() => {
                onClose();
                navigate({ name: 'camera', docId: doc.id, retakePageId: pageId });
              }}
            >
              <Camera size={22} />
              <span>Retake</span>
            </button>
          )}
          {page.kind === 'image' && page.state === 'error' && (
            <button
              type="button"
              className="action"
              onClick={() => {
                run((d) => ({ ...d, pages: d.pages.map((p) => (p.id === pageId && p.kind === 'image' ? { ...p, state: 'pending' as const, error: undefined } : p)) }), true);
              }}
            >
              <RefreshCw size={22} />
              <span>Retry</span>
            </button>
          )}
          <button
            type="button"
            className="action action--danger"
            onClick={() => {
              onClose();
              void deletePageWithUndo(doc.id, pageId);
            }}
          >
            <Trash2 size={22} />
            <span>Delete page</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function TextSheet({ doc, onClose, onRunOcr }: { doc: DocumentRecord; onClose: () => void; onRunOcr: () => void }) {
  const text = documentText(doc);
  const first = doc.pages.find((p) => p.kind === 'image' && p.ocr);
  const insights = useMemo(() => analyze(first?.kind === 'image' ? first.ocr : null, text), [first, text]);
  const missing = doc.pages.filter((p) => p.kind === 'image' && p.state === 'ready' && !p.ocr).length;
  const avg = useMemo(() => {
    const confs = doc.pages.flatMap((p) => (p.kind === 'image' && p.ocr ? [p.ocr.confidence] : []));
    return confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null;
  }, [doc]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Text copied.');
    } catch {
      toast('error', 'Copying is blocked here. Select the text and copy it manually.');
    }
  };

  const applyName = (name: string) => {
    mutateDoc(doc.id, (d) => renameDocument(d, name, Date.now()))
      .then(() => toast('success', 'Renamed.'))
      .catch((err) => reportError(err, 'Could not rename.'));
  };

  return (
    <Sheet title="Recognized text" onClose={onClose}>
      <div className="stack">
        <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Recognized on this device with Tesseract OCR{avg !== null ? ` · average confidence ${avg}%` : ''}. OCR can misread characters — check
          anything important against the scan.
        </p>
        {missing > 0 && (
          <Button onClick={onRunOcr} icon={<ScanText size={18} />}>
            Recognize {missing} more page{missing === 1 ? '' : 's'}
          </Button>
        )}
        {(insights.suggestedName || insights.category || insights.dates.length > 0 || insights.identifiers.length > 0) && (
          <div className="insights panel">
            <div className="label row">
              <Sparkles size={14} /> Found in the text
            </div>
            {insights.suggestedName && (
              <div className="row row--between">
                <span className="grow">
                  <span className="faint">Suggested name: </span>
                  {insights.suggestedName}
                </span>
                <Button size="sm" onClick={() => applyName(insights.suggestedName!)}>
                  Use
                </Button>
              </div>
            )}
            {insights.title && insights.title !== insights.suggestedName && (
              <div className="row row--between">
                <span className="grow">
                  <span className="faint">Heading: </span>
                  {insights.title}
                </span>
                <Button size="sm" onClick={() => applyName(insights.title!)}>
                  Use
                </Button>
              </div>
            )}
            {insights.category && (
              <div>
                <span className="faint">Looks like: </span>
                {insights.category.name} <span className="faint">(keywords: {insights.category.evidence.join(', ')})</span>
              </div>
            )}
            {insights.dates.length > 0 && (
              <div>
                <span className="faint">Dates: </span>
                {insights.dates.slice(0, 5).map((d) => d.raw).join(' · ')}
              </div>
            )}
            {insights.identifiers.length > 0 && (
              <div>
                <span className="faint">References: </span>
                {insights.identifiers.map((i) => `${i.label} ${i.value}`).join(' · ')}
              </div>
            )}
          </div>
        )}
        {text ? (
          <>
            <pre className="ocr-text">{text}</pre>
            <Button block onClick={copy} icon={<Copy size={18} />}>
              Copy all text
            </Button>
          </>
        ) : (
          <p className="muted">No text was recognized yet.</p>
        )}
      </div>
    </Sheet>
  );
}
