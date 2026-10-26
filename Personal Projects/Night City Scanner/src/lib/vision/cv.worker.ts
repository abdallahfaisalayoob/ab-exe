/// <reference lib="webworker" />
/**
 * Computer-vision worker (OpenCV.js 4.12, WebAssembly). Runs off the main
 * thread so the camera preview and UI stay responsive.
 *
 *  detectFrame  – find the document quadrilateral in a small live frame
 *  analyzeBlob  – decode a captured/imported photo and detect corners on it
 *  process      – perspective-correct, enhance and encode one page
 *
 * Every cv.Mat lives in WebAssembly memory and must be deleted explicitly;
 * `scope()` tracks them so each request frees everything it allocated.
 */
import cvModule from '@techstark/opencv-js';
import type { FilterPreset, Point, Quad, Rotation } from '../../types/models';
import { isConvex, orderCorners, quadArea, warpSize } from './geometry';
import type { CvRequest, DetectResult, FrameStats, ProcessResult } from './cvProtocol';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mat = any;
let cv: any = null;

/**
 * Wait for the WebAssembly runtime. The Emscripten module is a *thenable*
 * that resolves to itself, so it must never be awaited or returned from an
 * async function: doing so recurses forever in the microtask queue and
 * freezes the worker. Hence Promise<void> and the module-level `cv`.
 */
async function ready(): Promise<void> {
  if (cv) return;
  const m: any = cvModule;
  await new Promise<void>((resolve) => {
    const isReady = () => {
      try {
        if (typeof m.Mat !== 'function') return false;
        new m.Mat().delete();
        return true;
      } catch {
        return false;
      }
    };
    if (isReady()) return resolve();
    const prev = m.onRuntimeInitialized;
    m.onRuntimeInitialized = () => {
      prev?.();
      resolve();
    };
    const t = setInterval(() => {
      if (isReady()) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });
  cv = m;
}

function scope() {
  const mats: Mat[] = [];
  return {
    t<T extends Mat>(m: T): T {
      mats.push(m);
      return m;
    },
    free() {
      for (const m of mats) {
        try {
          if (!m.isDeleted?.()) m.delete();
        } catch {
          /* ignore */
        }
      }
      mats.length = 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Detection                                                          */
/* ------------------------------------------------------------------ */

interface Candidate {
  quad: Quad;
  score: number;
}

function cornerAngleScore(q: Quad): number {
  // Perspective skews angles, so be lenient: only penalize very sharp corners.
  let s = 1;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = Math.abs((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) + 1e-9));
    s *= Math.max(0.05, 1 - Math.max(0, cos - 0.25) * 1.4);
  }
  return s;
}

function quadFromMat(approx: Mat, w: number, h: number): Quad | null {
  if (approx.rows !== 4) return null;
  const d = approx.data32S;
  const pts: Point[] = [];
  for (let i = 0; i < 4; i++) pts.push({ x: d[i * 2] / w, y: d[i * 2 + 1] / h });
  const q = orderCorners(pts);
  return isConvex(q) ? q : null;
}

function collectCandidates(bin: Mat, w: number, h: number, out: Candidate[]): void {
  const s = scope();
  try {
    const contours = s.t(new cv.MatVector());
    const hier = s.t(new cv.Mat());
    cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const frameArea = w * h;
    const minArea = frameArea * 0.08;
    for (let i = 0; i < contours.size(); i++) {
      const c = s.t(contours.get(i));
      const area = cv.contourArea(c);
      if (area < minArea) continue;
      const hull = s.t(new cv.Mat());
      cv.convexHull(c, hull, false, true);
      const peri = cv.arcLength(hull, true);
      let quad: Quad | null = null;
      for (const eps of [0.02, 0.03, 0.045, 0.06, 0.08]) {
        const approx = s.t(new cv.Mat());
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          quad = quadFromMat(approx, w, h);
          break;
        }
        if (approx.rows < 4) break;
      }
      if (!quad) continue;
      const qa = quadArea(quad);
      const solidity = Math.min(1, area / (qa * frameArea + 1e-9));
      // Contours hugging the whole frame are usually the image border, not a page.
      const borderPenalty = qa > 0.96 ? 0.35 : 1;
      out.push({ quad, score: qa * (0.4 + 0.6 * solidity) * cornerAngleScore(quad) * borderPenalty });
    }
  } finally {
    s.free();
  }
}

/** Detect a document in an RGBA image (already downscaled to ~400–1000 px). */
function detectInRgba(rgba: Mat): DetectResult {
  const s = scope();
  try {
    const w = rgba.cols;
    const h = rgba.rows;
    const gray = s.t(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

    const stats = frameStats(gray);

    // Closing with a large kernel erases dark text on light paper, leaving the page as a solid shape.
    const k = Math.max(5, Math.round(Math.min(w, h) / 45) | 1);
    const kernel = s.t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k)));
    const closed = s.t(new cv.Mat());
    cv.morphologyEx(gray, closed, cv.MORPH_CLOSE, kernel);
    const blur = s.t(new cv.Mat());
    cv.GaussianBlur(closed, blur, new cv.Size(5, 5), 0);

    const candidates: Candidate[] = [];

    // Strategy 1: edges with thresholds adapted to the frame's median brightness.
    const median = medianOf(blur);
    const lo = Math.max(10, 0.5 * median);
    const hi = Math.min(255, Math.max(lo + 30, 1.2 * median));
    const edges = s.t(new cv.Mat());
    cv.Canny(blur, edges, lo, hi);
    const dk = s.t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, dk, new cv.Point(-1, -1), 2);
    collectCandidates(edges, w, h, candidates);

    // Strategy 2: Otsu segmentation (bright page on a darker surface).
    const bin = s.t(new cv.Mat());
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, dk);
    collectCandidates(bin, w, h, candidates);

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < 0.05) return { quad: null, confidence: 0, stats };
    return { quad: best.quad, confidence: Math.min(1, best.score * 1.6), stats };
  } finally {
    s.free();
  }
}

