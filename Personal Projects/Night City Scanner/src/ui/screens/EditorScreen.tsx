import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Maximize, RotateCcw, RotateCw, ScanSearch, Undo2 } from 'lucide-react';
import type { FilterPreset, ImagePage, Point, Quad, Rotation } from '../../types/models';
import { goBack, navigate, reportError, updateImagePage } from '../../state/actions';
import { blobUrl } from '../../lib/storage/blobUrls';
import { getBlob } from '../../lib/storage/repo';
import { previewRender } from '../../lib/imaging/pipeline';
import { FULL_QUAD, clamp01, isConvex, quadArea } from '../../lib/vision/geometry';
import { normalizeRotation } from '../../lib/document/model';
import { Button, Segmented, Spinner, TopBar } from '../kit';
import { useDoc } from '../hooks';

const PRESETS: Array<{ value: FilterPreset; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'Picks Document Text or Enhanced Color from the page content' },
  { value: 'original', label: 'Original', hint: 'Flattened and cropped, colors untouched' },
  { value: 'enhanced', label: 'Enhanced', hint: 'Removes shadows and color cast, keeps color' },
  { value: 'grayscale', label: 'Grayscale', hint: 'Even lighting, natural gray tones' },
  { value: 'text', label: 'Document Text', hint: 'White paper, crisp ink, keeps signatures and faint marks' },
  { value: 'bw', label: 'Black & White', hint: 'Pure black and white; smallest files' },
];

export default function EditorScreen({ docId, pageId }: { docId: string; pageId: string }) {
  const doc = useDoc(docId);
  const page = doc?.pages.find((p) => p.id === pageId) as ImagePage | undefined;
  const index = doc?.pages.findIndex((p) => p.id === pageId) ?? -1;
  const [mode, setMode] = useState<'crop' | 'filter'>('crop');
  const [corners, setCorners] = useState<Quad>(page?.corners ?? FULL_QUAD);
  const [filter, setFilter] = useState<FilterPreset>(page?.filter ?? 'auto');
  const [rotation, setRotation] = useState<Rotation>(page?.rotation ?? 0);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!page) return;
    let alive = true;
    getBlob(page.originalBlobId)
      .then((b) => alive && setOriginal(b))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.originalBlobId]);

  if (!doc || !page || page.kind !== 'image') {
    return (
      <main className="screen">
        <TopBar title="Edit page" onBack={goBack} />
        <div className="content">
          <p className="muted">This page no longer exists.</p>
        </div>
      </main>
    );
  }

  const valid = isConvex(corners) && quadArea(corners) > 0.01;
  const isFull = JSON.stringify(corners) === JSON.stringify(FULL_QUAD);

  const apply = async () => {
    setSaving(true);
    try {
      await updateImagePage(docId, pageId, { corners: isFull ? null : corners, filter, rotation });
      goBack();
    } catch (err) {
      reportError(err, 'Could not save your changes.');
      setSaving(false);
    }
  };

  return (
    <main className="screen editor">
      <TopBar
        title={`Page ${index + 1}`}
        onBack={goBack}
        backLabel="Cancel"
        end={
          <Button size="sm" variant="primary" onClick={apply} busy={saving} disabled={!valid}>
            Apply
          </Button>
        }
      />
      <div className="editor__mode">
        <Segmented
          label="Edit mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'crop', label: 'Crop' },
            { value: 'filter', label: 'Filter' },
          ]}
        />
      </div>

      <div className="editor__stage">
        {loadError ? (
          <p className="muted center-pad">The original photo of this page is missing, so it can’t be re-cropped. You can retake it.</p>
        ) : mode === 'crop' ? (
          <CornerEditor blobId={page.originalBlobId} corners={corners} onChange={setCorners} />
        ) : original ? (
          <FilterPreview page={{ ...page, corners: isFull ? null : corners, rotation }} original={original} filter={filter} />
        ) : (
          <Spinner large />
        )}
      </div>

      {mode === 'crop' ? (
        <div className="editor__tools">
          {!valid && <p className="lock__error" role="alert">Corners must form a convex shape.</p>}
          <div className="tool-row">
            <ToolButton label="Auto-detect" onClick={() => setCorners(page.detectedCorners ?? FULL_QUAD)} disabled={!page.detectedCorners}>
              <ScanSearch size={22} />
            </ToolButton>
            <ToolButton label="Full image" onClick={() => setCorners(FULL_QUAD)}>
              <Maximize size={22} />
            </ToolButton>
            <ToolButton label="Reset" onClick={() => setCorners(page.corners ?? FULL_QUAD)}>
              <Undo2 size={22} />
            </ToolButton>
            <ToolButton label="Rotate left" onClick={() => setRotation((r) => normalizeRotation(r - 90))}>
              <RotateCcw size={22} />
            </ToolButton>
            <ToolButton label="Rotate right" onClick={() => setRotation((r) => normalizeRotation(r + 90))}>
              <RotateCw size={22} />
            </ToolButton>
            <ToolButton label="Retake" onClick={() => navigate({ name: 'camera', docId, retakePageId: pageId }, { replace: true })}>
              <Camera size={22} />
            </ToolButton>
          </div>
          <p className="faint editor__hint">
            Drag the corner handles onto the page corners. {rotation ? `Output rotated ${rotation}°.` : ''}
          </p>
        </div>
      ) : (
        <div className="editor__tools">
          <div className="preset-row" role="radiogroup" aria-label="Filter">
            {PRESETS.map((p) => (
              <button key={p.value} type="button" role="radio" aria-checked={filter === p.value} className="preset" onClick={() => setFilter(p.value)}>
                <span className="preset__name">{p.label}</span>
              </button>
            ))}
          </div>
          <p className="faint editor__hint">{PRESETS.find((p) => p.value === filter)?.hint}</p>
        </div>
      )}
    </main>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" className="tool" onClick={onClick} disabled={disabled}>
      {children}
      <span>{label}</span>
    </button>
  );
}

