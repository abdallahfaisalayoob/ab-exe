import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { closeDb } from '../lib/storage/db';
import { clearSessionKey } from '../lib/security/session';

// Every test starts with an empty database and a locked app.
beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  clearSessionKey();
});
