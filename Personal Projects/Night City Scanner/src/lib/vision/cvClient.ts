import type { CvRequest, CvResultMap, DetectResult, ProcessArgs, ProcessResult } from './cvProtocol';

/**
 * Promise wrapper around a cv.worker instance. Two independent workers are
 * used: one for live preview detection (latency-sensitive, drops frames when
 * busy) and one for full-resolution page processing (serialized queue), so
 * processing a captured page never freezes the viewfinder overlay.
 */
class CvWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module', name: 'ncs-cv' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error ?? 'Image processing failed'));
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        const err = new Error('The image-processing engine failed to load.');
        this.pending.forEach((p) => p.reject(err));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  call<M extends CvRequest['method']>(
    method: M,
    args: Extract<CvRequest, { method: M }>['args'],
    transfer: Transferable[] = [],
  ): Promise<CvResultMap[M]> {
    const w = this.ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, method, args }, transfer);
    });
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    const err = new Error('Cancelled');
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }
}

const live = new CvWorker();
const proc = new CvWorker();
let queue: Promise<unknown> = Promise.resolve();

/** Start compiling OpenCV in the background (takes ~1 s on first launch). */
export function warmUp(): Promise<unknown> {
  return Promise.all([live.call('init', undefined), proc.call('init', undefined)]);
}

/** Detect on a live frame; returns null if the previous frame is still being analysed. */
export function detectLiveFrame(img: ImageData): Promise<DetectResult> | null {
  if (live.busy) return null;
  const data = img.data.buffer as ArrayBuffer;
  return live.call('detectFrame', { data, width: img.width, height: img.height }, [data]);
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function analyzeImage(blob: Blob, maxSide = 1000) {
  return enqueue(() => proc.call('analyzeBlob', { blob, maxSide }));
}

/** Full-resolution processing, one page at a time to bound memory use. */
export function processImage(args: ProcessArgs): Promise<ProcessResult> {
  return enqueue(() => proc.call('process', args));
}

/** Release WebAssembly memory (called on lock and when leaving the camera). */
export function shutdownVision(): void {
  live.terminate();
  proc.terminate();
  queue = Promise.resolve();
}

export function shutdownLiveDetector(): void {
  live.terminate();
}