/** Shows the processed result for the chosen preset, rendered from the original. */
function FilterPreview({ page, original, filter }: { page: ImagePage; original: Blob; filter: FilterPreset }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const key = `${filter}:${page.rotation}:${JSON.stringify(page.corners)}`;
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setBusy(true);
    previewRender(page, original, filter, 1200)
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => alive && setUrl(null))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
      if (made) setTimeout(() => URL.revokeObjectURL(made!), 1000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, original]);
  return (
    <div className="filter-preview">
      {url && <img src={url} alt="Filter preview" />}
      {busy && (
        <div className="filter-preview__busy">
          <Spinner label="Rendering preview" />
        </div>
      )}
    </div>
  );
}

const HANDLE_LABELS = ['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'];

/**
 * Four draggable corner handles over the original photo. Handles have large
 * invisible hit areas; a magnifier shows the area under the finger. Arrow
 * keys nudge the focused handle for keyboard users.
 */
function CornerEditor({ blobId, corners, onChange }: { blobId: string; corners: Quad; onChange: (q: Quad) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    blobUrl(blobId).then((u) => alive && setUrl(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [blobId]);

  // Fit the photo inside the stage while keeping its aspect ratio.
  useEffect(() => {
    if (!size || !stageRef.current) return;
    const el = stageRef.current;
    const measure = () => {
      const pad = 28;
      const aw = el.clientWidth - pad * 2;
      const ah = el.clientHeight - pad * 2;
      const s = Math.min(aw / size.w, ah / size.h);
      setFit({ w: Math.max(50, size.w * s), h: Math.max(50, size.h * s) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const toPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }, []);

  const move = (i: number, p: Point) => {
    const next = corners.slice() as Quad;
    next[i] = p;
    onChange(next);
  };

  const onDown = (i: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(i);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (drag === null) return;
    move(drag, toPoint(e));
  };
  const onUp = () => setDrag(null);

  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    move(i, { x: clamp01(corners[i].x + v[0]), y: clamp01(corners[i].y + v[1]) });
  };

  const pts = fit ? corners.map((c) => `${c.x * fit.w},${c.y * fit.h}`).join(' ') : '';
  const active = drag !== null ? corners[drag] : null;
  const LOUPE = 110;
  const ZOOM = 2.5;

  return (
    <div className="corner-stage" ref={stageRef}>
      {url && (
        <img
          src={url}
          alt=""
          style={{ display: 'none' }}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      )}
      {!fit && <Spinner large />}
      {fit && url && (
        <div className="corner-box" ref={boxRef} style={{ width: fit.w, height: fit.h }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <img src={url} alt="Original photo" className="corner-box__img" draggable={false} />
          <svg className="corner-box__svg" width={fit.w} height={fit.h} aria-hidden>
            <defs>
              <mask id="crop-mask">
                <rect width={fit.w} height={fit.h} fill="white" />
                <polygon points={pts} fill="black" />
              </mask>
            </defs>
            <rect width={fit.w} height={fit.h} fill="rgba(5,6,10,0.55)" mask="url(#crop-mask)" />
            <polygon points={pts} className="corner-box__quad" />
          </svg>
          {corners.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`handle ${drag === i ? 'handle--active' : ''}`}
              style={{ left: c.x * fit.w, top: c.y * fit.h }}
              onPointerDown={onDown(i)}
              onKeyDown={onKey(i)}
              aria-label={`${HANDLE_LABELS[i]}. Use arrow keys to move.`}
            >
              <span className="handle__dot" />
            </button>
          ))}
          {active && (
            <div
              className="loupe"
              aria-hidden
              style={{
                width: LOUPE,
                height: LOUPE,
                // Sit above the finger, flip below near the top edge.
                left: Math.min(Math.max(active.x * fit.w - LOUPE / 2, -10), fit.w - LOUPE + 10),
                top: active.y * fit.h - LOUPE - 36 < -20 ? active.y * fit.h + 36 : active.y * fit.h - LOUPE - 36,
                backgroundImage: `url(${url})`,
                backgroundSize: `${fit.w * ZOOM}px ${fit.h * ZOOM}px`,
                backgroundPosition: `${LOUPE / 2 - active.x * fit.w * ZOOM}px ${LOUPE / 2 - active.y * fit.h * ZOOM}px`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

