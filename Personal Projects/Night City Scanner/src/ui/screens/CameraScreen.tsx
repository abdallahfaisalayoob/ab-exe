import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, FileUp, RefreshCw, SwitchCamera, X, Zap, ZapOff } from 'lucide-react';
import type { Quad } from '../../types/models';
import { useApp } from '../../state/store';
import { addPhoto, confirmAction, deleteDocs, goBack, navigate, reportError, toast, updateSettings } from '../../state/actions';
import {
  CameraError,
  capabilitiesOf,
  captureFrame,
  listCameras,
  openCamera,
  releaseSampler,
  sampleFrame,
  setTorch,
  setZoom,
  stopStream,
  videoTrack,
  type CameraCapabilities,
} from '../../lib/camera/camera';
import { detectLiveFrame, shutdownLiveDetector, warmUp } from '../../lib/vision/cvClient';
import { SENSITIVITY, StabilityTracker, type CaptureState } from '../../lib/vision/autoCapture';
import { isUsableQuad } from '../../lib/vision/geometry';
import type { FrameStats } from '../../lib/vision/cvProtocol';
import { BlobImage, Button, IconButton, Spinner } from '../kit';
import { useDoc, useFilePicker } from '../hooks';

const DETECT_INTERVAL_MS = 90;

type Status = 'starting' | 'live' | 'error' | 'paused';

function guidance(state: CaptureState, stats: FrameStats | null, auto: boolean, engineReady: boolean): string {
  if (!engineReady) return 'Starting edge detection…';
  if (stats && stats.brightness < 0.16) return 'More light needed';
  switch (state) {
    case 'searching':
      return 'Looking for a document…';
    case 'small':
      return 'Move closer';
    case 'waiting':
      return auto ? 'Move to the next page' : 'Document found';
    case 'detected':
      return auto ? 'Hold steady' : 'Document found — tap to capture';
    case 'steadying':
      return stats && stats.sharpness < 18 ? 'Hold still — focusing' : 'Hold steady…';
    case 'capture':
      return 'Capturing';
  }
}

