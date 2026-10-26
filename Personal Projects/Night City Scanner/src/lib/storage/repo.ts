import type { DocumentRecord } from '../../types/models';
import { open, openJson, seal, sealJson } from '../security/crypto';
import { requireKey } from '../security/session';
import { referencedBlobIds } from '../document/model';
import { getDb, type SealedBlob, type SealedRecord } from './db';
import { StorageError, toStorageError } from './errors';

/**
 * Encrypted persistence. Every document record and binary is sealed with the
 * session's data key before it reaches IndexedDB, and decrypted on read. With
 * the app locked there is no key, so nothing here can return content.
 */

const docAad = (id: string) => `doc:${id}`;
const blobAad = (id: string) => `blob:${id}`;
const metaAad = (key: string) => `meta:${key}`;

interface StoredBlob extends SealedBlob {
  type: string;
}

export interface BlobWrite {
  id: string;
  docId: string;
  blob: Blob;
}

export interface CommitOps {
  docs?: DocumentRecord[];
  blobs?: BlobWrite[];
  deleteBlobIds?: string[];
  deleteDocIds?: string[];
}

async function sealDoc(key: CryptoKey, doc: DocumentRecord): Promise<SealedRecord> {
  const sealed = await sealJson(key, doc, docAad(doc.id));
  return { id: doc.id, ...sealed };
}

async function sealBlob(key: CryptoKey, w: BlobWrite): Promise<StoredBlob> {
  const bytes = await w.blob.arrayBuffer();
  const sealed = await seal(key, bytes, blobAad(w.id));
  return { id: w.id, docId: w.docId, type: w.blob.type, size: bytes.byteLength, createdAt: Date.now(), ...sealed };
}

/**
 * Apply several changes atomically. Encryption happens first (it is async
 * and would otherwise auto-commit the IndexedDB transaction), then every
 * write lands in one transaction: either all of it is saved or none of it.
 */
export async function commit(ops: CommitOps): Promise<void> {
  const key = requireKey();
  const sealedDocs = await Promise.all((ops.docs ?? []).map((d) => sealDoc(key, d)));
  const sealedBlobs = await Promise.all((ops.blobs ?? []).map((b) => sealBlob(key, b)));
  const db = await getDb();
  try {
    const tx = db.transaction(['docs', 'blobs'], 'readwrite');
    const docs = tx.objectStore('docs');
    const blobs = tx.objectStore('blobs');
    const work: Promise<unknown>[] = [];
    for (const b of sealedBlobs) work.push(blobs.put(b));
    for (const d of sealedDocs) work.push(docs.put(d));
    for (const id of ops.deleteBlobIds ?? []) work.push(blobs.delete(id));
    for (const id of ops.deleteDocIds ?? []) {
      work.push(docs.delete(id));
      work.push(
        blobs
          .index('docId')
          .getAllKeys(id)
          .then((keys) => Promise.all(keys.map((k) => blobs.delete(k)))),
      );
    }
    await Promise.all([...work, tx.done]);
  } catch (err) {
    throw toStorageError(err, 'write');
  }
}

export const saveDocument = (doc: DocumentRecord, blobs: BlobWrite[] = []) => commit({ docs: [doc], blobs });
export const deleteDocument = (id: string) => commit({ deleteDocIds: [id] });

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  const key = requireKey();
  const db = await getDb();
  let rec: SealedRecord | undefined;
  try {
    rec = await db.get('docs', id);
  } catch (err) {
    throw toStorageError(err, 'read');
  }
  if (!rec) return null;
  try {
    return await openJson<DocumentRecord>(key, rec, docAad(id));
  } catch (err) {
    throw new StorageError('corrupt', undefined, { cause: err });
  }
}

export interface Library {
  docs: DocumentRecord[];
  /** Ids of records that exist but could not be decrypted/parsed. */
  damaged: string[];
}

