import type { Collection, DocumentRecord, ExportEvent, FilterPreset, ImagePage, Page, Quad, Settings } from '../types/models';
import { getState, initialUnlockedData, setState, type ConfirmRequest, type Route, type Toast } from './store';
import * as repo from '../lib/storage/repo';
import { type BlobWrite } from '../lib/storage/repo';
import { clearBlobUrls } from '../lib/storage/blobUrls';
import { describeError, StorageError } from '../lib/storage/errors';
import { readVault, lock as lockVault } from '../lib/security/vault';
import { AutoLock, policyFor } from '../lib/security/autoLock';
import { addPages, createDocument, normalizeRotation, removePage, replacePage, rotateOcr } from '../lib/document/model';
import { newId } from '../lib/document/ids';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings';
import { failedPage, pageFromImage, renderPage } from '../lib/imaging/pipeline';
import { shutdownVision } from '../lib/vision/cvClient';
import { isNearDuplicate } from '../lib/imaging/hash';

/* ------------------------------------------------------------------ */
/* Feedback                                                           */
/* ------------------------------------------------------------------ */

let toastSeq = 0;

export function toast(kind: Toast['kind'], message: string, opts: { action?: Toast['action']; ms?: number } = {}): number {
  const id = ++toastSeq;
  const ms = opts.ms ?? (kind === 'error' ? 7000 : opts.action ? 7000 : 3500);
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, message, action: opts.action, ms }] }));
  return id;
}