export default function CameraScreen({ docId, retakePageId }: { docId: string; retakePageId?: string }) {
  const doc = useDoc(docId);
  const settings = useApp((s) => s.settings);
  const stack = useApp((s) => s.stack);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef(new StabilityTracker(SENSITIVITY[settings.sensitivity]));
  const quadRef = useRef<Quad | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastShotRef = useRef(0);
  const autoRef = useRef(settings.autoCapture && !retakePageId);

  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState<CameraError | null>(null);
  const [caps, setCaps] = useState<CameraCapabilities>({ torch: false, zoom: null });
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoomLevel] = useState(1);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [capState, setCapState] = useState<CaptureState>('searching');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [auto, setAuto] = useState(autoRef.current);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState(0);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  autoRef.current = auto;
  useEffect(() => trackerRef.current.configure(SENSITIVITY[settings.sensitivity]), [settings.sensitivity]);

  /* ---------------- camera lifecycle ---------------- */

  const start = useCallback(async () => {
    setStatus('starting');
    setError(null);
    stopStream(streamRef.current);
    try {
      const stream = await openCamera(deviceId);
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = videoTrack(stream);
      setCaps(capabilitiesOf(track));
      setTorchOn(false);
      setZoomLevel((track?.getSettings() as { zoom?: number })?.zoom ?? 1);
      track?.addEventListener('ended', () => setStatus((s) => (s === 'live' ? 'paused' : s)));
      setStatus('live');
      listCameras().then(setCameras);
    } catch (err) {
      setError(err instanceof CameraError ? err : new CameraError('failed', 'The camera could not be started.'));
      setStatus('error');
    }
  }, [deviceId]);

  useEffect(() => {
    void start();
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [start]);

  useEffect(() => {
    let alive = true;
    warmUp()
      .then(() => alive && setEngineReady(true))
      .catch(() => alive && toast('error', 'Edge detection is unavailable. You can still capture and crop manually.'));
    return () => {
      alive = false;
      shutdownLiveDetector();
      releaseSampler();
    };
  }, []);

  // iOS stops the camera in the background; restart when we come back.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        stopStream(streamRef.current);
        setStatus((s) => (s === 'live' ? 'paused' : s));
      } else if (videoRef.current && !streamRef.current?.active) {
        void start();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [start]);

  /* ---------------- capture ---------------- */

  const capture = useCallback(
    async (source: 'auto' | 'manual') => {
      const video = videoRef.current;
      const now = performance.now();
      if (!video || status !== 'live' || now - lastShotRef.current < 600) return;
      lastShotRef.current = now;
      let blob: Blob;
      try {
        blob = await captureFrame(video);
      } catch (err) {
        reportError(err, 'Capture failed.');
        return;
      }
      trackerRef.current.markCaptured(quadRef.current, Date.now());
      setFlash((f) => f + 1);
      setPending((n) => n + 1);
      const fallbackQuad = isUsableQuad(quadRef.current, 0.08) ? quadRef.current : null;
      const job = chainRef.current.then(() =>
        addPhoto(docId, blob, { filter: settings.defaultFilter, detect: true, fallbackQuad, replacePageId: retakePageId })
          .then((page) => {
            if (page?.state === 'error') toast('error', 'That page could not be processed; its photo was kept so you can retry.');
          })
          .catch((err) => reportError(err, 'The captured page could not be saved.'))
          .finally(() => setPending((n) => n - 1)),
      );
      chainRef.current = job;
      if (source === 'auto') announce('Page captured');
      if (retakePageId) {
        await job;
        goBack();
      }
    },
    [docId, retakePageId, settings.defaultFilter, status],
  );

  const captureRef = useRef(capture);
  captureRef.current = capture;

  /* ---------------- live detection loop ---------------- */

  useEffect(() => {
    if (status !== 'live' || !engineReady) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stopped) return;
      const video = videoRef.current;
      const frame = video ? sampleFrame(video) : null;
      const req = frame ? detectLiveFrame(frame) : null;
      if (req) {
        try {
          const res = await req;
          if (stopped) return;
          const q = res.quad && res.confidence > 0.12 ? res.quad : null;
          // Light smoothing so the outline glides instead of jittering.
          const prev = quadRef.current;
          const shown = q && prev ? (q.map((p, i) => ({ x: prev[i].x * 0.35 + p.x * 0.65, y: prev[i].y * 0.35 + p.y * 0.65 })) as Quad) : q;
          quadRef.current = shown;
          setQuad(shown);
          setStats(res.stats);
          const reading = trackerRef.current.push(q, Date.now());
          setCapState(reading.state);
          setProgress(reading.progress);
          if (reading.state === 'capture' && autoRef.current && !retakePageId) void captureRef.current('auto');
        } catch {
          /* a dropped frame is harmless */
        }
      }
      timer = setTimeout(loop, DETECT_INTERVAL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [status, engineReady, retakePageId]);

  /* ---------------- controls ---------------- */

  const toggleTorch = async () => {
    const track = videoTrack(streamRef.current);
    if (track && (await setTorch(track, !torchOn))) setTorchOn(!torchOn);
  };

  const zoomSteps = caps.zoom ? [caps.zoom.min, Math.min(caps.zoom.max, 2), Math.min(caps.zoom.max, 3)].filter((v, i, a) => a.indexOf(v) === i) : [];
  const applyZoom = async (z: number) => {
    const track = videoTrack(streamRef.current);
    if (track && (await setZoom(track, z))) setZoomLevel(z);
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const current = videoTrack(streamRef.current)?.getSettings().deviceId;
    const idx = cameras.findIndex((c) => c.deviceId === current);
    setDeviceId(cameras[(idx + 1) % cameras.length].deviceId);
  };

  const pick = useFilePicker();
  const nativeCamera = async () => {
    stopStream(streamRef.current);
    setStatus('paused');
    const files = await pick({ accept: 'image/*', capture: 'environment' });
    if (files[0]) {
      setPending((n) => n + 1);
      const job = chainRef.current.then(() =>
        addPhoto(docId, files[0], { filter: settings.defaultFilter, detect: true, replacePageId: retakePageId })
          .catch((err) => reportError(err, 'The photo could not be saved.'))
          .finally(() => setPending((n) => n - 1)),
      );
      chainRef.current = job;
      if (retakePageId) {
        await job;
        goBack();
        return;
      }
    }
    void start();
  };

  const pageCount = doc?.pages.length ?? 0;
  const lastPage = doc?.pages.at(-1);

  const finish = async () => {
    await chainRef.current;
    const prev = stack.at(-1);
    if (prev?.name === 'review' && prev.docId === docId) goBack();
    else navigate({ name: 'review', docId }, { replace: true });
  };

  const close = async () => {
    if (retakePageId) return goBack();
    if (!pageCount && !pending) {
      if (doc && doc.status === 'draft') await deleteDocs([docId]).catch(() => undefined);
      return goBack();
    }
    const review = await confirmAction({
      title: 'Leave the camera?',
      body: `Your ${pageCount + pending} captured page${pageCount + pending === 1 ? ' is' : 's are'} saved${doc?.status === 'draft' ? ' as an unfinished scan you can resume from the home screen' : ''}.`,
      confirmLabel: 'Review pages',
      cancelLabel: 'Leave',
    });
    if (review) void finish();
    else goBack();
  };

  const toggleAuto = () => {
    const next = !auto;
    setAuto(next);
    trackerRef.current.reset();
    void updateSettings({ autoCapture: next });
  };

  /* ---------------- render ---------------- */

  const quadPoints = quad && videoSize.w ? quad.map((p) => `${p.x * videoSize.w},${p.y * videoSize.h}`).join(' ') : '';
  const message = status === 'live' ? guidance(capState, stats, auto, engineReady) : '';

  return (
    <main className="camera" aria-label="Camera">
      <div className="camera__view">
        <video
          ref={videoRef}
          className="camera__video"
          playsInline
          muted
          autoPlay
          onLoadedMetadata={(e) => setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onResize={(e) => setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
        />
        {videoSize.w > 0 && status === 'live' && (
          // Same aspect handling as object-fit: cover, so the outline sits exactly on the video.
          <svg className="camera__overlay" viewBox={`0 0 ${videoSize.w} ${videoSize.h}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
            {quadPoints && (
              <polygon
                points={quadPoints}
                className={`camera__quad camera__quad--${capState}`}
                style={{ ['--p' as string]: progress }}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
        {status === 'live' && <div className="camera__guide" key={message} role="status" aria-live="polite">{message}</div>}
        {flash > 0 && <div className="camera__flash" key={flash} aria-hidden />}

        {status === 'starting' && (
          <div className="camera__center">
            <Spinner large label="Starting camera" />
          </div>
        )}
        {status === 'paused' && (
          <div className="camera__center stack" style={{ alignItems: 'center' }}>
            <p className="muted">Camera paused</p>
            <Button variant="primary" icon={<RefreshCw size={18} />} onClick={() => void start()}>
              Resume camera
            </Button>
          </div>
        )}
        {status === 'error' && error && (
          <div className="camera__center camera__error panel">
            <Camera size={32} className="camera__error-icon" aria-hidden />
            <h2>{error.kind === 'denied' ? 'Camera access needed' : error.kind === 'insecure' ? 'Secure connection needed' : 'Camera unavailable'}</h2>
            <p className="muted">{error.message}</p>
            <div className="stack" style={{ width: '100%' }}>
              {error.kind !== 'insecure' && error.kind !== 'unsupported' && (
                <Button variant="primary" block onClick={() => void start()} icon={<RefreshCw size={18} />}>
                  Try again
                </Button>
              )}
              <Button block onClick={nativeCamera} icon={<Camera size={18} />}>
                Use the iPhone Camera instead
              </Button>
              <Button
                block
                variant="ghost"
                onClick={async () => {
                  const files = await pick({ accept: 'image/*', multiple: true });
                  for (const f of files) await addPhoto(docId, f, { filter: settings.defaultFilter, detect: true }).catch((err) => reportError(err, 'Import failed.'));
                }}
                icon={<FileUp size={18} />}
              >
                Pick photos
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="camera__top">
        <IconButton label="Close camera" onClick={close} variant="ghost" round className="camera__chip-btn">
          <X size={22} />
        </IconButton>
        {!retakePageId ? (
          <div className="mode" role="radiogroup" aria-label="Capture mode">
            <button type="button" role="radio" aria-checked={auto} className="mode__opt" onClick={() => !auto && toggleAuto()}>
              Auto
            </button>
            <button type="button" role="radio" aria-checked={!auto} className="mode__opt" onClick={() => auto && toggleAuto()}>
              Manual
            </button>
          </div>
        ) : (
          <div className="mode mode--label">Retake page</div>
        )}
        <div className="row">
          {caps.torch && (
            <IconButton label={torchOn ? 'Turn torch off' : 'Turn torch on'} aria-pressed={torchOn} onClick={toggleTorch} round className="camera__chip-btn">
              {torchOn ? <Zap size={20} /> : <ZapOff size={20} />}
            </IconButton>
          )}
          {cameras.length > 1 && (
            <IconButton label="Switch camera" onClick={switchCamera} round className="camera__chip-btn">
              <SwitchCamera size={20} />
            </IconButton>
          )}
        </div>
      </div>

      {zoomSteps.length > 1 && status === 'live' && (
        <div className="zoom" role="radiogroup" aria-label="Zoom">
          {zoomSteps.map((z) => (
            <button key={z} type="button" role="radio" aria-checked={Math.abs(zoom - z) < 0.05} className="zoom__opt mono" onClick={() => applyZoom(z)}>
              {Number(z.toFixed(1))}×
            </button>
          ))}
        </div>
      )}

      <div className="camera__bottom">
        <button type="button" className="camera__stack" onClick={finish} disabled={!pageCount && !pending} aria-label={`Review ${pageCount} page${pageCount === 1 ? '' : 's'}`}>
          {lastPage?.thumbBlobId ? <BlobImage blobId={lastPage.thumbBlobId} alt="" /> : <span className="camera__stack-empty" />}
          {pending > 0 && (
            <span className="camera__stack-busy">
              <Spinner label="Processing page" />
            </span>
          )}
          {pageCount + pending > 0 && <span className="camera__count mono">{pageCount + pending}</span>}
        </button>

        <button
          type="button"
          className={`shutter ${auto && capState === 'steadying' ? 'shutter--arming' : ''}`}
          style={{ ['--p' as string]: auto ? progress : 0 }}
          onClick={() => void capture('manual')}
          disabled={status !== 'live'}
          aria-label="Capture page"
        >
          <span className="shutter__ring" aria-hidden />
          <span className="shutter__core" aria-hidden />
        </button>

        {retakePageId ? (
          <IconButton label="Take photo with the iPhone Camera" onClick={nativeCamera} round className="camera__chip-btn camera__side-btn">
            <Camera size={22} />
          </IconButton>
        ) : (
          <Button variant="primary" className="camera__done" onClick={finish} disabled={!pageCount && !pending} icon={<Check size={18} />}>
            Done
          </Button>
        )}
      </div>
      {!retakePageId && status === 'live' && (
        <button type="button" className="camera__native" onClick={nativeCamera}>
          <Camera size={14} aria-hidden /> Max-resolution photo
        </button>
      )}
      <div className="sr-only" aria-live="assertive" id="camera-announcer" />
    </main>
  );
}

function announce(text: string) {
  const el = document.getElementById('camera-announcer');
  if (el) {
    el.textContent = '';
    setTimeout(() => (el.textContent = text), 50);
  }
}
