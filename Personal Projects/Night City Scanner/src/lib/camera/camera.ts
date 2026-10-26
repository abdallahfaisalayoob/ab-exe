/**
 * Camera access through getUserMedia.
 *
 * iOS Safari limitations worth knowing:
 *  - Camera access needs a secure context (HTTPS or localhost).
 *  - Frames come from the *video* stream, typically up to 4K / 12 MP on
 *    iPhone, not the 24–48 MP still-photo pipeline. For maximum resolution
 *    the app also offers the native Camera via <input capture>.
 *  - ImageCapture (takePhoto) is not available, so a capture is a video frame.
 *  - The stream is stopped by iOS when the app goes to the background;
 *    callers must restart it on return.
 *  - Torch and zoom are exposed only where the browser reports them in
 *    MediaStreamTrack.getCapabilities(); we never show controls otherwise.
 */

export type CameraErrorKind = 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'failed';

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
}

interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
}

export function cameraErrorFrom(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Camera access was blocked. On iPhone: Settings › Apps › Safari › Camera › Allow (or tap “aA” › Website Settings in Safari), then reload.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('notfound', 'No usable camera was found on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', 'The camera is in use by another app or was interrupted. Close other camera apps and try again.');
    default:
      return new CameraError('failed', 'The camera could not be started.');
  }
}

export function checkCameraSupport(): void {
  if (!window.isSecureContext) {
    throw new CameraError('insecure', 'Camera access requires HTTPS. Open the app from its https:// address.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser does not provide camera access.');
  }
}

/** Request the rear camera at the highest practical resolution. */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  checkCameraSupport();
  const base: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } };
  const attempts: MediaTrackConstraints[] = [
    // 4:3 matches the sensor (and documents) better than 16:9.
    { ...base, width: { ideal: 4032 }, height: { ideal: 3024 }, aspectRatio: { ideal: 4 / 3 } },
    { ...base, width: { ideal: 3840 }, height: { ideal: 2160 } },
    { ...base, width: { ideal: 1920 }, height: { ideal: 1080 } },
    base,
  ];
  let lastErr: unknown;
  for (const video of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      lastErr = err;
      const name = (err as { name?: string })?.name;
      // Permission problems will not be fixed by relaxing constraints.
      if (name === 'NotAllowedError' || name === 'SecurityError') break;
    }
  }
  throw cameraErrorFrom(lastErr);
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export function videoTrack(stream: MediaStream | null): MediaStreamTrack | null {
  return stream?.getVideoTracks()[0] ?? null;
}

export function capabilitiesOf(track: MediaStreamTrack | null): CameraCapabilities {
  const caps = (track?.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  const zoom =
    caps.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > caps.zoom.min
      ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 }
      : null;
  return { torch: caps.torch === true, zoom };
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export async function setZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

/** Grab the current frame at full stream resolution as a high-quality JPEG. */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new CameraError('failed', 'The camera is not ready yet.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CameraError('failed', 'Could not capture the image.');
  ctx.drawImage(video, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  canvas.width = canvas.height = 0; // release the bitmap promptly (iOS canvas memory limits)
  if (!blob) throw new CameraError('failed', 'Could not capture the image.');
  return blob;
}

let sampler: HTMLCanvasElement | null = null;

/** Small downscaled frame for live detection (~480 px long side). */
export function sampleFrame(video: HTMLVideoElement, maxSide = 480): ImageData | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const f = Math.min(1, maxSide / Math.max(vw, vh));
  const w = Math.round(vw * f);
  const h = Math.round(vh * f);
  sampler ??= document.createElement('canvas');
  if (sampler.width !== w || sampler.height !== h) {
    sampler.width = w;
    sampler.height = h;
  }
  const ctx = sampler.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function releaseSampler(): void {
  if (sampler) sampler.width = sampler.height = 0;
  sampler = null;
}