export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function confirmAction(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    getState().confirm?.resolve(false);
    setState({
      confirm: {
        ...req,
        resolve: (ok) => {
          setState({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}

/** Report an error unless it is just the app having locked mid-operation. */
export function reportError(err: unknown, fallback: string): void {
  if (err instanceof StorageError && err.code === 'locked') return;
  if (getState().phase !== 'unlocked') return;
  console.error(fallback, err instanceof Error ? err.name : '');
  toast('error', describeError(err, fallback));
}

/* ------------------------------------------------------------------ */
/* Navigation (no document data ever goes into the URL or history)    */
/* ------------------------------------------------------------------ */

let historyDepth = 0;

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  // Informational toasts belong to the screen that raised them; errors stay visible.
  setState((s) => ({ toasts: s.toasts.filter((t) => t.kind === 'error' || t.action) }));
  setState((s) => {
    if (opts.replace) return { route };
    return { route, stack: [...s.stack, s.route] };
  });
  if (!opts.replace) {
    historyDepth++;
    history.pushState({ ncs: historyDepth }, '');
  }
  window.scrollTo(0, 0);
}

/** Pop one screen. Called by in-app back buttons and the browser's back gesture. */
function popRoute(): void {
  setState((s) => {
    if (!s.stack.length) return {};
    const stack = s.stack.slice();
    const route = stack.pop()!;
    return { route, stack };
  });
}

export function goBack(): void {
  if (historyDepth > 0) history.back();
  else popRoute();
}

export function goHome(): void {
  const depth = getState().stack.length;
  setState({ route: { name: 'home' }, stack: [] });
  if (depth && historyDepth >= depth) {
    historyDepth -= depth;
    ignorePops += 1;
    history.go(-depth);
  }
}

let ignorePops = 0;

export function installHistory(): void {
  history.replaceState({ ncs: 0 }, '');
  window.addEventListener('popstate', () => {
    if (ignorePops) {
      ignorePops--;
      return;
    }
    historyDepth = Math.max(0, historyDepth - 1);
    if (getState().phase === 'unlocked') popRoute();
  });
}

/* ------------------------------------------------------------------ */
/* Lock lifecycle                                                     */
/* ------------------------------------------------------------------ */

const autoLock = new AutoLock({
  onLock: () => lockApp(),
  policy: () => policyFor(getState().settings.lockTimeout),
});

/** Let a system UI (native camera, file picker, share sheet) background the app without locking. */
export const suspendAutoLock = () => autoLock.suspend();
/** Keep the idle timer from locking during a long operation. */
export const holdAwake = () => autoLock.hold();

export async function boot(): Promise<void> {
  try {
    const meta = await readVault();
    setState({
      phase: meta ? 'locked' : 'setup',
      vaultKind: meta?.kind ?? null,
      hasPasskey: !!meta?.passkey,
    });
  } catch (err) {
    setState({ phase: 'fatal', fatal: describeError(err, 'On-device storage could not be opened.') });
  }
}

export async function refreshVaultInfo(): Promise<void> {
  const meta = await readVault();
  setState({ vaultKind: meta?.kind ?? null, hasPasskey: !!meta?.passkey });
}

/** Called once the session key is installed. */
export async function afterUnlock(): Promise<void> {
  let settings: Settings = DEFAULT_SETTINGS;
  try {
    settings = await loadSettings();
  } catch {
    /* defaults */
  }
  setState({ ...initialUnlockedData(), settings, phase: 'unlocked' });
  autoLock.start();
  historyDepth = 0;
  history.replaceState({ ncs: 0 }, '');
  await reloadLibrary();
  void refreshVaultInfo();
}

export async function reloadLibrary(): Promise<void> {
  try {
    const [lib, collections] = await Promise.all([repo.listDocuments(), repo.loadSecureMeta<Collection[]>('collections', [])]);
    const docs: Record<string, DocumentRecord> = {};
    lib.docs.forEach((d) => (docs[d.id] = d));
    setState({ docs, damaged: lib.damaged, collections, libraryLoaded: true });
    if (lib.damaged.length) {
      toast('error', `${lib.damaged.length} stored document${lib.damaged.length > 1 ? 's are' : ' is'} damaged and cannot be opened. See Settings › Storage.`);
    }
    // Housekeeping: drop images no document references (e.g. after a crash mid-edit).
    void repo.sweepAll(lib.docs, lib.damaged).catch(() => undefined);
  } catch (err) {
    setState({ libraryLoaded: true });
    reportError(err, 'Could not load your documents.');
  }
}

/**
 * Lock: discard the key, stop engines, revoke decrypted image URLs and wipe
 * decrypted metadata from memory. The UI then renders only the lock screen.
 */
export function lockApp(): void {
  if (getState().phase !== 'unlocked') return;
  autoLock.stop();
  lockVault();
  shutdownVision();
  void import('../lib/ocr/ocr').then((m) => m.shutdownOcr());
  clearBlobUrls();
  getState().confirm?.resolve(false);
  sweepTimers.forEach((t) => clearTimeout(t));
  sweepTimers.clear();
  setState({ ...initialUnlockedData(), phase: 'locked', toasts: [], confirm: null });
}

export function setShield(on: boolean): void {
  if (getState().shield !== on) setState({ shield: on });
}

/* ------------------------------------------------------------------ */
/* Settings & collections                                             */
/* ------------------------------------------------------------------ */

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const prev = getState().settings;
  const next = { ...prev, ...patch, pdf: { ...prev.pdf, ...(patch.pdf ?? {}) } };
  setState({ settings: next });
  try {
    await saveSettings(next);
  } catch (err) {
    setState({ settings: prev });
    reportError(err, 'Could not save settings.');
  }
}

async function saveCollections(next: Collection[]): Promise<boolean> {
  try {
    await repo.saveSecureMeta('collections', next);
    setState({ collections: next });
    return true;
  } catch (err) {
    reportError(err, 'Could not save folders.');
    return false;
  }
}

export async function createCollection(name: string): Promise<Collection | null> {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return null;
  const c: Collection = { id: newId(), name: clean, createdAt: Date.now() };
  return (await saveCollections([...getState().collections, c])) ? c : null;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return;
  await saveCollections(getState().collections.map((c) => (c.id === id ? { ...c, name: clean } : c)));
}

/** Deleting a folder keeps its documents (they move to "All documents"). */
export async function deleteCollection(id: string): Promise<void> {
  const affected = Object.values(getState().docs).filter((d) => d.collectionId === id);
  for (const d of affected) await mutateDoc(d.id, (x) => ({ ...x, collectionId: null }));
  await saveCollections(getState().collections.filter((c) => c.id !== id));
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

const locks = new Map<string, Promise<unknown>>();

/**
 * Serialize writes per document and always apply changes to the latest
 * version, so concurrent edits (e.g. a page finishing processing while the
 * user renames the document) never overwrite each other. State is updated
 * only after the encrypted write has committed.
 */
export function mutateDoc(
  docId: string,
  fn: (doc: DocumentRecord) => DocumentRecord,
  blobs: BlobWrite[] = [],
): Promise<DocumentRecord | null> {
  const prev = locks.get(docId) ?? Promise.resolve();
  const run = prev.then(async () => {
    const current = getState().docs[docId];
    if (!current) {
      if (getState().phase !== 'unlocked') throw new StorageError('locked');
      return null;
    }
    const next = fn(current);
    if (next === current && !blobs.length) return current;
    await repo.commit({ docs: [next], blobs });
    // If the app locked while we were writing, keep decrypted data out of memory.
    if (getState().phase === 'unlocked') setState((s) => ({ docs: { ...s.docs, [docId]: next } }));
    return next;
  });
  locks.set(
    docId,
    run.catch(() => undefined),
  );
  return run;
}

export async function insertDoc(doc: DocumentRecord, blobs: BlobWrite[] = []): Promise<void> {
  await repo.commit({ docs: [doc], blobs });
  if (getState().phase === 'unlocked') setState((s) => ({ docs: { ...s.docs, [doc.id]: doc } }));
}

export async function createDraft(): Promise<DocumentRecord> {
  const doc = createDocument(newId(), Date.now());
  await insertDoc(doc);
  return doc;
}

export async function deleteDocs(ids: string[]): Promise<void> {
  await repo.commit({ deleteDocIds: ids });
  setState((s) => {
    const docs = { ...s.docs };
    ids.forEach((id) => delete docs[id]);
    return { docs };
  });
}

export async function deleteDamagedRecords(): Promise<void> {
  const ids = getState().damaged;
  if (!ids.length) return;
  await repo.deleteDamaged(ids);
  setState({ damaged: [] });
}

/** Full copy, including re-encrypted images, so the two documents are independent. */
export async function duplicateDoc(docId: string): Promise<DocumentRecord | null> {
  const src = getState().docs[docId];
  if (!src) return null;
  const id = newId();
  const remap = new Map<string, string>();
  const mapId = (old: string | null) => {
    if (!old) return old;
    if (!remap.has(old)) remap.set(old, newId());
    return remap.get(old)!;
  };
  const pages: Page[] = src.pages.map((p) =>
    p.kind === 'image'
      ? { ...p, id: newId(), originalBlobId: mapId(p.originalBlobId)!, processedBlobId: mapId(p.processedBlobId), thumbBlobId: mapId(p.thumbBlobId) }
      : { ...p, id: newId(), thumbBlobId: mapId(p.thumbBlobId) },
  );
  const pdfSources = src.pdfSources.map((s) => ({ ...s, blobId: mapId(s.blobId)! }));
  const now = Date.now();
  const copy: DocumentRecord = { ...src, id, title: `${src.title} copy`, pages, pdfSources, createdAt: now, updatedAt: now, exports: [], status: 'saved' };
  // Copy blobs one at a time to bound memory.
  for (const [oldId, newBlobId] of remap) {
    const blob = await repo.getBlob(oldId);
    await repo.commit({ blobs: [{ id: newBlobId, docId: id, blob }] });
  }
  await insertDoc(copy);
  return copy;
}

const sweepTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Delete unreferenced images of a document after an undo window has passed. */
export function scheduleSweep(docId: string, delayMs = 9000): void {
  clearTimeout(sweepTimers.get(docId));
  sweepTimers.set(
    docId,
    setTimeout(() => {
      sweepTimers.delete(docId);
      const doc = getState().docs[docId];
      if (doc) void repo.sweepDocument(doc).catch(() => undefined);
    }, delayMs),
  );
}

/** Delete a page with an Undo option. The images survive until the undo window closes. */
export async function deletePageWithUndo(docId: string, pageId: string): Promise<void> {
  const doc = getState().docs[docId];
  const index = doc?.pages.findIndex((p) => p.id === pageId) ?? -1;
  if (!doc || index < 0) return;
  const page = doc.pages[index];
  const source = page.kind === 'pdf' ? doc.pdfSources.find((s) => s.id === page.sourceId) : undefined;
  try {
    await mutateDoc(docId, (d) => removePage(d, pageId, Date.now()));
  } catch (err) {
    reportError(err, 'Could not delete the page.');
    return;
  }
  toast('info', `Page ${index + 1} deleted`, {
    action: {
      label: 'Undo',
      run: () => {
        void mutateDoc(docId, (d) => {
          const restored = addPages(d, [page], Date.now(), index);
          return source && !restored.pdfSources.some((s) => s.id === source.id)
            ? { ...restored, pdfSources: [...restored.pdfSources, source] }
            : restored;
        }).catch((err) => reportError(err, 'Could not restore the page.'));
      },
    },
  });
  scheduleSweep(docId);
}

export async function recordExport(docId: string, event: ExportEvent): Promise<void> {
  try {
    await mutateDoc(docId, (d) => ({ ...d, exports: [...d.exports.slice(-19), event] }));
  } catch {
    /* the export itself already happened; failing to log it is not fatal */
  }
}

/* ------------------------------------------------------------------ */
/* Page processing                                                    */
/* ------------------------------------------------------------------ */

const inFlight = new Set<string>();

/** Re-render one image page from its original (after crop/filter/rotation edits). */
export async function reprocessPage(docId: string, pageId: string): Promise<void> {
  const key = `${docId}:${pageId}`;
  if (inFlight.has(key)) return;
  const page = getState().docs[docId]?.pages.find((p) => p.id === pageId);
  if (!page || page.kind !== 'image') return;
  inFlight.add(key);
  const release = holdAwake();
  try {
    const original = await repo.getBlob(page.originalBlobId);
    const latest = getState().docs[docId]?.pages.find((p) => p.id === pageId) as ImagePage | undefined;
    if (!latest) return;
    const r = await renderPage(docId, latest, original);
    await mutateDoc(
      docId,
      (d) => {
        const cur = d.pages.find((p) => p.id === pageId);
        // Discard the result if the page changed again meanwhile; that change re-renders.
        if (!cur || cur.kind !== 'image' || cur.rotation !== latest.rotation || cur.filter !== latest.filter || JSON.stringify(cur.corners) !== JSON.stringify(latest.corners)) {
          return d;
        }
        return replacePage(d, { ...r.page, ocr: cur.ocr }, Date.now());
      },
      r.blobs,
    );
    scheduleSweep(docId, 2000);
  } catch (err) {
    if (err instanceof StorageError && err.code === 'locked') return;
    const message = err instanceof StorageError && err.code === 'missing' ? 'Original image is missing' : 'Processing failed';
    await mutateDoc(docId, (d) => {
      const cur = d.pages.find((p) => p.id === pageId);
      return cur && cur.kind === 'image' ? replacePage(d, { ...cur, state: 'error', error: message }, Date.now()) : d;
    }).catch(() => undefined);
    reportError(err, 'A page could not be processed.');
  } finally {
    inFlight.delete(key);
    release();
  }
  // If another edit arrived while we worked, process again.
  const after = getState().docs[docId]?.pages.find((p) => p.id === pageId);
  if (after?.kind === 'image' && after.state === 'pending') void reprocessPage(docId, pageId);
}

/** Resume pages left unprocessed by an interrupted session (reload, crash, lock). */
export function resumePending(docId: string): void {
  const doc = getState().docs[docId];
  doc?.pages.forEach((p) => {
    if (p.kind === 'image' && p.state === 'pending') void reprocessPage(docId, p.id);
  });
}

export async function updateImagePage(docId: string, pageId: string, patch: Partial<Pick<ImagePage, 'corners' | 'filter' | 'rotation' | 'ocr'>>): Promise<void> {
  const needsRender = 'corners' in patch || 'filter' in patch || 'rotation' in patch;
  await mutateDoc(docId, (d) => {
    const cur = d.pages.find((p) => p.id === pageId);
    if (!cur || cur.kind !== 'image') return d;
    const next: ImagePage = { ...cur, ...patch };
    if ('corners' in patch && JSON.stringify(patch.corners) !== JSON.stringify(cur.corners)) next.ocr = null; // geometry changed
    else if (patch.rotation !== undefined && patch.rotation !== cur.rotation && cur.ocr) {
      next.ocr = rotateOcr(cur.ocr, normalizeRotation(patch.rotation - cur.rotation));
    }
    if (needsRender) next.state = 'pending';
    return replacePage(d, next, Date.now());
  });
  if (needsRender) void reprocessPage(docId, pageId);
}

/**
 * Add a captured or picked photo to a document. The original is saved even
 * if processing fails, so a capture is never lost; the page can be retried.
 */
export async function addPhoto(
  docId: string,
  blob: Blob,
  opts: { filter: FilterPreset; detect: boolean; fallbackQuad?: Quad | null; replacePageId?: string },
): Promise<ImagePage | null> {
  const release = holdAwake();
  try {
    let result;
    try {
      result = await pageFromImage(docId, blob, { detect: opts.detect, filter: opts.filter, fallbackQuad: opts.fallbackQuad });
    } catch (err) {
      if (err instanceof StorageError && err.code === 'locked') return null;
      result = failedPage(docId, blob, opts.filter, 'Processing failed — tap to retry');
    }
    const page = result.page;
    await mutateDoc(
      docId,
      (d) => {
        if (opts.replacePageId) {
          const idx = d.pages.findIndex((p) => p.id === opts.replacePageId);
          if (idx >= 0) {
            const pages = d.pages.slice();
            pages[idx] = { ...page, id: opts.replacePageId };
            return { ...d, pages, updatedAt: Date.now() };
          }
        }
        return addPages(d, [page], Date.now());
      },
      result.blobs,
    );
    if (opts.replacePageId) scheduleSweep(docId, 2000);
    return opts.replacePageId ? { ...page, id: opts.replacePageId } : page;
  } finally {
    release();
  }
}

/** Find a saved document whose pages look like this one (perceptual hash). */
export function findDuplicate(doc: DocumentRecord): DocumentRecord | null {
  const hashes = doc.pages.map((p) => p.hash).filter(Boolean) as string[];
  if (!hashes.length) return null;
  for (const other of Object.values(getState().docs)) {
    if (other.id === doc.id || other.status !== 'saved') continue;
    if (other.pages.some((p) => hashes.some((h) => isNearDuplicate(h, p.hash)))) return other;
  }
  return null;
}

export async function markSaved(docId: string): Promise<void> {
  await mutateDoc(docId, (d) => (d.status === 'saved' ? d : { ...d, status: 'saved', updatedAt: Date.now() }));
}
