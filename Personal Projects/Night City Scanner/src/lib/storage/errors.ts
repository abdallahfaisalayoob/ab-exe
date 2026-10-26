export type StorageErrorCode =
  | 'quota'
  | 'write'
  | 'read'
  | 'corrupt'
  | 'missing'
  | 'unavailable'
  | 'locked';

const MESSAGES: Record<StorageErrorCode, string> = {
  quota: 'Device storage for this app is full. Export and delete some documents, then try again.',
  write: 'Could not save to on-device storage. Your last change was not saved.',
  read: 'Could not read from on-device storage.',
  corrupt: 'A stored record is damaged and could not be decrypted.',
  missing: 'A stored image is missing.',
  unavailable: 'On-device storage is unavailable in this browser mode (Private Browsing blocks it).',
  locked: 'The app is locked.',
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code], options);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; inner?: unknown; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.code === 22 ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(e.message ?? '')
  );
}

/** Normalize anything thrown by IndexedDB into a StorageError. */
export function toStorageError(err: unknown, fallback: StorageErrorCode): StorageError {
  if (err instanceof StorageError) return err;
  if (isQuotaError(err)) return new StorageError('quota', undefined, { cause: err });
  return new StorageError(fallback, undefined, { cause: err });
}

/** Human-readable message for any error, without leaking internals. */
export function describeError(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof StorageError) return err.message;
  if (err instanceof Error && err.name === 'AppError') return err.message;
  return fallback;
}

/** An error whose message is written for the user. */
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
  }
}
