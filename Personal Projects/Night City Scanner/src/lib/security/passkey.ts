/**
 * Optional Face ID / Touch ID / device-passcode unlock via a passkey.
 *
 * A web page cannot call Face ID directly. What it *can* do is create a
 * WebAuthn passkey that requires user verification (on iPhone: Face ID or the
 * device passcode) and ask the authenticator for a "PRF" secret, a 32-byte
 * value only released after verification. We derive a key from that secret
 * and use it as a second wrapping of the data key.
 *
 * This only works where the browser + authenticator support the PRF
 * extension (Safari 18+ with iCloud Keychain passkeys). Enrollment checks the
 * real result and refuses to enable the feature if no PRF secret comes back,
 * so it is never advertised on devices where it would not work. The passcode
 * always remains available.
 */
import { randomBytes } from './crypto';

interface PrfOutputs {
  enabled?: boolean;
  results?: { first?: ArrayBuffer | ArrayBufferView };
}

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function' &&
    !!navigator.credentials
  );
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function prfOf(cred: PublicKeyCredential): PrfOutputs | undefined {
  const ext = cred.getClientExtensionResults() as { prf?: PrfOutputs };
  return ext.prf;
}

function toArrayBuffer(v: ArrayBuffer | ArrayBufferView | undefined): ArrayBuffer | null {
  if (!v) return null;
  if (v instanceof ArrayBuffer) return v;
  const copy = new Uint8Array(v.byteLength);
  copy.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  return copy.buffer;
}

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

function describeWebAuthnError(err: unknown): PasskeyError {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return new PasskeyError('Face ID / passkey request was cancelled or timed out.');
  if (name === 'InvalidStateError') return new PasskeyError('A passkey for this app already exists on this device.');
  if (name === 'SecurityError') return new PasskeyError('Passkeys need the app to be opened over HTTPS on its own domain.');
  return new PasskeyError('The passkey request failed.');
}

async function evaluatePrf(credentialId: Uint8Array<ArrayBuffer>, prfSalt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw describeWebAuthnError(err);
  }
  const out = assertion ? toArrayBuffer(prfOf(assertion)?.results?.first) : null;
  if (!out) {
    throw new PasskeyError('This device did not provide a passkey secret (WebAuthn PRF). Use your passcode instead.');
  }
  return out;
}

export interface Enrollment {
  credentialId: Uint8Array<ArrayBuffer>;
  prfSalt: Uint8Array<ArrayBuffer>;
  prfOutput: ArrayBuffer;
}

/** Create a passkey and confirm it actually yields a PRF secret. */
export async function enrollPasskey(): Promise<Enrollment> {
  if (!passkeysSupported()) throw new PasskeyError('Passkeys are not supported in this browser.');
  const prfSalt = randomBytes(32);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Night City Scanner', id: location.hostname },
        user: { id: randomBytes(16), name: 'Night City Scanner', displayName: 'Night City Scanner unlock' },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        timeout: 60_000,
        attestation: 'none',
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw describeWebAuthnError(err);
  }
  if (!cred) throw new PasskeyError('No passkey was created.');
  const credentialId = new Uint8Array(cred.rawId) as Uint8Array<ArrayBuffer>;
  const prf = prfOf(cred);
  if (prf && prf.enabled === false) {
    throw new PasskeyError('This device’s passkeys do not support the secret needed to unlock (WebAuthn PRF).');
  }
  // Some browsers return the PRF output at creation; others only on a get().
  const prfOutput = toArrayBuffer(prf?.results?.first) ?? (await evaluatePrf(credentialId, prfSalt));
  return { credentialId, prfSalt, prfOutput };
}

export async function authenticatePasskey(
  credentialId: Uint8Array<ArrayBuffer>,
  prfSalt: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  return evaluatePrf(credentialId, prfSalt);
}
