import { describe, expect, it } from 'vitest';
import { commit, deleteDocument, getBlob, getDocument, listDocuments, loadSecureMeta, saveDocument, saveSecureMeta, sweepAll, sweepDocument } from './repo';
import { createVault, lock, unlockWithSecret } from '../security/vault';
import { getDb } from './db';
import { StorageError } from './errors';
import { docWith, imagePage, TEST_ITERATIONS } from '../../test/fixtures';
import { removePage } from '../document/model';

const unlocked = () => createVault('pin', '480315', { iterations: TEST_ITERATIONS });
const blob = (s: string, type = 'image/jpeg') => new Blob([s], { type });

describe('encrypted repository', () => {
  it('saves a document with its images atomically and reads them back', async () => {
    await unlocked();
    const doc = docWith([imagePage('a')], { title: 'Secret lease' });
    await saveDocument(doc, [
      { id: 'a-orig', docId: doc.id, blob: blob('original') },
      { id: 'a-proc', docId: doc.id, blob: blob('processed') },
      { id: 'a-thumb', docId: doc.id, blob: blob('thumb') },
    ]);
    expect((await getDocument(doc.id))?.title).toBe('Secret lease');
    const b = await getBlob('a-proc');
    expect(b.type).toBe('image/jpeg');
    expect(await b.text()).toBe('processed');
  });

  it('stores only ciphertext', async () => {
    await unlocked();
    await saveDocument(docWith([], { title: 'Very Secret Title' }), [{ id: 'x', docId: 'doc-1', blob: blob('PLAINTEXT-IMAGE') }]);
    const db = await getDb();
    const raw = [...(await db.getAll('docs')), ...(await db.getAll('blobs'))];
    const dump = raw.map((r) => new TextDecoder().decode(r.data)).join('|');
    expect(dump).not.toContain('Very Secret Title');
    expect(dump).not.toContain('PLAINTEXT-IMAGE');
  });

  it('persists across a reload and refuses access while locked', async () => {
    await unlocked();
    await saveDocument(docWith([], { id: 'd' }));
    lock();
    await expect(listDocuments()).rejects.toBeInstanceOf(StorageError);
    await expect(getDocument('d')).rejects.toMatchObject({ code: 'locked' });
    await unlockWithSecret('480315', { iterations: TEST_ITERATIONS });
    expect((await listDocuments()).docs.map((d) => d.id)).toEqual(['d']);
  });

  it('reports damaged records instead of failing the whole library', async () => {
    await unlocked();
    await saveDocument(docWith([], { id: 'good' }));
    await saveDocument(docWith([], { id: 'bad' }));
    const db = await getDb();
    const rec = await db.get('docs', 'bad');
    new Uint8Array(rec!.data)[3] ^= 0xff;
    await db.put('docs', rec!);
    const lib = await listDocuments();
    expect(lib.docs.map((d) => d.id)).toEqual(['good']);
    expect(lib.damaged).toEqual(['bad']);
    await expect(getDocument('bad')).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('reports missing images', async () => {
    await unlocked();
    await expect(getBlob('nope')).rejects.toMatchObject({ code: 'missing' });
  });

  it('deletes a page without deleting the document, and sweeps its unused images', async () => {
    await unlocked();
    const doc = docWith([imagePage('a'), imagePage('b')]);
    await saveDocument(
      doc,
      ['a-orig', 'a-proc', 'a-thumb', 'b-orig', 'b-proc', 'b-thumb'].map((id) => ({ id, docId: doc.id, blob: blob(id) })),
    );
    const next = removePage(doc, 'a', 2);
    await saveDocument(next);
    expect(await sweepDocument(next)).toBe(3);
    expect((await getDocument(doc.id))?.pages).toHaveLength(1);
    await expect(getBlob('a-orig')).rejects.toMatchObject({ code: 'missing' });
    expect(await (await getBlob('b-orig')).text()).toBe('b-orig');
  });

  it('deleting a document removes all of its images', async () => {
    await unlocked();
    const doc = docWith([imagePage('a')]);
    await saveDocument(doc, [{ id: 'a-orig', docId: doc.id, blob: blob('x') }]);
    await saveDocument(docWith([], { id: 'other' }), [{ id: 'keep', docId: 'other', blob: blob('k') }]);
    await deleteDocument(doc.id);
    expect(await getDocument(doc.id)).toBeNull();
    await expect(getBlob('a-orig')).rejects.toMatchObject({ code: 'missing' });
    await commit({});
    const lib = await listDocuments();
    expect(await sweepAll(lib.docs, lib.damaged)).toBe(1); // 'keep' is unreferenced by 'other'
  });

  it('encrypts settings too', async () => {
    await unlocked();
    await saveSecureMeta('settings', { lockTimeout: 0 });
    expect(await loadSecureMeta('settings', {})).toEqual({ lockTimeout: 0 });
    expect(await loadSecureMeta('missing', 'fallback')).toBe('fallback');
  });
});
