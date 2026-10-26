import type { OcrResult, OcrWord } from '../../types/models';
import { AppError } from '../storage/errors';

/**
 * On-device OCR with Tesseract (tesseract.js 7, LSTM English model).
 * Engine, worker and language data are served from this app's own origin
 * (public/vendor/tesseract); nothing is sent to any server. The first run
 * downloads ~7 MB from this app's host, after which it is cached offline.
 *
 * OCR is probabilistic: results depend on image quality and can contain errors.
 */
type TesseractWorker = import('tesseract.js').Worker;
let workerPromise: Promise<TesseractWorker> | null = null;
let progressCb: ((p: number) => void) | null = null;

function vendor(path: string): string {
  return new URL(`vendor/tesseract/${path}`, document.baseURI).href;
}

async function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: vendor('worker.min.js'),
      corePath: vendor('core/'),
      langPath: vendor('lang'),
      gzip: true,
      workerBlobURL: false,
      // Language data is cached by the service worker; don't duplicate it in IndexedDB.
      cacheMethod: 'none',
      logger: (m) => {
        if (m.status === 'recognizing text') progressCb?.(m.progress);
      },
      errorHandler: () => undefined,
    });
    // tesseract.js defaults to "single uniform block", which drops headings
    // and other text set in a different size. Documents need full layout analysis.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw new AppError('The text-recognition engine could not be loaded. It needs a one-time download while online.', {
      cause: err,
    });
  });
  return workerPromise;
}

export async function recognize(image: Blob, width: number, height: number, onProgress?: (p: number) => void): Promise<OcrResult> {
  const worker = await getWorker();
  progressCb = onProgress ?? null;
  try {
    // Tell Tesseract the real resolution (long side ≈ A4's 11.69 in) instead of letting it guess.
    const dpi = Math.round(Math.min(600, Math.max(70, Math.max(width, height) / 11.69)));
    await worker.setParameters({ user_defined_dpi: String(dpi) });
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    const words: OcrWord[] = [];
    let confSum = 0;
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const w of line.words) {
            const text = w.text.trim();
            if (!text) continue;
            words.push({
              text,
              x0: w.bbox.x0 / width,
              y0: w.bbox.y0 / height,
              x1: w.bbox.x1 / width,
              y1: w.bbox.y1 / height,
              confidence: w.confidence,
            });
            confSum += w.confidence;
          }
        }
      }
    }
    return {
      text: (data.text ?? '').replace(/\n{3,}/g, '\n\n').trim(),
      words,
      confidence: words.length ? confSum / words.length : 0,
      language: 'eng',
      at: Date.now(),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Text recognition failed for this page.', { cause: err });
  } finally {
    progressCb = null;
  }
}

/** Free the OCR engine's memory (~100 MB) when done or when the app locks. */
export async function shutdownOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) {
    try {
      await (await p).terminate();
    } catch {
      /* ignore */
    }
  }
}
