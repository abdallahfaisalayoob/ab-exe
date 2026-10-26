import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileImage, FileText, Info, Lock, Share, TriangleAlert } from 'lucide-react';
import type { DocumentRecord, MarginSize, PageSize, PdfQuality } from '../../types/models';
import { useApp } from '../../state/store';
import { holdAwake, markSaved, recordExport, reportError, suspendAutoLock, toast, updateSettings } from '../../state/actions';
import { getBlob } from '../../lib/storage/repo';
import { buildPdf, canvasReencode } from '../../lib/pdf/generate';
import { extensionForType, pageImageFilename, pdfFilename, sanitizeFilename, zipFilename } from '../../lib/document/filename';
import { canShareFiles, downloadFile, formatBytes, shareFiles, zipFiles } from '../../lib/export/share';
import { describeError } from '../../lib/storage/errors';
import { Button, Notice, Progress, Segmented, Sheet, SwitchRow } from '../kit';
import { SecretInput } from '../lock/SecretInput';
import { PdfPreview } from './PdfPreview';

interface Generated {
  file: File;
  /** Unencrypted bytes, kept only in memory for the in-app preview. */
  previewBytes: Uint8Array;
  pages: number;
  encrypted: boolean;
}

export function ExportSheet({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const defaults = useApp((s) => s.settings.pdf);
  const [tab, setTab] = useState<'pdf' | 'images'>('pdf');
  const [name, setName] = useState(doc.title);
  const [pageSize, setPageSize] = useState<PageSize>(defaults.pageSize);
  const [margin, setMargin] = useState<MarginSize>(defaults.margin);
  const [quality, setQuality] = useState<PdfQuality>(defaults.quality);
  const [searchable, setSearchable] = useState(defaults.searchable);
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Generated | null>(null);
  const [images, setImages] = useState<File[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasOcr = doc.pages.some((p) => p.kind === 'image' && p.ocr);
  const blocked = doc.pages.some((p) => p.kind === 'image' && p.state !== 'ready');
  const imagePages = doc.pages.filter((p) => p.kind === 'image');
  const filename = pdfFilename(name);
  const passwordProblem = protect ? (password.length < 4 ? 'Use at least 4 characters.' : password !== password2 ? 'Passwords don’t match.' : null) : null;

  // Any option change invalidates a generated file.
  useEffect(() => {
    setResult(null);
    setImages(null);
    setError(null);
  }, [pageSize, margin, quality, searchable, protect, password, name, tab]);

  const generate = async () => {
    setError(null);
    setProgress(0);
    const release = holdAwake();
    try {
      const plain = await buildPdf(
        doc,
        { pageSize, margin, quality, searchable: searchable && hasOcr },
        { getBlob, reencode: canvasReencode, onProgress: (d, t) => setProgress(d / t) },
      );
      let bytes = plain;
      if (protect) {
        const { encryptPdf } = await import('../../lib/pdf/encrypt');
        bytes = await encryptPdf(plain, password);
      }
      const file = new File([bytes as Uint8Array<ArrayBuffer>], filename, { type: 'application/pdf', lastModified: Date.now() });
      setResult({ file, previewBytes: plain, pages: doc.pages.length, encrypted: protect });
      void updateSettings({ pdf: { pageSize, margin, quality, searchable } });
      await markSaved(doc.id).catch(() => undefined);
    } catch (err) {
      setError(describeError(err, 'The PDF could not be created.'));
    } finally {
      release();
      setProgress(null);
    }
  };

  const generateImages = async () => {
    setError(null);
    setProgress(0);
    try {
      const files: File[] = [];
      for (let i = 0; i < imagePages.length; i++) {
        const p = imagePages[i];
        if (p.kind !== 'image' || !p.processedBlobId) continue;
        const blob = await getBlob(p.processedBlobId);
        files.push(new File([blob], pageImageFilename(name, i, imagePages.length, extensionForType(blob.type)), { type: blob.type }));
        setProgress((i + 1) / imagePages.length);
      }
      setImages(files);
    } catch (err) {
      setError(describeError(err, 'The page images could not be read.'));
    } finally {
      setProgress(null);
    }
  };

  /** Must run synchronously inside the tap for iOS to allow the share sheet. */
  const share = (files: File[], kind: 'pdf' | 'images') => {
    const release = suspendAutoLock();
    shareFiles(files, sanitizeFilename(name))
      .then((outcome) => {
        if (outcome === 'shared') {
          toast('success', 'Shared. If you chose “Save to Files”, the file is now in the Files app.');
          void recordExport(doc.id, { at: Date.now(), kind, method: 'shared', filename: files.length === 1 ? files[0].name : `${files.length} images` });
        }
      })
      .catch((err) => {
        reportError(err, 'Sharing failed. Try Download instead.');
      })
      .finally(release);
  };

  const download = async (blob: Blob, fname: string, kind: 'pdf' | 'zip' | 'images') => {
    downloadFile(blob, fname);
    // We can only confirm the download was handed to the browser, not where it was saved.
    toast('info', 'Download started. On iPhone it goes to Files › Downloads.');
    await recordExport(doc.id, { at: Date.now(), kind, method: 'downloaded', filename: fname });
  };

  const downloadImages = async () => {
    if (!images) return;
    try {
      const zip = await zipFiles(images);
      await download(zip, zipFilename(name), 'zip');
    } catch (err) {
      reportError(err, 'Could not create the ZIP file.');
    }
  };

  const canSharePdf = useMemo(() => (result ? canShareFiles([result.file]) : false), [result]);
  const canShareImages = useMemo(() => (images?.length ? canShareFiles(images) : false), [images]);

  return (
    <Sheet title="Export" onClose={onClose}>
      <div className="stack">
        <Segmented
          label="Export format"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pdf', label: 'PDF' },
            { value: 'images', label: 'Page images' },
          ]}
        />
        <label className="field">
          <span className="label">File name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} enterKeyHint="done" />
          <span className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {tab === 'pdf' ? filename : pageImageFilename(name, 0, imagePages.length || 1, 'jpg')}
          </span>
        </label>

        {blocked && (
          <Notice tone="warn" icon={<TriangleAlert size={18} />}>
            Some pages are still processing or failed. Wait for them to finish, or fix them in the review screen.
          </Notice>
        )}

        {tab === 'pdf' ? (
          <>
            <div className="field">
              <span className="label">Page size</span>
              <Segmented label="Page size" value={pageSize} onChange={setPageSize} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit to scan' }]} />
            </div>
            <div className="field">
              <span className="label">Margins</span>
              <Segmented label="Margins" value={margin} onChange={setMargin} options={[{ value: 'none', label: 'None' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }]} />
            </div>
            <div className="field">
              <span className="label">Quality</span>
              <Segmented label="Quality" value={quality} onChange={setQuality} options={[{ value: 'max', label: 'Maximum' }, { value: 'balanced', label: 'Balanced' }, { value: 'small', label: 'Smaller file' }]} />
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {quality === 'max' ? 'Pages embedded exactly as processed — no extra compression.' : quality === 'balanced' ? 'About 300 DPI on A4; good for printing.' : 'About 200 DPI; best for email and messaging.'}
              </span>
            </div>
            <div className="list panel">
              <SwitchRow
                title="Searchable text"
                hint={hasOcr ? 'Adds an invisible OCR text layer so you can search and copy text.' : 'Run “Recognize text” on the review screen first.'}
                checked={searchable && hasOcr}
                disabled={!hasOcr}
                onChange={setSearchable}
              />
              <SwitchRow title="Password-protect" hint="AES-256 encryption. Anyone opening the PDF will need this password." checked={protect} onChange={setProtect} />
            </div>
            {protect && (
              <div className="stack">
                <SecretInput label="PDF password" value={password} onChange={setPassword} autoComplete="new-password" />
                <SecretInput label="Confirm password" value={password2} onChange={setPassword2} autoComplete="new-password" />
                {passwordProblem && password && <span className="lock__error">{passwordProblem}</span>}
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  This password is not stored anywhere. If you forget it, the exported PDF cannot be opened.
                </span>
              </div>
            )}

            {progress !== null && (
              <div className="stack" aria-live="polite">
                <span className="faint">Building PDF… {Math.round(progress * 100)}%</span>
                <Progress value={progress} label="Building PDF" />
              </div>
            )}
            {error && (
              <Notice tone="danger" icon={<TriangleAlert size={18} />}>
                {error}
              </Notice>
            )}

            {!result ? (
              <Button variant="primary" size="lg" block onClick={generate} busy={progress !== null} disabled={blocked || !doc.pages.length || !!passwordProblem} icon={<FileText size={20} />}>
                Create PDF
              </Button>
            ) : (
              <div className="export-result panel panel--accent">
                <div className="row">
                  <FileText size={28} className="export-result__icon" aria-hidden />
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {result.file.name}
                    </div>
                    <div className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {result.pages} pages · {formatBytes(result.file.size)}
                      {result.encrypted ? ' · AES-256' : ''}
                    </div>
                  </div>
                  {result.encrypted && <Lock size={18} aria-label="Password protected" />}
                </div>
                <div className="stack">
                  {canSharePdf && (
                    <Button variant="primary" size="lg" block onClick={() => share([result.file], 'pdf')} icon={<Share size={20} />}>
                      Share / Save to Files
                    </Button>
                  )}
                  <div className="row">
                    <Button className="grow" onClick={() => setPreview(true)} icon={<Eye size={18} />}>
                      Preview
                    </Button>
                    <Button className="grow" onClick={() => download(result.file, result.file.name, 'pdf')} icon={<Download size={18} />}>
                      Download
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {doc.pages.some((p) => p.kind === 'pdf') && (
              <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                Pages imported from PDFs are only included in PDF exports.
              </p>
            )}
            {error && (
              <Notice tone="danger" icon={<TriangleAlert size={18} />}>
                {error}
              </Notice>
            )}
            {!images ? (
              <Button variant="primary" size="lg" block onClick={generateImages} busy={progress !== null} disabled={blocked || !imagePages.length} icon={<FileImage size={20} />}>
                Prepare {imagePages.length} image{imagePages.length === 1 ? '' : 's'}
              </Button>
            ) : (
              <div className="stack">
                {canShareImages && (
                  <Button variant="primary" size="lg" block onClick={() => share(images, 'images')} icon={<Share size={20} />}>
                    Share {images.length} image{images.length === 1 ? '' : 's'}
                  </Button>
                )}
                <Button block onClick={downloadImages} icon={<Download size={18} />}>
                  Download as ZIP
                </Button>
                {images.length === 1 && (
                  <Button block variant="ghost" onClick={() => download(images[0], images[0].name, 'images')}>
                    Download image only
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        <Notice icon={<Info size={18} />}>
          To keep a copy in Apple’s <strong>Files</strong> app, tap Share and choose <strong>Save to Files</strong>. The exported file is separate from the app’s
          storage: deleting it in one place does not delete the other.
        </Notice>
      </div>
      {preview && result && <PdfPreview bytes={result.previewBytes} title={result.file.name} onClose={() => setPreview(false)} />}
    </Sheet>
  );
}