function medianOf(gray: Mat): number {
  const d: Uint8Array = gray.data;
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(d.length / 40000));
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    hist[d[i]]++;
    n++;
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n / 2) return v;
  }
  return 128;
}

function frameStats(gray: Mat): FrameStats {
  const s = scope();
  try {
    const mean = cv.mean(gray)[0];
    const lap = s.t(new cv.Mat());
    cv.Laplacian(gray, lap, cv.CV_64F);
    const m = s.t(new cv.Mat());
    const sd = s.t(new cv.Mat());
    cv.meanStdDev(lap, m, sd);
    const std = sd.data64F[0];
    return { brightness: mean / 255, sharpness: std * std };
  } finally {
    s.free();
  }
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return await createImageBitmap(blob);
  }
}

function bitmapToRgba(bitmap: ImageBitmap, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): Mat {
  const canvas = new OffscreenCanvas(dw, dh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  const img = ctx.getImageData(0, 0, dw, dh);
  canvas.width = canvas.height = 0;
  return cv.matFromImageData(img);
}

/* ------------------------------------------------------------------ */
/* Enhancement                                                        */
/* ------------------------------------------------------------------ */

const odd = (n: number) => (Math.round(n) | 1) >>> 0;

/**
 * Estimate the paper's illumination for one 8-bit channel: downscale, take a
 * local maximum (removes ink), smooth, upscale. Dividing by this flattens
 * shadows, uneven lighting and color casts.
 */
function background(ch: Mat, s: ReturnType<typeof scope>): Mat {
  const f = Math.max(4, Math.round(Math.max(ch.cols, ch.rows) / 320));
  const small = s.t(new cv.Mat());
  cv.resize(ch, small, new cv.Size(Math.max(8, Math.round(ch.cols / f)), Math.max(8, Math.round(ch.rows / f))), 0, 0, cv.INTER_AREA);
  const k = s.t(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)));
  cv.dilate(small, small, k);
  cv.medianBlur(small, small, odd(Math.max(5, Math.min(small.cols, small.rows) / 12)));
  cv.GaussianBlur(small, small, new cv.Size(0, 0), 2);
  const bg = s.t(new cv.Mat());
  cv.resize(small, bg, new cv.Size(ch.cols, ch.rows), 0, 0, cv.INTER_LINEAR);
  return bg;
}

