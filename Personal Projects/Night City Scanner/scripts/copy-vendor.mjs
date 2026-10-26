// Copies self-hosted runtime assets (OCR engine, OCR language data, PDF
// encryption engine, PDF renderer fonts) from node_modules into public/vendor
// so the app never fetches code or data from a third-party CDN at runtime.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

const copies = [
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // LSTM-only cores; tesseract.js picks one at runtime by SIMD support.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  // "best_int" English model: good accuracy at ~3 MB.
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
  ['@neslinesli93/qpdf-wasm/dist/qpdf.wasm', 'qpdf/qpdf.wasm'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
];

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
for (const [from, to] of copies) {
  const src = join(nm, from);
  const dest = join(out, to);
  if (!existsSync(src)) {
    console.error(`[copy-vendor] missing ${from} — run npm install`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}
console.log(`[copy-vendor] copied ${copies.length} vendor assets to public/vendor`);
