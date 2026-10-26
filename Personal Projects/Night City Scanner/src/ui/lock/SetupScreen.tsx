import { useState } from 'react';
import { KeyRound, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import { createVault, validateSecret, type SecretKind } from '../../lib/security/vault';
import { afterUnlock } from '../../state/actions';
import { Button, Notice, Segmented } from '../kit';
import { PinPad } from './PinPad';
import { SecretInput } from './SecretInput';
import { BrandMark } from '../Brand';

type Step = 'intro' | 'enter' | 'confirm' | 'saving';

export function SetupScreen() {
  const [kind, setKind] = useState<SecretKind>('pin');
  const [step, setStep] = useState<Step>('intro');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);

  const submitFirst = () => {
    const problem = validateSecret(kind, first);
    if (problem) return setError(problem);
    setError(null);
    setStep('confirm');
  };

  const submitSecond = async () => {
    if (second !== first) {
      setError(kind === 'pin' ? 'Passcodes don’t match. Try again.' : 'Passwords don’t match. Try again.');
      setSecond('');
      return;
    }
    setStep('saving');
    try {
      await createVault(kind, first);
      setFirst('');
      setSecond('');
      await afterUnlock();
    } catch (err) {
      setError(err instanceof Error && err.name !== 'StorageError' ? err.message : 'Could not save the passcode on this device. Make sure you are not in Private Browsing.');
      setStep('enter');
      setFirst('');
      setSecond('');
    }
  };

  const restart = () => {
    setFirst('');
    setSecond('');
    setError(null);
    setStep('enter');
  };

  const noun = kind === 'pin' ? 'passcode' : 'password';

  if (step === 'intro') {
    return (
      <main className="lock lock--setup">
        <div className="lock__inner">
          <BrandMark />
          <h1 className="lock__title">Secure your scanner</h1>
          <p className="lock__lead">
            Choose a passcode to lock Night City Scanner. It also <strong>encrypts every document stored in the app</strong> on this device. No
            account, nothing leaves your phone.
          </p>
          <div className="stack" style={{ width: '100%' }}>
            <Segmented
              label="Passcode type"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'pin', label: 'Numeric passcode' },
                { value: 'password', label: 'Password' },
              ]}
            />
            <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
              {kind === 'pin'
                ? 'At least 6 digits. Quick to type; fine for keeping people out of the app.'
                : 'At least 8 characters. A longer passphrase gives much stronger encryption.'}
            </p>
            <Notice tone="warn" icon={<TriangleAlert size={18} />}>
              <strong>There is no password recovery.</strong> If you forget it, the only way back in is to erase the app’s data. Export important
              documents to the Files app regularly.
            </Notice>
            <label className="check">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>I understand that a forgotten {noun} means losing the documents stored in this app.</span>
            </label>
            <Button variant="primary" size="lg" block disabled={!understood} onClick={() => setStep('enter')} icon={<KeyRound size={20} />}>
              Create {noun}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const confirming = step === 'confirm';
  const saving = step === 'saving';
  return (
    <main className="lock">
      <div className="lock__inner">
        <div className="lock__icon">{saving ? <ShieldCheck size={28} /> : <Lock size={28} />}</div>
        <h1 className="lock__title">{saving ? 'Securing…' : confirming ? `Confirm ${noun}` : `Create ${noun}`}</h1>
        <p className="lock__lead" aria-live="polite">
          {saving ? 'Deriving your encryption key on this device.' : confirming ? `Enter the same ${noun} again.` : kind === 'pin' ? 'Use 6 to 16 digits.' : 'Use at least 8 characters.'}
        </p>
        {error && (
          <p className="lock__error" role="alert">
            {error}
          </p>
        )}
        {kind === 'pin' ? (
          <PinPad
            key={step}
            value={confirming ? second : first}
            onChange={(v) => {
              setError(null);
              if (confirming) setSecond(v);
              else setFirst(v);
            }}
            onSubmit={confirming ? submitSecond : submitFirst}
            disabled={saving}
            submitLabel={confirming ? 'Save' : 'Next'}
          />
        ) : (
          <div className="stack" style={{ width: '100%' }}>
            <SecretInput
              key={step}
              label={confirming ? 'Confirm password' : 'New password'}
              value={confirming ? second : first}
              onChange={(v) => {
                setError(null);
                if (confirming) setSecond(v);
                else setFirst(v);
              }}
              onSubmit={confirming ? submitSecond : submitFirst}
              autoFocus
              autoComplete="new-password"
              disabled={saving}
            />
            <Button variant="primary" size="lg" block busy={saving} onClick={confirming ? submitSecond : submitFirst}>
              {confirming ? 'Save password' : 'Next'}
            </Button>
          </div>
        )}
        {confirming && !saving && (
          <Button variant="ghost" onClick={restart}>
            Start over
          </Button>
        )}
      </div>
    </main>
  );
}
