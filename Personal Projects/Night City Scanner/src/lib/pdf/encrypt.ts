import { AppError } from '../storage/errors';
import { randomBytes } from '../security/crypto';

/**
 * Password-protect a PDF with AES-256 (PDF 2.0 / R6 "AESv3") using qpdf
 * 12, a long-established open-source PDF library compiled to WebAssembly.
 * No custom cryptography is involved.
 *
 * Limitation: the password is enforced by the PDF reader. It protects the
 * file's contents (they are encrypted), but anyone who knows it can open the
 * file, and the PDF's own permission flags are advisory.
 */
export async function encryptPdf(bytes: Uint8Array, userPassword: string): Promise<Uint8Array> {
  if (!userPassword) throw new AppError('Enter a password to protect the PDF.');
  const { default: createModule } = await import('@neslinesli93/qpdf-wasm');
  const wasmUrl = new URL('vendor/qpdf/qpdf.wasm', document.baseURI).href;
  const errors: string[] = [];
  let qpdf;
  try {
    qpdf = await (createModule as unknown as (o: object) => Promise<QpdfLike>)({
      locateFile: () => wasmUrl,
      noInitialRun: true,
      print: () => undefined,
      printErr: (s: string) => errors.push(s),
    });
  } catch (err) {
    throw new AppError('The PDF encryption engine could not be loaded. Check your connection and try again.', { cause: err });
  }
  // A random owner password: the user password alone grants full access.
  const owner = Array.from(randomBytes(24), (b) => b.toString(16).padStart(2, '0')).join('');
  qpdf.FS.writeFile('/in.pdf', bytes);
  const code = qpdf.callMain(['--encrypt', userPassword, owner, '256', '--', '/in.pdf', '/out.pdf']);
  if (code !== 0 && code !== 3) {
    // 3 = success with warnings
    throw new AppError('PDF encryption failed.', { cause: new Error(errors.join('\n')) });
  }
  const out = qpdf.FS.readFile('/out.pdf');
  try {
    qpdf.FS.unlink('/in.pdf');
    qpdf.FS.unlink('/out.pdf');
  } catch {
    /* module is discarded anyway */
  }
  return out;
}

interface QpdfLike {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
}
