import { useEffect, useState } from 'react';
import { Archive, Fingerprint, HardDrive, Info, KeyRound, Lock, ShieldCheck, Trash2, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import type { FilterPreset, LockTimeout } from '../../types/models';
import { useApp } from '../../state/store';
import {
  boot,
  confirmAction,
  deleteDamagedRecords,
  goBack,
  holdAwake,
  lockApp,
  recordExport,
  refreshVaultInfo,
  reportError,
  suspendAutoLock,
  toast,
  updateSettings,
} from '../../state/actions';
import { changeSecret, removePasskeyWrap, resetEverything, savePasskeyWrap, validateSecret, verifyForEnrollment, type SecretKind } from '../../lib/security/vault';
import { enrollPasskey, platformAuthenticatorAvailable, passkeysSupported } from '../../lib/security/passkey';
import { requestPersistence } from '../../lib/storage/repo';
import { getBlob } from '../../lib/storage/repo';
import { buildPdf, canvasReencode } from '../../lib/pdf/generate';
import { pdfFilename, uniqueName } from '../../lib/document/filename';
import { canShareFiles, downloadFile, formatBytes, shareFiles, zipFiles } from '../../lib/export/share';
import { describeError } from '../../lib/storage/errors';
import { Button, Notice, Segmented, Sheet, SwitchRow, TopBar } from '../kit';
import { SecretInput } from '../lock/SecretInput';
import { BusyOverlay } from '../BusyOverlay';
import { useOnline, useStorageStatus } from '../hooks';

const TIMEOUTS: Array<{ value: string; label: string }> = [
  { value: '0', label: 'Now' },
  { value: '30000', label: '30 s' },
  { value: '60000', label: '1 min' },
  { value: '300000', label: '5 min' },
  { value: '900000', label: '15 min' },
];

const FILTERS: Array<{ value: FilterPreset; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'text', label: 'Document Text' },
  { value: 'enhanced', label: 'Enhanced Color' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'bw', label: 'Black & White' },
  { value: 'original', label: 'Original Color' },
];

