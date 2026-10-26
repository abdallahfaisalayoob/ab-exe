import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Sealed } from '../security/crypto';
import { StorageError } from './errors';

export const DB_NAME = 'night-city-scanner';
const DB_VERSION = 1;

/** Encrypted document metadata. Only the random id is stored in the clear. */
export interface SealedRecord extends Sealed {
  id: string;
}

/** Encrypted binary (image, PDF). docId links it to its document for cleanup. */
export interface SealedBlob extends Sealed {
  id: string;
  docId: string;
  size: number;
  createdAt: number;
}

export interface NcsSchema extends DBSchema {
  /** Vault key material, brute-force guard state, encrypted settings. */
  meta: { key: string; value: unknown };
  docs: { key: string; value: SealedRecord };
  blobs: { key: string; value: SealedBlob; indexes: { docId: string } };
}

let dbPromise: Promise<IDBPDatabase<NcsSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<NcsSchema>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageError('unavailable'));
    }
    dbPromise = openDB<NcsSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('meta');
        db.createObjectStore('docs', { keyPath: 'id' });
        const blobs = db.createObjectStore('blobs', { keyPath: 'id' });
        blobs.createIndex('docId', 'docId');
      },
      blocking() {
        // Another tab wants to upgrade/delete: release our connection.
        void closeDb();
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((err) => {
      dbPromise = null;
      throw new StorageError('unavailable', undefined, { cause: err });
    });
  }
  return dbPromise;
}

export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) {
    try {
      (await p).close();
    } catch {
      /* already closed */
    }
  }
}

/** Delete the entire database. Used by "Reset app". */
export async function destroyDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // If another tab holds it open, deletion completes once it closes.
    req.onblocked = () => resolve();
  });
}
