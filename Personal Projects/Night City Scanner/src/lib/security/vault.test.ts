import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  changeSecret,
  createVault,
  lock,
  readGuard,
  readVault,
  resetEverything,
  unlockWithSecret,
  validateSecret,
} from './vault';
import { hasSessionKey } from './session';
import { closeDb, getDb } from '../storage/db';
import { getDocument, saveDocument } from '../storage/repo';
import { docWith, TEST_ITERATIONS } from '../../test/fixtures';

const opts = { iterations: TEST_ITERATIONS };

afterEach(() => vi.useRealTimers());

describe('passcode validation', () => {
  it('accepts reasonable PINs and passwords', () => {
    expect(validateSecret('pin', '480315')).toBeNull();
    expect(validateSecret('password', 'neon rain falls')).toBeNull();
  });
  it('rejects weak or malformed ones', () => {
    expect(validateSecret('pin', '12345')).toMatch(/at least 6/);
    expect(validateSecret('pin', '111111')).toMatch(/repeating/);
    expect(validateSecret('pin', '123456')).toMatch(/sequences/);
    expect(validateSecret('pin', '12a456')).toMatch(/digits/);
    expect(validateSecret('password', 'short')).toMatch(/at least 8/);
    expect(validateSecret('password', '         ')).toMatch(/spaces/);
  });
});

describe('vault', () => {
  it('first-time setup stores no plaintext and unlocks the session', async () => {
    await createVault('password', 'night city 2077', opts);
    expect(hasSessionKey()).toBe(true);
    const meta = await readVault();
    expect(meta?.kind).toBe('password');
    // Nothing stored contains the passcode.
    const db = await getDb();
    const everything = JSON.stringify(await db.getAll('meta'), (_k, v) =>
      v instanceof Uint8Array || v instanceof ArrayBuffer ? Array.from(new Uint8Array(v as ArrayBuffer)) : v,
    );
    expect(everything).not.toContain('night city 2077');
    const bytes = new TextEncoder().encode('night city 2077');
    expect(everything).not.toContain(Array.from(bytes).join(','));
  });

  it('refuses to create a second vault', async () => {
    await createVault('pin', '480315', opts);
    await expect(createVault('pin', '480316', opts)).rejects.toThrow(/already/);
  });

  it('rejects a wrong passcode and accepts the right one after a reload', async () => {
    await createVault('pin', '480315', opts);
    lock();
    await closeDb(); // simulate a page reload
    expect(hasSessionKey()).toBe(false);
    const bad = await unlockWithSecret('000000', opts);
    expect(bad).toMatchObject({ ok: false, reason: 'wrong', failures: 1 });
    expect(hasSessionKey()).toBe(false);
    expect(await unlockWithSecret('480315', opts)).toEqual({ ok: true });
    expect(hasSessionKey()).toBe(true);
    expect((await readGuard()).failures).toBe(0);
  });

  it('throttles progressively after repeated failures, then recovers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await createVault('pin', '480315', opts);
    lock();
    for (let i = 1; i <= 4; i++) {
      expect(await unlockWithSecret('999999', opts)).toMatchObject({ reason: 'wrong', retryInMs: 0 });
    }
    expect(await unlockWithSecret('999999', opts)).toMatchObject({ reason: 'wrong', failures: 5, retryInMs: 30_000 });
    // Even the right passcode is not checked while throttled.
    expect(await unlockWithSecret('480315', opts)).toMatchObject({ reason: 'throttled' });
    // The throttle survives a reload.
    await closeDb();
    expect(await unlockWithSecret('480315', opts)).toMatchObject({ reason: 'throttled' });
    vi.setSystemTime(1_000_000 + 31_000);
    expect(await unlockWithSecret('480315', opts)).toEqual({ ok: true });
  });

  it('changes the passcode without losing documents', async () => {
    await createVault('pin', '480315', opts);
    await saveDocument(docWith([], { id: 'd1', title: 'Lease' }));
    expect(await changeSecret('000000', 'password', 'a longer passphrase', opts)).toBe('wrong-current');
    expect(await changeSecret('480315', 'password', 'a longer passphrase', opts)).toBe('ok');
    lock();
    expect(await unlockWithSecret('480315', opts)).toMatchObject({ ok: false });
    expect(await unlockWithSecret('a longer passphrase', opts)).toEqual({ ok: true });
    expect((await readVault())?.kind).toBe('password');
    expect((await getDocument('d1'))?.title).toBe('Lease');
  });

  it('upgrades an old, cheaper KDF on unlock', async () => {
    await createVault('pin', '480315', { iterations: 500 });
    lock();
    expect(await unlockWithSecret('480315', { iterations: 1500 })).toEqual({ ok: true });
    expect((await readVault())?.iterations).toBe(1500);
    lock();
    expect(await unlockWithSecret('480315', { iterations: 1500 })).toEqual({ ok: true });
  });

  it('reset erases the passcode and every document', async () => {
    await createVault('pin', '480315', opts);
    await saveDocument(docWith([], { id: 'd1' }));
    await resetEverything();
    expect(hasSessionKey()).toBe(false);
    expect(await readVault()).toBeNull();
    await createVault('pin', '271828', opts);
    expect(await getDocument('d1')).toBeNull();
  });
});
