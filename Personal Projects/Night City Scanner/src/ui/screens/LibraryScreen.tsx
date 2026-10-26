import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FolderInput, FolderPlus, Pencil, ScanLine, Search, Share, Trash2, X, FolderOpen } from 'lucide-react';
import type { DocumentRecord } from '../../types/models';
import { useApp } from '../../state/store';
import {
  confirmAction,
  createCollection,
  createDraft,
  deleteCollection,
  deleteDocs,
  duplicateDoc,
  goBack,
  mutateDoc,
  navigate,
  renameCollection,
  reportError,
  toast,
} from '../../state/actions';
import { renameDocument, searchDocuments, sortDocuments, type SortKey } from '../../lib/document/model';
import { DocCard } from '../DocCard';
import { Button, IconButton, Segmented, Sheet, Switch, TopBar } from '../kit';
import { ExportSheet } from './ExportSheet';

export default function LibraryScreen({ collectionId, focusSearch }: { collectionId: string | null; focusSearch?: boolean }) {
  const docsMap = useApp((s) => s.docs);
  const collections = useApp((s) => s.collections);
  const [query, setQuery] = useState('');
  const [inText, setInText] = useState(true);
  const [sort, setSort] = useState<SortKey>('updated');
  const [folder, setFolder] = useState<string | null>(collectionId);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [exportFor, setExportFor] = useState<string | null>(null);
  const [folderSheet, setFolderSheet] = useState<null | { mode: 'new' } | { mode: 'edit'; id: string }>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const all = useMemo(() => Object.values(docsMap), [docsMap]);
  const hasText = all.some((d) => d.pages.some((p) => p.kind === 'image' && p.ocr));
  const visible = useMemo(() => {
    const inFolder = folder ? all.filter((d) => d.collectionId === folder) : all;
    return sortDocuments(searchDocuments(inFolder, query, inText && hasText), sort);
  }, [all, folder, query, inText, hasText, sort]);

  const menuDoc = menuFor ? docsMap[menuFor] : null;
  const exportDoc = exportFor ? docsMap[exportFor] : null;
  const currentFolder = collections.find((c) => c.id === folder);

  const startScan = async () => {
    try {
      const d = await createDraft();
      if (folder) await mutateDoc(d.id, (x) => ({ ...x, collectionId: folder }));
      navigate({ name: 'camera', docId: d.id });
    } catch (err) {
      reportError(err, 'Could not start a scan.');
    }
  };

  return (
    <main className="screen library">
      <TopBar
        title="Library"
        onBack={goBack}
        end={
          <IconButton label="New folder" onClick={() => setFolderSheet({ mode: 'new' })}>
            <FolderPlus size={22} />
          </IconButton>
        }
      />
      <div className="content stack">
        <div className="search">
          <Search size={18} className="search__icon" aria-hidden />
          <input
            ref={searchRef}
            className="input search__input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            placeholder={hasText && inText ? 'Search names and recognized text' : 'Search by name'}
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {query && (
            <IconButton className="search__clear" label="Clear search" size="sm" onClick={() => setQuery('')}>
              <X size={18} />
            </IconButton>
          )}
        </div>
        {hasText && (
          <div className="row row--between">
            <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
              Include recognized text
            </span>
            <Switch checked={inText} onChange={setInText} label="Include recognized text in search" />
          </div>
        )}

        <div className="chips" role="group" aria-label="Folders">
          <button type="button" className="chip" aria-pressed={folder === null} onClick={() => setFolder(null)}>
            All · {all.length}
          </button>
          {collections.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={folder === c.id} onClick={() => setFolder(c.id)}>
              <FolderOpen size={14} aria-hidden /> {c.name} · {all.filter((d) => d.collectionId === c.id).length}
            </button>
          ))}
        </div>
        {currentFolder && (
          <div className="row row--between">
            <span className="label">Folder: {currentFolder.name}</span>
            <Button size="sm" variant="ghost" icon={<Pencil size={16} />} onClick={() => setFolderSheet({ mode: 'edit', id: currentFolder.id })}>
              Edit folder
            </Button>
          </div>
        )}

        <Segmented
          label="Sort by"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'updated', label: 'Last edited' },
            { value: 'created', label: 'Created' },
            { value: 'name', label: 'Name' },
          ]}
        />

        {visible.length ? (
          <div className="doc-list" aria-live="polite">
            {visible.map((d) => (
              <DocCard key={d.id} doc={d} onOpen={() => navigate({ name: 'review', docId: d.id })} onMenu={() => setMenuFor(d.id)} />
            ))}
          </div>
        ) : query ? (
          <div className="empty">
            <h3 className="empty__title">No matches</h3>
            <p className="muted">Nothing matches “{query}”.</p>
          </div>
        ) : (
          <div className="empty panel">
            <h3 className="empty__title">{folder ? 'This folder is empty' : 'Your library is empty'}</h3>
            <p className="muted">Scanned documents appear here, encrypted on this device.</p>
            <Button variant="primary" onClick={startScan} icon={<ScanLine size={20} />}>
              Scan a document
            </Button>
          </div>
        )}
      </div>

      {menuDoc && (
        <DocMenu
          doc={menuDoc}
          onClose={() => setMenuFor(null)}
          onExport={() => {
            setMenuFor(null);
            setExportFor(menuDoc.id);
          }}
        />
      )}
      {exportDoc && <ExportSheet doc={exportDoc} onClose={() => setExportFor(null)} />}
      {folderSheet && <FolderSheet state={folderSheet} onClose={() => setFolderSheet(null)} onDeleted={() => setFolder(null)} />}
    </main>
  );
}