export async function listDocuments(): Promise<Library> {
  const key = requireKey();
  const db = await getDb();
  let all: SealedRecord[];
  try {
    all = await db.getAll('docs');
  } catch (err) {
    throw toStorageError(err, 'read');
  }
  const docs: DocumentRecord[] = [];
  const damaged: string[] = [];
  await Promise.all(
    all.map(async (rec) => {
      try {
        const doc = await openJson<DocumentRecord>(key, rec, docAad(rec.id));
        if (!doc || !Array.isArray(doc.pages)) throw new Error('bad shape');
        docs.push(doc);
      } catch {
        damaged.push(rec.id);
      }
    }),
  );
  return { docs, damaged };
}

export async function getBlob(id: string): Promise<Blob> {
  const key = requireKey();
  const db = await getDb();
  let rec: StoredBlob | undefined;
  try {
    rec = (await db.get('blobs', id)) as StoredBlob | undefined;
  } catch (err) {
    throw toStorageError(err, 'read');
  }
  if (!rec) throw new StorageError('missing');
  try {
    const bytes = await open(key, rec, blobAad(id));
    return new Blob([bytes], { type: rec.type });
  } catch (err) {
    throw new StorageError('corrupt', undefined, { cause: err });
  }
}

export async function hasBlob(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.getKey('blobs', id)) !== undefined;
}

/** Delete stored blobs of `doc` that none of its pages reference any more. */
export async function sweepDocument(doc: DocumentRecord): Promise<number> {
  const db = await getDb();
  const keep = referencedBlobIds(doc);
  const ids = await db.getAllKeysFromIndex('blobs', 'docId', doc.id);
  const orphans = ids.filter((id) => !keep.has(id));
  if (orphans.length) await commit({ deleteBlobIds: orphans });
  return orphans.length;
}

/** Library-wide cleanup: blobs of deleted documents or unreferenced pages. */
export async function sweepAll(docs: DocumentRecord[], damaged: string[]): Promise<number> {
  const db = await getDb();
  const keep = new Set<string>();
  docs.forEach((d) => referencedBlobIds(d).forEach((id) => keep.add(id)));
  const knownDocs = new Set([...docs.map((d) => d.id), ...damaged]);
  const tx = db.transaction('blobs', 'readonly');
  const orphans: string[] = [];
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const { id, docId } = cursor.value;
    // Never touch blobs of damaged documents: they may still be recoverable.
    if (!damaged.includes(docId) && (!knownDocs.has(docId) || !keep.has(id))) orphans.push(id);
    cursor = await cursor.continue();
  }
  await tx.done;
  if (orphans.length) await commit({ deleteBlobIds: orphans });
  return orphans.length;
}

/** Remove records that cannot be decrypted, along with their blobs. */
export const deleteDamaged = (ids: string[]) => commit({ deleteDocIds: ids });

export async function loadSecureMeta<T>(key: string, fallback: T): Promise<T> {
  const k = requireKey();
  const db = await getDb();
  const rec = (await db.get('meta', `enc:${key}`)) as SealedRecord | undefined;
  if (!rec) return fallback;
  try {
    return await openJson<T>(k, rec, metaAad(key));
  } catch {
    return fallback;
  }
}

export async function saveSecureMeta(key: string, value: unknown): Promise<void> {
  const k = requireKey();
  const sealed = await sealJson(k, value, metaAad(key));
  const db = await getDb();
  try {
    await db.put('meta', { id: key, ...sealed }, `enc:${key}`);
  } catch (err) {
    throw toStorageError(err, 'write');
  }
}

export interface StorageStatus {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const sm = navigator.storage;
  let usage: number | null = null;
  let quota: number | null = null;
  let persisted: boolean | null = null;
  try {
    if (sm?.estimate) {
      const est = await sm.estimate();
      usage = est.usage ?? null;
      quota = est.quota ?? null;
    }
    if (sm?.persisted) persisted = await sm.persisted();
  } catch {
    /* estimates are best-effort */
  }
  return { usage, quota, persisted };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
