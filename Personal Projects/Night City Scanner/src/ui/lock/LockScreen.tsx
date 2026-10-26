import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Lock, TriangleAlert } from 'lucide-react';
import { readGuard, readVault, resetEverything, unlockWithPrf, unlockWithSecret } from '../../lib/security/vault';
import { formatWait, remainingLockMs } from '../../lib/security/bruteForce';
import { authenticatePasskey } from '../../lib/security/passkey';
import { afterUnlock, boot } from '../../state/actions';
import { useApp } from '../../state/store';
import { Button, Notice, Sheet } from '../kit';
import { PinPad } from './PinPad';
import { SecretInput } from './SecretInput';
import { BrandMark } from '../Brand';

export function LockScreen() {
  const kind = useApp((s) => s.vaultKind) ?? 'password';
  const hasPasskey = useApp((s) => s.hasPasskey);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitMs, setWaitMs] = useState(0);
  const [shake, setShake] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);

  // Restore an active throttle after a reload, and count it down.
  useEffect(() => {
    let alive = true;
    readGuard()
      .then((g) => alive && setWaitMs(remainingLockMs(g, Date.now())))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (waitMs <= 0) return;
    const until = Date.now() + waitMs;
    const t = setInterval(() => {
      const left = Math.max(0, until - Date.now());
      setWaitMs(left);
      if (!left) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
    // Only restart the countdown when a new wait begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitMs > 0]);

  const submit = useCallback(async () => {
    if (busy || waitMs > 0 || !secret) return;
    setBusy(true);
    setError(null);
    try {
      const res = await unlockWithSecret(secret);
      setSecret('');
      if (res.ok) {
        await afterUnlock();
        return;
      }
      if (res.reason === 'no-vault') {
        await boot();
        return;
      }
      if (res.reason === 'throttled') {
        setWaitMs(res.retryInMs);
      } else {
        setError(kind === 'pin' ? 'Incorrect passcode.' : 'Incorrect password.');
        setShake((n) => n + 1);
        if (res.retryInMs) setWaitMs(res.retryInMs);
      }
    } catch {
      setError('Could not read secure storage. Close other tabs of this app and try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, waitMs, secret, kind]);

  const passkeyUnlock = async () => {
    setError(null);
    setBusy(true);
    try {
      const meta = await readVault();
      if (!meta?.passkey) return;
      const prf = await authenticatePasskey(meta.passkey.credentialId, meta.passkey.prfSalt);
      if (await unlockWithPrf(prf)) await afterUnlock();
      else setError('That passkey could not unlock the app. Use your passcode.');
    } catch (err) {
      setError(err instanceof Error && err.name === 'AppError' ? err.message : 'Passkey unlock failed. Use your passcode.');
    } finally {
      setBusy(false);
    }
  };

  const throttled = waitMs > 0;

  return (
    <main className="lock">
      <div className="lock__inner">
        <BrandMark compact />
        <div className="lock__icon">
          <Lock size={26} />
        </div>
        <h1 className="lock__title">Locked</h1>
        <p className="lock__lead">{kind === 'pin' ? 'Enter your passcode' : 'Enter your password'} to open your documents.</p>
        <div className="lock__status" aria-live="assertive">
          {throttled ? (
            <p className="lock__error">Too many attempts. Try again in {formatWait(waitMs)}.</p>
          ) : error ? (
            <p className="lock__error" key={shake}>
              {error}
            </p>
          ) : busy ? (
            <p className="faint">Verifying…</p>
          ) : null}
        </div>
        {kind === 'pin' ? (
          <div className={shake ? 'shake' : ''} key={shake}>
            <PinPad value={secret} onChange={(v) => (setError(null), setSecret(v))} onSubmit={submit} disabled={busy || throttled} submitLabel="Unlock" />
          </div>
        ) : (
          <div className={`stack ${shake ? 'shake' : ''}`} key={shake} style={{ width: '100%' }}>
            <SecretInput label="Password" value={secret} onChange={(v) => (setError(null), setSecret(v))} onSubmit={submit} autoFocus autoComplete="current-password" disabled={busy || throttled} />
            <Button variant="primary" size="lg" block onClick={submit} busy={busy} disabled={throttled || !secret}>
              Unlock
            </Button>
          </div>
        )}
        {hasPasskey && (
          <Button variant="secondary" block onClick={passkeyUnlock} disabled={busy} icon={<Fingerprint size={20} />}>
            Unlock with Face ID / passkey
          </Button>
        )}
        <Button variant="ghost" onClick={() => setResetOpen(true)}>
          Forgot {kind === 'pin' ? 'passcode' : 'password'}?
        </Button>
      </div>
      {resetOpen && <ResetSheet onClose={() => setResetOpen(false)} />}
    </main>
  );
}

function ResetSheet({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const erase = async () => {
    setBusy(true);
    try {
      await resetEverything();
      await boot();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Forgotten passcode" onClose={onClose}>
      <div className="stack">
        <p className="muted">
          Your documents are encrypted with a key that only your passcode can unlock. There is no recovery service and no back door, so a
          forgotten passcode cannot be reset without losing the documents stored in this app.
        </p>
        <Notice tone="info" icon={<TriangleAlert size={18} />}>
          PDFs and images you already <strong>exported to the Files app</strong> are separate files and are not affected.
        </Notice>
        <Notice tone="danger" icon={<TriangleAlert size={18} />}>
          Erasing permanently deletes every document, unfinished scan and setting stored in Night City Scanner on this device. This cannot be undone.
        </Notice>
        <label className="field">
          <span className="label">Type ERASE to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} />
        </label>
        {failed && <p className="lock__error">Could not erase the data. Close other tabs of this app and try again.</p>}
        <Button variant="danger" block size="lg" disabled={typed.trim().toUpperCase() !== 'ERASE'} busy={busy} onClick={erase}>
          Erase everything and start over
        </Button>
        <Button variant="ghost" block onClick={onClose}>
          Keep trying
        </Button>
      </div>
    </Sheet>
  );
}