export default function SettingsScreen() {
  const settings = useApp((s) => s.settings);
  const kind = useApp((s) => s.vaultKind);
  const hasPasskey = useApp((s) => s.hasPasskey);
  const docs = useApp((s) => s.docs);
  const damaged = useApp((s) => s.damaged);
  const [sheet, setSheet] = useState<null | 'passcode' | 'passkey' | 'security' | 'erase'>(null);
  const [persistTick, setPersistTick] = useState(0);
  const storage = useStorageStatus([persistTick, Object.keys(docs).length]);
  const online = useOnline();
  const [platformAuth, setPlatformAuth] = useState(false);
  const [backup, setBackup] = useState<{ progress: number; label: string } | null>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);

  useEffect(() => {
    void platformAuthenticatorAvailable().then(setPlatformAuth);
  }, []);

  const saved = Object.values(docs).filter((d) => d.status === 'saved' || d.pages.length);

  const prepareBackup = async () => {
    const release = holdAwake();
    setBackupFile(null);
    try {
      const files: File[] = [];
      const taken = new Set<string>();
      for (let i = 0; i < saved.length; i++) {
        const d = saved[i];
        setBackup({ progress: i / saved.length, label: d.title });
        if (d.pages.some((p) => p.kind === 'image' && p.state !== 'ready')) continue;
        const bytes = await buildPdf(d, { ...settings.pdf, searchable: true }, { getBlob, reencode: canvasReencode });
        const name = uniqueName(pdfFilename(d.title), taken);
        taken.add(name);
        files.push(new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' }));
      }
      if (!files.length) {
        toast('info', 'There is nothing to export yet.');
        return;
      }
      const zip = await zipFiles(files);
      const stamp = new Date().toISOString().slice(0, 10);
      setBackupFile(new File([zip], `Night City Scanner backup ${stamp}.zip`, { type: 'application/zip' }));
      if (files.length < saved.length) toast('info', `${saved.length - files.length} document(s) with unfinished pages were skipped.`);
    } catch (err) {
      reportError(err, 'The backup could not be created.');
    } finally {
      release();
      setBackup(null);
    }
  };

  const deliverBackup = (via: 'share' | 'download') => {
    if (!backupFile) return;
    const mark = (method: 'shared' | 'downloaded') => saved.forEach((d) => void recordExport(d.id, { at: Date.now(), kind: 'zip', method, filename: backupFile.name }));
    if (via === 'share') {
      const release = suspendAutoLock();
      shareFiles([backupFile], backupFile.name)
        .then((o) => o === 'shared' && (mark('shared'), toast('success', 'Backup shared.')))
        .catch((err) => reportError(err, 'Sharing failed. Try Download.'))
        .finally(release);
    } else {
      downloadFile(backupFile, backupFile.name);
      mark('downloaded');
      toast('info', 'Download started. On iPhone it goes to Files › Downloads.');
    }
  };

  const usagePct = storage?.usage && storage.quota ? Math.min(1, storage.usage / storage.quota) : null;

  return (
    <main className="screen settings">
      <TopBar title="Settings" onBack={goBack} />
      <div className="content stack settings__content">
        <section className="stack">
          <h2 className="section-h">Security</h2>
          <div className="list panel">
            <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div>
                <div className="list-row__title">Auto-lock</div>
                <div className="list-row__hint">After leaving the app (or being idle at least a minute), the passcode is required again.</div>
              </div>
              <Segmented label="Auto-lock timeout" value={String(settings.lockTimeout)} onChange={(v) => void updateSettings({ lockTimeout: Number(v) as LockTimeout })} options={TIMEOUTS} />
            </div>
            <button type="button" className="list-row" onClick={() => setSheet('passcode')}>
              <KeyRound size={20} />
              <span className="list-row__text">
                <span className="list-row__title">Change {kind === 'pin' ? 'passcode' : 'password'}</span>
                <span className="list-row__hint">Documents stay encrypted; only the key wrapping changes.</span>
              </span>
            </button>
            {passkeysSupported() && platformAuth && (
              <button type="button" className="list-row" onClick={() => setSheet('passkey')}>
                <Fingerprint size={20} />
                <span className="list-row__text">
                  <span className="list-row__title">Face ID / passkey unlock</span>
                  <span className="list-row__hint">{hasPasskey ? 'On' : 'Off'} · optional, where your device supports it</span>
                </span>
              </button>
            )}
            <button type="button" className="list-row" onClick={() => setSheet('security')}>
              <ShieldCheck size={20} />
              <span className="list-row__text">
                <span className="list-row__title">What the lock protects</span>
                <span className="list-row__hint">Encryption details and honest limits</span>
              </span>
            </button>
            <button type="button" className="list-row" onClick={lockApp}>
              <Lock size={20} />
              <span className="list-row__text list-row__title">Lock now</span>
            </button>
          </div>
        </section>

        <section className="stack">
          <h2 className="section-h">Scanning</h2>
          <div className="list panel">
            <SwitchRow title="Auto-capture" hint="Captures when a document is detected and held steady." checked={settings.autoCapture} onChange={(v) => void updateSettings({ autoCapture: v })} />
            <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="list-row__title">Auto-capture timing</div>
              <Segmented
                label="Auto-capture timing"
                value={settings.sensitivity}
                onChange={(v) => void updateSettings({ sensitivity: v })}
                options={[
                  { value: 'relaxed', label: 'Steadier' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'quick', label: 'Quicker' },
                ]}
              />
            </div>
            <label className="list-row">
              <span className="list-row__text">
                <span className="list-row__title">Default filter</span>
                <span className="list-row__hint">Applied to new pages; change any page later.</span>
              </span>
              <select className="input select" value={settings.defaultFilter} onChange={(e) => void updateSettings({ defaultFilter: e.target.value as FilterPreset })}>
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <SwitchRow title="Detect edges on imported photos" hint="Turn off for screenshots or already-cropped scans." checked={settings.detectOnImport} onChange={(v) => void updateSettings({ detectOnImport: v })} />
          </div>
        </section>

        <section className="stack">
          <h2 className="section-h">PDF defaults</h2>
          <div className="list panel">
            <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="list-row__title">Page size</div>
              <Segmented label="Default page size" value={settings.pdf.pageSize} onChange={(v) => void updateSettings({ pdf: { ...settings.pdf, pageSize: v } })} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit to scan' }]} />
            </div>
            <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="list-row__title">Quality</div>
              <Segmented label="Default quality" value={settings.pdf.quality} onChange={(v) => void updateSettings({ pdf: { ...settings.pdf, quality: v } })} options={[{ value: 'max', label: 'Maximum' }, { value: 'balanced', label: 'Balanced' }, { value: 'small', label: 'Smaller' }]} />
            </div>
          </div>
        </section>

        <section className="stack">
          <h2 className="section-h">Storage & backup</h2>
          <div className="panel storage-card">
            <div className="row">
              <HardDrive size={20} aria-hidden />
              <div className="grow">
                <div className="list-row__title">{storage?.usage != null ? `${formatBytes(storage.usage)} used` : 'Usage unknown'}</div>
                <div className="list-row__hint">{storage?.quota ? `About ${formatBytes(storage.quota)} available to this app (browser estimate)` : 'This browser does not report a quota.'}</div>
              </div>
            </div>
            {usagePct !== null && <div className="meter" aria-hidden><div style={{ width: `${Math.max(2, usagePct * 100)}%` }} /></div>}
            <div className="list-row__hint">
              Persistent storage:{' '}
              {storage?.persisted ? (
                <strong className="ok-text">granted</strong>
              ) : storage?.persisted === false ? (
                <>
                  <strong>not granted</strong> — iOS may clear app data under storage pressure or after weeks unused in a Safari tab. Adding the app to the Home Screen helps.
                </>
              ) : (
                'unknown'
              )}
            </div>
            {storage?.persisted === false && (
              <Button
                size="sm"
                onClick={async () => {
                  const ok = await requestPersistence();
                  toast(ok ? 'success' : 'info', ok ? 'Persistent storage granted.' : 'The browser declined. Exporting backups remains the reliable safeguard.');
                  setPersistTick((n) => n + 1);
                }}
              >
                Request persistent storage
              </Button>
            )}
          </div>
          <Notice icon={<Info size={18} />}>
            The app’s storage is not a backup. Documents live <strong>only on this device, inside this browser</strong>. Export them to Files (or iCloud Drive) to keep them safe.
          </Notice>
          <Button block onClick={prepareBackup} disabled={!saved.length} icon={<Archive size={20} />}>
            Export all documents as PDFs (ZIP)
          </Button>
          {backupFile && (
            <div className="export-result panel panel--accent">
              <div className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>
                {backupFile.name} · {formatBytes(backupFile.size)}
              </div>
              <div className="row">
                {canShareFiles([backupFile]) && (
                  <Button variant="primary" className="grow" onClick={() => deliverBackup('share')}>
                    Share / Save to Files
                  </Button>
                )}
                <Button className="grow" onClick={() => deliverBackup('download')}>
                  Download
                </Button>
              </div>
            </div>
          )}
          {damaged.length > 0 && (
            <Notice tone="danger" icon={<TriangleAlert size={18} />}>
              {damaged.length} stored record{damaged.length === 1 ? ' is' : 's are'} damaged and can’t be decrypted.{' '}
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  if (await confirmAction({ title: 'Remove damaged records?', body: 'They cannot be opened and will be permanently deleted.', confirmLabel: 'Remove', danger: true })) {
                    await deleteDamagedRecords().catch((err) => reportError(err, 'Could not remove them.'));
                  }
                }}
              >
                Remove them
              </button>
            </Notice>
          )}
          <Button variant="danger" block onClick={() => setSheet('erase')} icon={<Trash2 size={20} />}>
            Erase all app data
          </Button>
        </section>

        <section className="stack">
          <h2 className="section-h">Privacy</h2>
          <div className="panel about">
            <p>
              <strong>No accounts, ads, analytics or uploads.</strong> Scanning, enhancement, OCR and PDF creation all run on this device. The app only
              downloads its own files from the address you opened it from.
            </p>
            <p className="row faint" style={{ marginTop: 8 }}>
              {online ? <Wifi size={16} /> : <WifiOff size={16} />}
              {online ? 'Online' : 'Offline'} · Scanning and export work offline once the app has loaded. OCR needs one online use to download its ~7 MB engine.
            </p>
            <p className="faint mono" style={{ marginTop: 8, fontSize: 'var(--fs-xs)' }}>
              Night City Scanner {__APP_VERSION__}
            </p>
          </div>
        </section>
      </div>

      {sheet === 'passcode' && <ChangePasscodeSheet onClose={() => setSheet(null)} />}
      {sheet === 'passkey' && <PasskeySheet onClose={() => setSheet(null)} />}
      {sheet === 'security' && <SecuritySheet onClose={() => setSheet(null)} />}
      {sheet === 'erase' && <EraseSheet onClose={() => setSheet(null)} />}
      {backup && <BusyOverlay title="Preparing backup" detail={backup.label} progress={backup.progress} />}
    </main>
  );
}

