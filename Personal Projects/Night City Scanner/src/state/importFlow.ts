import { getState } from './store';
import { deleteDocs, insertDoc, mutateDoc, toast } from './actions';
import { addPages, createDocument } from '../lib/document/model';
import { newId } from '../lib/document/ids';

export interface ImportProgress {
  done: number;
  total: number;
  name: string;
}

/**
 * Import picked files into an existing document, or into a new one. Each
 * file is committed as soon as it is processed. Returns the document id, or
 * null if nothing could be imported.
 */
export async function importIntoDocument(files: File[], targetDocId: string | null, onProgress: (p: ImportProgress) => void): Promise<string | null> {
  if (!files.length) return null;
  const { importFiles } = await import('../lib/import/importFiles');
  const { settings } = getState();
  let docId = targetDocId;
  let created = false;
  if (!docId) {
    const single = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '').trim() : '';
    const doc = createDocument(newId(), Date.now(), single || undefined);
    await insertDoc(doc);
    docId = doc.id;
    created = true;
  }
  const id = docId;
  const outcome = await importFiles(
    id,
    files,
    { detect: settings.detectOnImport, filter: settings.defaultFilter },
    async (item) => {
      await mutateDoc(
        id,
        (d) => {
          const next = addPages(d, item.pages, Date.now());
          return item.source ? { ...next, pdfSources: [...next.pdfSources, item.source] } : next;
        },
        item.blobs,
      );
    },
    (done, total, name) => onProgress({ done, total, name }),
  );
  if (outcome.problems.length) {
    toast('error', outcome.problems.length === 1 ? outcome.problems[0] : `${outcome.problems.length} files could not be imported. ${outcome.problems[0]}`);
  }
  if (!outcome.imported) {
    if (created) await deleteDocs([id]).catch(() => undefined);
    return null;
  }
  toast('success', `Imported ${outcome.imported} file${outcome.imported === 1 ? '' : 's'}.`);
  return id;
}
