/**
 * Cryptographic primitives, all provided by the browser's Web Crypto API
 * (no custom crypto):
 *
 *  - PBKDF2-HMAC-SHA-256 turns the passcode + a random 16-byte salt into a
 *    key-encryption key (KEK). 600,000 iterations follows the OWASP 2023
 *    recommendation for PBKDF2-SHA256.
 *  - A random AES-256-GCM data-encryption key (DEK) encrypts every stored
 *    document record and image. The DEK is stored only wrapped (encrypted)
 *    by the KEK, so changing the passcode re-wraps one key instead of
 *    re-encrypting the whole library.
 *  - AES-GCM is authenticated: a wrong passcode makes unwrapping fail, which
 *    is how the passcode is verified. No password hash is stored.
 */

export const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const subtle = () => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure cryptography is unavailable. Open the app over HTTPS.');
  }
  return globalThis.crypto.subtle;
};

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

export const newSalt = () => randomBytes(SALT_BYTES);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Unicode-normalize so the same passcode typed on different keyboards matches. */
export function normalizeSecret(secret: string): string {
  return secret.normalize('NFC');
}

export async function deriveKek(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', encoder.encode(normalizeSecret(secret)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** Derive a wrapping key from high-entropy input (e.g. a WebAuthn PRF output) with HKDF. */
export async function deriveKekFromBytes(
  secret: ArrayBuffer | Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('night-city-scanner/passkey-kek/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export async function generateDek(): Promise<CryptoKey> {
  // Extractable only so it can be wrapped once; sessions use a non-extractable copy.
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const data = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv, data };
}

/** Throws (OperationError) when the KEK is wrong, i.e. the passcode is incorrect. */
export async function unwrapDek(sealed: Sealed, kek: CryptoKey, extractable = false): Promise<CryptoKey> {
  return subtle().unwrapKey(
    'raw',
    sealed.data,
    kek,
    { name: 'AES-GCM', iv: sealed.iv },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt bytes. `aad` (additional authenticated data) binds the ciphertext
 * to its record id, so records cannot be swapped between keys undetected.
 */
export async function seal(key: CryptoKey, data: BufferSource, aad: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const out = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, data);
  return { iv, data: out };
}

export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<ArrayBuffer> {
  return subtle().decrypt(
    { name: 'AES-GCM', iv: sealed.iv, additionalData: encoder.encode(aad) },
    key,
    sealed.data,
  );
}

export async function sealJson(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  return seal(key, encoder.encode(JSON.stringify(value)), aad);
}

export async function openJson<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  return JSON.parse(decoder.decode(await open(key, sealed, aad))) as T;
}