function ChangePasscodeSheet({ onClose }: { onClose: () => void }) {
  const currentKind = useApp((s) => s.vaultKind) ?? 'password';
  const [current, setCurrent] = useState('');
  const [kind, setKind] = useState<SecretKind>(currentKind);
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const problem = validateSecret(kind, next);
    if (problem) return setError(problem);
    if (next !== next2) return setError('The new entries don’t match.');
    setBusy(true);
    setError(null);
    try {
      const r = await changeSecret(current, kind, next);
      if (r === 'ok') {
        await refreshVaultInfo();
        toast('success', 'Passcode changed.');
        onClose();
      } else if (r === 'throttled') setError('Too many attempts. Wait a moment and try again.');
      else setError('The current passcode is incorrect.');
    } catch (err) {
      setError(describeError(err, 'Could not change the passcode.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Change passcode" onClose={onClose}>
      <div className="stack">
        <SecretInput label={`Current ${currentKind === 'pin' ? 'passcode' : 'password'}`} value={current} onChange={setCurrent} autoComplete="current-password" numeric={currentKind === 'pin'} autoFocus />
        <Segmented label="New passcode type" value={kind} onChange={setKind} options={[{ value: 'pin', label: 'Numeric passcode' }, { value: 'password', label: 'Password' }]} />
        <SecretInput label={kind === 'pin' ? 'New passcode (6–16 digits)' : 'New password (8+ characters)'} value={next} onChange={setNext} autoComplete="new-password" numeric={kind === 'pin'} />
        <SecretInput label="Confirm new" value={next2} onChange={setNext2} autoComplete="new-password" numeric={kind === 'pin'} onSubmit={submit} />
        {error && <p className="lock__error" role="alert">{error}</p>}
        <Button variant="primary" block size="lg" onClick={submit} busy={busy} disabled={!current || !next || !next2}>
          Change
        </Button>
      </div>
    </Sheet>
  );
}

function PasskeySheet({ onClose }: { onClose: () => void }) {
  const hasPasskey = useApp((s) => s.hasPasskey);
  const kind = useApp((s) => s.vaultKind);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enable = async () => {
    setBusy(true);
    setError(null);
    const release = suspendAutoLock();
    try {
      const dek = await verifyForEnrollment(secret);
      if (!dek) {
        setError('The passcode is incorrect.');
        return;
      }
      const enrollment = await enrollPasskey();
      await savePasskeyWrap(dek, enrollment.credentialId, enrollment.prfSalt, enrollment.prfOutput);
      await refreshVaultInfo();
      toast('success', 'Face ID / passkey unlock is on.');
      onClose();
    } catch (err) {
      setError(describeError(err, 'Passkey setup failed.'));
    } finally {
      release();
      setBusy(false);
    }
  };
  const disable = async () => {
    await removePasskeyWrap();
    await refreshVaultInfo();
    toast('info', 'Passkey unlock turned off. You can also delete the passkey in Settings › Passwords.');
    onClose();
  };
  return (
    <Sheet title="Face ID / passkey" onClose={onClose}>
      <div className="stack">
        <p className="muted">
          Websites cannot use Face ID directly. This option creates a <strong>passkey</strong> for this app; iOS asks for Face ID (or your device passcode) before
          releasing a secret that unlocks your encryption key. It needs a recent iOS with iCloud Keychain passkeys and is only enabled if your device actually
          returns that secret. Your passcode keeps working either way.
        </p>
        {hasPasskey ? (
          <Button variant="danger" block onClick={disable}>
            Turn off passkey unlock
          </Button>
        ) : (
          <>
            <SecretInput label="Confirm with your passcode" value={secret} onChange={setSecret} autoComplete="current-password" numeric={kind === 'pin'} autoFocus />
            {error && <p className="lock__error" role="alert">{error}</p>}
            <Button variant="primary" block size="lg" onClick={enable} busy={busy} disabled={!secret} icon={<Fingerprint size={20} />}>
              Set up passkey unlock
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SecuritySheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="What the lock protects" onClose={onClose}>
      <div className="stack prose">
        <p>
          <strong>Encrypted at rest.</strong> Every document, page image, thumbnail, recognized text and setting is encrypted with AES-256-GCM before it is
          written to the browser’s storage. The key is itself encrypted with a key derived from your passcode (PBKDF2-SHA-256, 600,000 iterations, random
          salt). Your passcode is never stored, in any form.
        </p>
        <p>
          <strong>Locked means unreadable.</strong> When the app locks, the key is discarded from memory and all decrypted images are released. Nothing in the
          app can show a document until the passcode is entered again.
        </p>
        <p>
          <strong>Limits, honestly:</strong>
        </p>
        <ul>
          <li>A 6-digit passcode stops casual access, but someone who copies this browser’s data could try every combination offline. A long password makes that impractical.</li>
          <li>Wrong-attempt delays are enforced by the app itself; they slow guessing on screen but are not tamper-proof.</li>
          <li>While the app is unlocked, anyone holding your phone can see your documents. Malicious browser extensions or a compromised device can also read unlocked content.</li>
          <li>iOS may suspend the app without notice; the lock is applied when it resumes. Choose “Now” for the strictest behavior.</li>
          <li>Exported PDFs are ordinary files outside this protection unless you set a PDF password when exporting.</li>
        </ul>
      </div>
    </Sheet>
  );
}

function EraseSheet({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Erase all app data" onClose={onClose}>
      <div className="stack">
        <Notice tone="danger" icon={<TriangleAlert size={18} />}>
          This permanently deletes every document, unfinished scan, setting and your passcode from this app. Files you exported are not affected.
        </Notice>
        <p className="muted">Export anything you want to keep first (Settings › Export all documents).</p>
        <label className="field">
          <span className="label">Type ERASE to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} />
        </label>
        <Button
          variant="danger"
          block
          size="lg"
          busy={busy}
          disabled={typed.trim().toUpperCase() !== 'ERASE'}
          onClick={async () => {
            setBusy(true);
            try {
              lockApp();
              await resetEverything();
              await boot();
            } catch (err) {
              reportError(err, 'Could not erase the data.');
              setBusy(false);
            }
          }}
        >
          Erase everything
        </Button>
      </div>
    </Sheet>
  );
}
