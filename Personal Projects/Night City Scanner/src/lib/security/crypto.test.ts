import { describe, expect, it } from 'vitest';
import { deriveKek, generateDek, newSalt, open, openJson, seal, sealJson, unwrapDek, wrapDek } from './crypto';
import { TEST_ITERATIONS } from '../../test/fixtures';

describe('crypto', () => {
  it('round-trips data with AES-GCM and binds it to its record id', async () => {
    const key = await generateDek();
    const sealed = await seal(key, new TextEncoder().encode('hello'), 'doc:a');
    expect(new TextDecoder().decode(await open(key, sealed, 'doc:a'))).toBe('hello');
    await expect(open(key, sealed, 'doc:b')).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const key = await generateDek();
    const sealed = await sealJson(key, { a: 1 }, 'x');
    const bytes = new Uint8Array(sealed.data);
    bytes[0] ^= 1;
    await expect(openJson(key, { iv: sealed.iv, data: bytes.buffer }, 'x')).rejects.toThrow();
  });

  it('uses a fresh IV for every encryption', async () => {
    const key = await generateDek();
    const a = await seal(key, new Uint8Array([1]), 'x');
    const b = await seal(key, new Uint8Array([1]), 'x');
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
  });

  it('only unwraps the data key with the right passcode', async () => {
    const salt = newSalt();
    const dek = await generateDek();
    const wrapped = await wrapDek(dek, await deriveKek('correct horse', salt, TEST_ITERATIONS));
    const ok = await unwrapDek(wrapped, await deriveKek('correct horse', salt, TEST_ITERATIONS));
    expect(ok.type).toBe('secret');
    expect(ok.extractable).toBe(false);
    await expect(unwrapDek(wrapped, await deriveKek('wrong horse', salt, TEST_ITERATIONS))).rejects.toThrow();
  });

  it('normalizes unicode so composed and decomposed input match', async () => {
    const salt = newSalt();
    const dek = await generateDek();
    const wrapped = await wrapDek(dek, await deriveKek('café-pass', salt, TEST_ITERATIONS));
    await expect(unwrapDek(wrapped, await deriveKek('café-pass', salt, TEST_ITERATIONS))).resolves.toBeTruthy();
  });
});