function flatten(ch: Mat, s: ReturnType<typeof scope>): Mat {
  const bg = background(ch, s);
  const out = s.t(new cv.Mat());
  cv.divide(ch, bg, out, 255);
  return out;
}

/** Apply a 256-entry lookup table in place. */
function applyLut(m: Mat, lut: Uint8Array): void {
  const d: Uint8Array = m.data;
  for (let i = 0; i < d.length; i++) d[i] = lut[d[i]];
}

function curveLut(black: number, white: number, gamma: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - black) / Math.max(1, white - black)));
    lut[v] = Math.round(Math.pow(t, gamma) * 255);
  }
  return lut;
}

/** Value at the given low percentile of a channel (the "ink" level). */
function percentile(m: Mat, p: number): number {
  const d: Uint8Array = m.data;
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(d.length / 200000));
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    hist[d[i]]++;
    n++;
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * p) return v;
  }
  return 0;
}

function unsharp(m: Mat, amount: number, s: ReturnType<typeof scope>): void {
  if (amount <= 0) return;
  const sigma = Math.max(0.8, Math.max(m.cols, m.rows) / 2600);
  const blur = s.t(new cv.Mat());
  cv.GaussianBlur(m, blur, new cv.Size(0, 0), sigma);
  cv.addWeighted(m, 1 + amount, blur, -amount, 0, m);
}

/** Hasler–Süsstrunk colorfulness on a small copy; < ~20 means essentially monochrome. */
function colorfulness(rgb: Mat, s: ReturnType<typeof scope>): number {
  const small = s.t(new cv.Mat());
  const scale = Math.min(1, 300 / Math.max(rgb.cols, rgb.rows));
  cv.resize(rgb, small, new cv.Size(Math.max(1, Math.round(rgb.cols * scale)), Math.max(1, Math.round(rgb.rows * scale))), 0, 0, cv.INTER_AREA);
  const d: Uint8Array = small.data;
  let n = 0, mrg = 0, myb = 0, srg = 0, syb = 0;
  for (let i = 0; i < d.length; i += 3) {
    const rg = d[i] - d[i + 1];
    const yb = 0.5 * (d[i] + d[i + 1]) - d[i + 2];
    mrg += rg; myb += yb; srg += rg * rg; syb += yb * yb; n++;
  }
  mrg /= n; myb /= n;
  const sdrg = Math.sqrt(Math.max(0, srg / n - mrg * mrg));
  const sdyb = Math.sqrt(Math.max(0, syb / n - myb * myb));
  return Math.hypot(sdrg, sdyb) + 0.3 * Math.hypot(mrg, myb);
}

type Concrete = Exclude<FilterPreset, 'auto'>;

