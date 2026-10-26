import { getDb, destroyDb } from '../storage/db';
import { StorageError, toStorageError } from '../storage/errors';
import {
  KDF_ITERATIONS,
  deriveKek,
  deriveKekFromBytes,
  generateDek,
  newSalt,
  unwrapDek,
  wrapDek,
  type Sealed,
} from './crypto';
import { EMPTY_GUARD, guardBeforeAttempt, remainingLockMs, type GuardState } from './bruteForce';
import { clearSessionKey, setSessionKey } from './session';

export type SecretKind = 'pin' | 'password';

export interface PasskeyWrap {
  credentialId: Uint8Array<ArrayBuffer>;
  /** Input to the authenticator's PRF; the output never leaves memory. */
  prfSalt: Uint8Array<ArrayBuffer>;
  hkdfSalt: Uint8Array<ArrayBuffer>;
  wrapped: Sealed;
  createdAt: number;
}

/** Everything stored about the passcode: a salt, a cost, and the wrapped key. */
export interface VaultMeta {
  v: 1;
  kind: SecretKind;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
  wrapped: Sealed;
  createdAt: number;
  changedAt: number;
  passkey?: PasskeyWrap;
}

const VAULT_KEY = 'vault';
const GUARD_KEY = 'guard';

export const PIN_MIN = 6;
export const PASSWORD_MIN = 8;