function DocMenu({ doc, onClose, onExport }: { doc: DocumentRecord; onClose: () => void; onExport: () => void }) {
  const collections = useApp((s) => s.collections);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    try {
      await mutateDoc(doc.id, (d) => renameDocument(d, title, Date.now()));
      onClose();
    } catch (err) {
      reportError(err, 'Could not rename.');
    }
  };
  const move = async (collectionId: string | null) => {
    try {
      await mutateDoc(doc.id, (d) => ({ ...d, collectionId, updatedAt: Date.now() }));
      onClose();
    } catch (err) {
      reportError(err, 'Could not move the document.');
    }
  };
  const duplicate = async () => {
    setBusy(true);
    try {
      const copy = await duplicateDoc(doc.id);
      if (copy) toast('success', `Created “${copy.title}”.`);
      onClose();
    } catch (err) {
      reportError(err, 'Could not duplicate the document.');
      setBusy(false);
    }
  };
  const remove = async () => {
    const neverExported = !doc.exports.length;
    const ok = await confirmAction({
      title: `Delete “${doc.title}”?`,
      body: `All ${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'} will be permanently deleted from this app.${neverExported ? ' This document has never been exported, so no copy exists elsewhere.' : ' Files you already exported are not affected.'}`,
      confirmLabel: 'Delete document',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDocs([doc.id]);
      toast('info', 'Document deleted.');
      onClose();
    } catch (err) {
      reportError(err, 'Could not delete the document.');
    }
  };

  return (
    <Sheet title={doc.title} onClose={onClose}>
      {renaming ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <label className="field">
            <span className="label">Name</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={120} enterKeyHint="done" />
          </label>
          <Button variant="primary" type="submit" block>
            Save name
          </Button>
        </form>
      ) : moving ? (
        <div className="stack">
          <Button block variant={doc.collectionId === null ? 'primary' : 'secondary'} onClick={() => move(null)}>
            No folder
          </Button>
          {collections.map((c) => (
            <Button key={c.id} block variant={doc.collectionId === c.id ? 'primary' : 'secondary'} onClick={() => move(c.id)} icon={<FolderOpen size={18} />}>
              {c.name}
            </Button>
          ))}
          {!collections.length && <p className="muted">No folders yet. Create one with the folder button in the Library header.</p>}
        </div>
      ) : (
        <div className="list panel">
          <button type="button" className="list-row" onClick={onExport}>
            <Share size={20} /> <span className="list-row__text list-row__title">Export…</span>
          </button>
          <button type="button" className="list-row" onClick={() => setRenaming(true)}>
            <Pencil size={20} /> <span className="list-row__text list-row__title">Rename</span>
          </button>
          <button type="button" className="list-row" onClick={() => setMoving(true)}>
            <FolderInput size={20} /> <span className="list-row__text list-row__title">Move to folder</span>
          </button>
          <button type="button" className="list-row" onClick={duplicate} disabled={busy}>
            <Copy size={20} /> <span className="list-row__text list-row__title">{busy ? 'Duplicating…' : 'Duplicate'}</span>
          </button>
          <button type="button" className="list-row list-row--danger" onClick={remove}>
            <Trash2 size={20} /> <span className="list-row__text list-row__title">Delete</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

function FolderSheet({ state, onClose, onDeleted }: { state: { mode: 'new' } | { mode: 'edit'; id: string }; onClose: () => void; onDeleted: () => void }) {
  const collections = useApp((s) => s.collections);
  const existing = state.mode === 'edit' ? collections.find((c) => c.id === state.id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const save = async () => {
    if (state.mode === 'new') {
      if (await createCollection(name)) onClose();
    } else {
      await renameCollection(state.id, name);
      onClose();
    }
  };
  const remove = async () => {
    if (state.mode !== 'edit') return;
    const ok = await confirmAction({
      title: 'Delete folder?',
      body: 'Documents in this folder are kept and moved to “All”.',
      confirmLabel: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    await deleteCollection(state.id);
    onDeleted();
    onClose();
  };
  return (
    <Sheet title={state.mode === 'new' ? 'New folder' : 'Edit folder'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span className="label">Folder name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} enterKeyHint="done" />
        </label>
        <Button variant="primary" type="submit" block disabled={!name.trim()}>
          {state.mode === 'new' ? 'Create folder' : 'Save'}
        </Button>
        {state.mode === 'edit' && (
          <Button variant="danger" block onClick={remove} icon={<Trash2 size={18} />}>
            Delete folder
          </Button>
        )}
      </form>
    </Sheet>
  );
}