/** Returns an RGB or single-channel Mat owned by `s`. */
function applyFilter(rgb: Mat, preset: Concrete, s: ReturnType<typeof scope>): Mat {
  switch (preset) {
    case 'original':
      return rgb;
    case 'enhanced': {
      // Per-channel flattening also neutralizes warm/cool light on white paper.
      const chans = s.t(new cv.MatVector());
      cv.split(rgb, chans);
      const flat = s.t(new cv.MatVector());
      for (let i = 0; i < 3; i++) {
        const f = flatten(s.t(chans.get(i)), s);
        flat.push_back(f);
      }
      const out = s.t(new cv.Mat());
      cv.merge(flat, out);
      applyLut(out, curveLut(percentile(out, 0.005) * 0.6, 250, 1.12));
      unsharp(out, 0.35, s);
      return out;
    }
    case 'grayscale': {
      const gray = s.t(new cv.Mat());
      cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
      const flat = flatten(gray, s);
      applyLut(flat, curveLut(percentile(flat, 0.005) * 0.7, 248, 1.05));
      unsharp(flat, 0.4, s);
      return flat;
    }
    case 'text': {
      // High-contrast grayscale: paper goes white, ink darkens, but gray
      // levels survive so signatures, stamps and faint print are kept.
      const gray = s.t(new cv.Mat());
      cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
      const flat = flatten(gray, s);
      const ink = percentile(flat, 0.01);
      applyLut(flat, curveLut(Math.min(ink, 120) * 0.8, 232, 1.45));
      unsharp(flat, 0.55, s);
      return flat;
    }
    case 'bw': {
      const gray = s.t(new cv.Mat());
      cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
      const flat = flatten(gray, s);
      const block = odd(Math.max(15, Math.min(flat.cols, flat.rows) / 40));
      const adaptive = s.t(new cv.Mat());
      cv.adaptiveThreshold(flat, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 12);
      // Keep large solid dark areas solid (adaptive thresholding hollows them out).
      const solid = s.t(new cv.Mat());
      cv.threshold(flat, solid, 90, 255, cv.THRESH_BINARY);
      cv.bitwise_and(adaptive, solid, adaptive);
      return adaptive;
    }
  }
}

function resolveAuto(rgb: Mat, s: ReturnType<typeof scope>): Concrete {
  return colorfulness(rgb, s) > 22 ? 'enhanced' : 'text';
}

const ROTATE_CODE: Record<Exclude<Rotation, 0>, string> = {
  90: 'ROTATE_90_CLOCKWISE',
  180: 'ROTATE_180',
  270: 'ROTATE_90_COUNTERCLOCKWISE',
};

async function encode(m: Mat, type: 'image/jpeg' | 'image/png', quality: number): Promise<Blob> {
  const s = scope();
  try {
    const rgba = s.t(new cv.Mat());
    cv.cvtColor(m, rgba, m.channels() === 1 ? cv.COLOR_GRAY2RGBA : cv.COLOR_RGB2RGBA);
    const img = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
    const canvas = new OffscreenCanvas(rgba.cols, rgba.rows);
    (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type, quality });
    canvas.width = canvas.height = 0;
    return blob;
  } finally {
    s.free();
  }
}

