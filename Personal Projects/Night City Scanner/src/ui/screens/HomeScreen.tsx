import { useMemo, useState } from 'react';
import { ChevronRight, FileUp, FolderOpen, HardDrive, Lock, ScanLine, Search, Settings as SettingsIcon, ShieldCheck, Trash2, X } from 'lucide-react';
import { useApp } from '../../state/store';
import { confirmAction, createDraft, deleteDocs, lockApp, navigate, reportError, updateSettings } from '../../state/actions';
import { importIntoDocument, type ImportProgress } from '../../state/importFlow';
import { sortDocuments } from '../../lib/document/model';
import { formatBytes } from '../../lib/export/share';
import { BrandMark } from '../Brand';
import { DocCard } from '../DocCard';
import { BusyOverlay } from '../BusyOverlay';
import { Button, formatDate, IconButton, Spinner } from '../kit';
import { useFilePicker, useStorageStatus } from '../hooks';

export function HomeScreen() {
  const docsMap = useApp((s) => s.docs);
  const loaded = useApp((s) => s.libraryLoaded);
  const tipsDismissed = useApp((s) => s.settings.firstRunTipsDismissed);
  const pick = useFilePicker();
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const docs = useMemo(() => Object.values(docsMap), [docsMap]);
  const drafts = useMemo(() => sortDocuments(docs.filter((d) => d.status === 'draft'), 'updated'), [docs]);
  const recent = useMemo(() => sortDocuments(docs.filter((d) => d.status === 'saved'), 'updated').slice(0, 4), [docs]);
  const savedCount = docs.length - drafts.length;
  const notExported = docs.filter((d) => d.status === 'saved' && !d.exports.length).length;
  const storage = useStorageStatus([docs.length]);

  const startScan = async () => {
    setStarting(true);
    try {
      const doc = await createDraft();
      navigate({ name: 'camera', docId: doc.id });
    } catch (err) {
      reportError(err, 'Could not start a new scan.');
    } finally {
      setStarting(false);
    }
  };

  const startImport = async () => {
    const files = await pick({ accept: 'image/*,application/pdf,.pdf,.heic,.heif', multiple: true });
    if (!files.length) return;
    setImporting({ done: 0, total: files.length, name: '' });
    try {
      const id = await importIntoDocument(files, null, setImporting);
      if (id) navigate({ name: 'review', docId: id });
    } catch (err) {
      reportError(err, 'Import failed.');
    } finally {
      setImporting(null);
    }
  };

  const discardDraft = async (id: string, pages: number) => {
    const ok = await confirmAction({
      title: 'Discard unfinished scan?',
      body: pages ? `Its ${pages} captured page${pages === 1 ? '' : 's'} will be permanently deleted.` : 'This empty scan will be removed.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) await deleteDocs([id]).catch((err) => reportError(err, 'Could not delete the scan.'));
  };

  const usagePct = storage?.usage && storage.quota ? storage.usage / storage.quota : null;

  return (
    <main className="screen home">
      <header className="home__header">
        <BrandMark compact />
        <div className="row">
          <IconButton label="Lock now" onClick={lockApp}>
            <Lock size={20} />
          </IconButton>
          <IconButton label="Settings" onClick={() => navigate({ name: 'settings' })}>
            <SettingsIcon size={22} />
          </IconButton>
        </div>
      </header>

      <div className="content stack home__content">
        <button type="button" className="scan-cta" onClick={startScan} disabled={starting}>
          <span className="scan-cta__glow" aria-hidden />
          <span className="scan-cta__icon">{starting ? <Spinner /> : <ScanLine size={34} />}</span>
          <span className="scan-cta__text">
            <span className="scan-cta__title">Scan document</span>
            <span className="scan-cta__sub">Auto edge detection · multipage · PDF</span>
          </span>
          <ChevronRight size={24} className="scan-cta__chev" aria-hidden />
        </button>

        <div className="quick">
          <button type="button" className="quick__btn panel" onClick={startImport}>
            <FileUp size={22} />
            <span>Import</span>
          </button>
          <button type="button" className="quick__btn panel" onClick={() => navigate({ name: 'library' })}>
            <FolderOpen size={22} />
            <span>Library</span>
          </button>
          <button type="button" className="quick__btn panel" onClick={() => navigate({ name: 'library', focusSearch: true })}>
            <Search size={22} />
            <span>Search</span>
          </button>
        </div>

        {!tipsDismissed && (
          <div className="tip panel panel--accent">
            <div className="grow">
              <div className="label" style={{ color: 'var(--c-cyan)' }}>
                How saving works
              </div>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                Scans are kept <strong>encrypted inside this app</strong>. To keep a copy in the Files app, use <strong>Export → Share → Save to Files</strong>. Browser storage can be cleared, so export anything important.
              </p>
            </div>
            <IconButton label="Dismiss tip" size="sm" onClick={() => void updateSettings({ firstRunTipsDismissed: true })}>
              <X size={18} />
            </IconButton>
          </div>
        )}

        {drafts.length > 0 && (
          <section className="stack" aria-labelledby="drafts-h">
            <h2 className="section-h" id="drafts-h">
              Unfinished scans
            </h2>
            {drafts.map((d) => (
              <div key={d.id} className="draft panel">
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 600 }}>
                    {d.title}
                  </div>
                  <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                    {d.pages.length} page{d.pages.length === 1 ? '' : 's'} · {formatDate(d.updatedAt, true)} · saved on device
                  </div>
                </div>
                <IconButton label={`Discard ${d.title}`} onClick={() => discardDraft(d.id, d.pages.length)}>
                  <Trash2 size={20} />
                </IconButton>
                <Button size="sm" variant="primary" onClick={() => navigate(d.pages.length ? { name: 'review', docId: d.id } : { name: 'camera', docId: d.id })}>
                  Resume
                </Button>
              </div>
            ))}
          </section>
        )}

        <section className="stack" aria-labelledby="recent-h">
          <div className="row row--between">
            <h2 className="section-h" id="recent-h">
              Recent
            </h2>
            {savedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'library' })}>
                All {savedCount} <ChevronRight size={16} />
              </Button>
            )}
          </div>
          {!loaded ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : recent.length ? (
            <div className="doc-list">
              {recent.map((d) => (
                <DocCard key={d.id} doc={d} onOpen={() => navigate({ name: 'review', docId: d.id })} />
              ))}
            </div>
          ) : (
            <div className="empty panel">
              <svg className="empty__art" viewBox="0 0 96 96" fill="none" aria-hidden>
                <path d="M26 12h32l14 14v58H26z" stroke="currentColor" strokeWidth="2" opacity=".7" />
                <path d="M58 12v14h14" stroke="currentColor" strokeWidth="2" opacity=".7" />
                <path d="M14 50h68" stroke="#ff2a6d" strokeWidth="3" strokeLinecap="round" />
                <path d="M36 36h20M36 64h26M36 72h16" stroke="#8590a0" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <h3 className="empty__title">No documents yet</h3>
              <p className="muted">Scan your first page — edges are found and straightened automatically.</p>
              <Button variant="primary" onClick={startScan} icon={<ScanLine size={20} />}>
                Scan first document
              </Button>
            </div>
          )}
        </section>

        <section className="storage-line" aria-label="Storage status">
          <ShieldCheck size={18} className="storage-line__icon" aria-hidden />
          <div className="grow">
            <div>
              {savedCount} document{savedCount === 1 ? '' : 's'} · encrypted on this device
            </div>
            <div className="faint">
              {storage?.usage != null ? `${formatBytes(storage.usage)} used` : 'Usage unavailable'}
              {storage?.quota ? ` of ~${formatBytes(storage.quota)} available to this app` : ''}
              {storage?.persisted === false ? ' · may be cleared by iOS if space runs low' : ''}
            </div>
            {notExported > 0 && (
              <div className="storage-line__warn">
                {notExported} document{notExported === 1 ? ' has' : 's have'} never been exported.
              </div>
            )}
            {usagePct !== null && usagePct > 0.8 && <div className="storage-line__warn">Storage is almost full. Export and delete documents to free space.</div>}
          </div>
          <IconButton label="Storage settings" onClick={() => navigate({ name: 'settings' })}>
            <HardDrive size={20} />
          </IconButton>
        </section>
      </div>
      {importing && <BusyOverlay title="Importing" detail={importing.name} progress={importing.total ? importing.done / importing.total : null} />}
    </main>
  );
}