/** Returns a user-facing problem with the chosen passcode, or null if acceptable. */
export function validateSecret(kind: SecretKind, secret: string): string | null {
  if (kind === 'pin') {
    if (!/^\d+$/.test(secret)) return 'A passcode can only contain digits.';
    if (secret.length < PIN_MIN) return `Use at least ${PIN_MIN} digits.`;
    if (secret.length > 16) return 'Use 16 digits or fewer.';
    if (/^(\d)\1+$/.test(secret)) return 'Avoid repeating a single digit.';
    if ('01234567890123456789'.includes(secret) || '98765432109876543210'.includes(secret)) {
      return 'Avoid simple sequences like 123456.';
    }
    return null;
  }
  if (secret.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (secret.length > 256) return 'Use 256 characters or fewer.';
  if (!secret.trim()) return 'The password cannot be only spaces.';
  return null;
}

export async function readVault(): Promise<VaultMeta | null> {
  try {
    const db = await getDb();
    return ((await db.get('meta', VAULT_KEY)) as VaultMeta | undefined) ?? null;
  } catch (err) {
    throw toStorageError(err, 'read');
  }
}

async function writeVault(meta: VaultMeta): Promise<void> {
  try {
    const db = await getDb();
    await db.put('meta', meta, VAULT_KEY);
  } catch (err) {
    throw toStorageError(err, 'write');
  }
}

export async function readGuard(): Promise<GuardState> {
  const db = await getDb();
  return ((await db.get('meta', GUARD_KEY)) as GuardState | undefined) ?? EMPTY_GUARD;
}

async function writeGuard(state: GuardState): Promise<void> {
  const db = await getDb();
  await db.put('meta', state, GUARD_KEY);
}

export interface CreateOptions {
  /** Tests use a low count; production always uses KDF_ITERATIONS. */
  iterations?: number;
}

/** First-run: create a fresh data key protected by the new passcode, and unlock. */
export async function createVault(kind: SecretKind, secret: string, opts: CreateOptions = {}): Promise<void> {
  const problem = validateSecret(kind, secret);
  if (problem) throw new Error(problem);
  if (await readVault()) throw new Error('A passcode already exists.');
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = newSalt();
  const kek = await deriveKek(secret, salt, iterations);
  const dek = await generateDek();
  const wrapped = await wrapDek(dek, kek);
  const now = Date.now();
  await writeVault({ v: 1, kind, salt, iterations, wrapped, createdAt: now, changedAt: now });
  await writeGuard(EMPTY_GUARD);
  // Session uses a non-extractable copy of the key.
  setSessionKey(await unwrapDek(wrapped, kek, false));
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; failures: number; retryInMs: number }
  | { ok: false; reason: 'throttled'; retryInMs: number }
  | { ok: false; reason: 'no-vault' };

/** Verify a passcode. On success the session key is installed. */
export async function unlockWithSecret(secret: string, opts: CreateOptions = {}): Promise<UnlockResult> {
  const meta = await readVault();
  if (!meta) return { ok: false, reason: 'no-vault' };
  const guard = await readGuard();
  const wait = remainingLockMs(guard, Date.now());
  if (wait > 0) return { ok: false, reason: 'throttled', retryInMs: wait };

  // Count the attempt as failed up-front, so reloading mid-check cannot reset the counter.
  const pending = guardBeforeAttempt(guard, Date.now());
  await writeGuard(pending);

  let kek: CryptoKey;
  try {
    kek = await deriveKek(secret, meta.salt, meta.iterations);
  } catch (err) {
    throw toStorageError(err, 'read');
  }
  try {
    const targetIterations = opts.iterations ?? KDF_ITERATIONS;
    if (meta.iterations < targetIterations) {
      // Transparently upgrade the KDF cost of older vaults.
      const dek = await unwrapDek(meta.wrapped, kek, true);
      const salt = newSalt();
      const newKek = await deriveKek(secret, salt, targetIterations);
      const wrapped = await wrapDek(dek, newKek);
      await writeVault({ ...meta, salt, iterations: targetIterations, wrapped });
      setSessionKey(await unwrapDek(wrapped, newKek, false));
    } else {
      setSessionKey(await unwrapDek(meta.wrapped, kek, false));
    }
  } catch (err) {
    if (err instanceof StorageError) throw err;
    return {
      ok: false,
      reason: 'wrong',
      failures: pending.failures,
      retryInMs: remainingLockMs(pending, Date.now()),
    };
  }
  await writeGuard(EMPTY_GUARD);
  return { ok: true };
}

/** Unwrap an extractable copy of the data key using the passcode (for re-wrapping). */
async function exportableDekWithSecret(meta: VaultMeta, secret: string): Promise<CryptoKey | null> {
  try {
    const kek = await deriveKek(secret, meta.salt, meta.iterations);
    return await unwrapDek(meta.wrapped, kek, true);
  } catch {
    return null;
  }
}

/**
 * Change the passcode. Documents stay encrypted with the same data key; only
 * the key's wrapping changes. A passkey unlock, if enabled, keeps working.
 */
export async function changeSecret(
  current: string,
  kind: SecretKind,
  next: string,
  opts: CreateOptions = {},
): Promise<'ok' | 'wrong-current' | 'throttled'> {
  const problem = validateSecret(kind, next);
  if (problem) throw new Error(problem);
  const meta = await readVault();
  if (!meta) throw new StorageError('read', 'no passcode set');
  const guard = await readGuard();
  if (remainingLockMs(guard, Date.now()) > 0) return 'throttled';
  await writeGuard(guardBeforeAttempt(guard, Date.now()));
  const dek = await exportableDekWithSecret(meta, current);
  if (!dek) return 'wrong-current';
  await writeGuard(EMPTY_GUARD);
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = newSalt();
  const kek = await deriveKek(next, salt, iterations);
  const wrapped = await wrapDek(dek, kek);
  await writeVault({ ...meta, kind, salt, iterations, wrapped, changedAt: Date.now() });
  return 'ok';
}

/** Verify the passcode and return an extractable key, for enrolling a passkey. */
export async function verifyForEnrollment(secret: string): Promise<CryptoKey | null> {
  const meta = await readVault();
  if (!meta) return null;
  const guard = await readGuard();
  if (remainingLockMs(guard, Date.now()) > 0) return null;
  await writeGuard(guardBeforeAttempt(guard, Date.now()));
  const dek = await exportableDekWithSecret(meta, secret);
  if (dek) await writeGuard(EMPTY_GUARD);
  return dek;
}

export async function savePasskeyWrap(
  dek: CryptoKey,
  credentialId: Uint8Array<ArrayBuffer>,
  prfSalt: Uint8Array<ArrayBuffer>,
  prfOutput: ArrayBuffer,
): Promise<void> {
  const meta = await readVault();
  if (!meta) throw new StorageError('read', 'no passcode set');
  const hkdfSalt = newSalt();
  const kek = await deriveKekFromBytes(prfOutput, hkdfSalt);
  const wrapped = await wrapDek(dek, kek);
  await writeVault({ ...meta, passkey: { credentialId, prfSalt, hkdfSalt, wrapped, createdAt: Date.now() } });
}

export async function removePasskeyWrap(): Promise<void> {
  const meta = await readVault();
  if (!meta) return;
  const { passkey: _removed, ...rest } = meta;
  await writeVault(rest);
}

export async function unlockWithPrf(prfOutput: ArrayBuffer): Promise<boolean> {
  const meta = await readVault();
  if (!meta?.passkey) return false;
  try {
    const kek = await deriveKekFromBytes(prfOutput, meta.passkey.hkdfSalt);
    setSessionKey(await unwrapDek(meta.passkey.wrapped, kek, false));
    await writeGuard(EMPTY_GUARD);
    return true;
  } catch {
    return false;
  }
}

export function lock(): void {
  clearSessionKey();
}

/**
 * Erase everything: passcode, documents, settings. Documents are encrypted with
 * a key only the passcode can unlock, so without the passcode they are
 * unrecoverable anyway; this just reclaims the space and starts over.
 */
export async function resetEverything(): Promise<void> {
  clearSessionKey();
  await destroyDb();
}