/** 64-bit difference hash of a grayscale version, hex encoded. */
function dHash(m: Mat, s: ReturnType<typeof scope>): string {
  const gray = s.t(new cv.Mat());
  if (m.channels() === 1) m.copyTo(gray);
  else cv.cvtColor(m, gray, cv.COLOR_RGB2GRAY);
  const tiny = s.t(new cv.Mat());
  cv.resize(gray, tiny, new cv.Size(9, 8), 0, 0, cv.INTER_AREA);
  const d: Uint8Array = tiny.data;
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (d[row * 9 + col] > d[row * 9 + col + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Largest source side decoded for processing (bounds memory on 24–48 MP photos). */
const MAX_SOURCE = 5200;

async function processPage(req: Extract<CvRequest, { method: 'process' }>['args']): Promise<ProcessResult> {
  await ready();
  const bitmap = await decode(req.blob);
  const s = scope();
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const q = req.quad;
    // Decode only the bounding box of the page, at native resolution when possible.
    let bx = 0, by = 0, bw = W, bh = H;
    if (q) {
      const xs = q.map((p) => p.x * W);
      const ys = q.map((p) => p.y * H);
      bx = Math.max(0, Math.floor(Math.min(...xs)));
      by = Math.max(0, Math.floor(Math.min(...ys)));
      bw = Math.min(W, Math.ceil(Math.max(...xs))) - bx;
      bh = Math.min(H, Math.ceil(Math.max(...ys))) - by;
    }
    const scale = Math.min(1, MAX_SOURCE / Math.max(bw, bh));
    const cw = Math.max(1, Math.round(bw * scale));
    const ch = Math.max(1, Math.round(bh * scale));
    const src = s.t(bitmapToRgba(bitmap, bx, by, bw, bh, cw, ch));
    bitmap.close();

    let page: Mat = src;
    if (q) {
      const local = q.map((p) => ({ x: ((p.x * W - bx) * scale) / cw, y: ((p.y * H - by) * scale) / ch })) as Quad;
      const size = warpSize(local, cw, ch, req.maxLong);
      const srcPts = s.t(cv.matFromArray(4, 1, cv.CV_32FC2, local.flatMap((p) => [p.x * cw, p.y * ch])));
      const dstPts = s.t(
        cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, size.width, 0, size.width, size.height, 0, size.height]),
      );
      const M = s.t(cv.getPerspectiveTransform(srcPts, dstPts));
      page = s.t(new cv.Mat());
      cv.warpPerspective(src, page, M, new cv.Size(size.width, size.height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
      src.delete();
    } else if (Math.max(cw, ch) > req.maxLong) {
      const f = req.maxLong / Math.max(cw, ch);
      page = s.t(new cv.Mat());
      cv.resize(src, page, new cv.Size(Math.round(cw * f), Math.round(ch * f)), 0, 0, cv.INTER_AREA);
      src.delete();
    }

    const rgb = s.t(new cv.Mat());
    cv.cvtColor(page, rgb, cv.COLOR_RGBA2RGB);
    page.delete(); // free the large RGBA buffer early

    const resolved: Concrete = req.filter === 'auto' ? resolveAuto(rgb, s) : req.filter;
    let out = applyFilter(rgb, resolved, s);
    if (req.rotation) {
      const rotated = s.t(new cv.Mat());
      cv.rotate(out, rotated, cv[ROTATE_CODE[req.rotation]]);
      out = rotated;
    }

    const type = resolved === 'bw' ? 'image/png' : 'image/jpeg';
    const blob = await encode(out, type, 0.92);

    let thumb: Blob | null = null;
    let hash: string | null = null;
    if (req.thumbMax > 0) {
      const f = Math.min(1, req.thumbMax / Math.max(out.cols, out.rows));
      const small = s.t(new cv.Mat());
      cv.resize(out, small, new cv.Size(Math.max(1, Math.round(out.cols * f)), Math.max(1, Math.round(out.rows * f))), 0, 0, cv.INTER_AREA);
      thumb = await encode(small, 'image/jpeg', 0.8);
      hash = dHash(small, s);
    }
    return { blob, width: out.cols, height: out.rows, thumb, hash, resolvedFilter: resolved };
  } finally {
    s.free();
  }
}

async function analyzeBlob(blob: Blob, maxSide: number): Promise<DetectResult & { width: number; height: number }> {
  await ready();
  const bitmap = await decode(blob);
  const s = scope();
  try {
    const f = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * f));
    const h = Math.max(1, Math.round(bitmap.height * f));
    const rgba = s.t(bitmapToRgba(bitmap, 0, 0, bitmap.width, bitmap.height, w, h));
    const res = detectInRgba(rgba);
    return { ...res, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
    s.free();
  }
}

function detectFrame(args: { data: ArrayBuffer; width: number; height: number }): DetectResult {
  const s = scope();
  try {
    const img = new ImageData(new Uint8ClampedArray(args.data), args.width, args.height);
    const rgba = s.t(cv.matFromImageData(img));
    return detectInRgba(rgba);
  } finally {
    s.free();
  }
}

self.onmessage = async (e: MessageEvent<CvRequest & { id: number }>) => {
  const { id } = e.data;
  try {
    await ready();
    let result: unknown;
    switch (e.data.method) {
      case 'init':
        result = true;
        break;
      case 'detectFrame':
        result = detectFrame(e.data.args);
        break;
      case 'analyzeBlob':
        result = await analyzeBlob(e.data.args.blob, e.data.args.maxSide);
        break;
      case 'process':
        result = await processPage(e.data.args);
        break;
    }
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    const message =
      typeof err === 'number' ? `OpenCV error ${err}` : err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ id, ok: false, error: message });
  }
};
