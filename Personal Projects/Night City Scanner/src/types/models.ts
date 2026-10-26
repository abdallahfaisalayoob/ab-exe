/** A point in normalized image coordinates (0..1 on both axes). */
export interface Point {
  x: number;
  y: number;
}

/** Four document corners, always ordered top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export type Rotation = 0 | 90 | 180 | 270;

export type FilterPreset = 'auto' | 'original' | 'enhanced' | 'grayscale' | 'bw' | 'text';

export type ProcessingState = 'pending' | 'ready' | 'error';

/** One recognized word, with its box normalized to the processed page image. */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
  /** Mean word confidence 0..100 as reported by Tesseract. */
  confidence: number;
  language: string;
  at: number;
}

interface PageBase {
  id: string;
  rotation: Rotation;
  thumbBlobId: string | null;
  /** 64-bit perceptual hash (hex) of the processed page, for duplicate hints. */
  hash?: string;
}

/** A page backed by a photo or imported image that goes through the scan pipeline. */
export interface ImagePage extends PageBase {
  kind: 'image';
  originalBlobId: string;
  originalWidth: number;
  originalHeight: number;
  /** Crop corners in original-image coordinates; null = full image. */
  corners: Quad | null;
  /** What automatic detection found, kept so "Reset" can restore it. */
  detectedCorners: Quad | null;
  filter: FilterPreset;
  /** The concrete preset 'auto' resolved to on the last run. */
  resolvedFilter?: Exclude<FilterPreset, 'auto'>;
  processedBlobId: string | null;
  processedWidth: number;
  processedHeight: number;
  state: ProcessingState;
  error?: string;
  ocr?: OcrResult | null;
}

/** A page copied verbatim from an imported PDF (kept as vector/original content). */
export interface PdfPage extends PageBase {
  kind: 'pdf';
  sourceId: string;
  pageIndex: number;
  /** Page size in PDF points, before rotation. */
  width: number;
  height: number;
}

export type Page = ImagePage | PdfPage;

export interface PdfSource {
  id: string;
  blobId: string;
  name: string;
  pageCount: number;
}

export type ExportKind = 'pdf' | 'images' | 'zip';
/** 'shared' = handed to the iOS share sheet (we cannot see where the user saved it). */
export type ExportMethod = 'shared' | 'downloaded';

export interface ExportEvent {
  at: number;
  kind: ExportKind;
  method: ExportMethod;
  filename: string;
}

export type DocumentStatus = 'draft' | 'saved';

export interface DocumentRecord {
  id: string;
  title: string;
  status: DocumentStatus;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
  pdfSources: PdfSource[];
  collectionId: string | null;
  exports: ExportEvent[];
  /** Category suggested from OCR keywords; only set when the user accepts it. */
  category?: string | null;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export type PageSize = 'a4' | 'letter' | 'fit';
export type PdfQuality = 'max' | 'balanced' | 'small';
export type MarginSize = 'none' | 'small' | 'medium';

export interface PdfExportOptions {
  pageSize: PageSize;
  margin: MarginSize;
  quality: PdfQuality;
  /** Embed an invisible OCR text layer where pages have OCR results. */
  searchable: boolean;
  /** Optional AES-256 password; never persisted. */
  password?: string;
}

export type LockTimeout = 0 | 30_000 | 60_000 | 300_000 | 900_000;
export type CaptureSensitivity = 'relaxed' | 'balanced' | 'quick';

export interface Settings {
  autoCapture: boolean;
  sensitivity: CaptureSensitivity;
  defaultFilter: FilterPreset;
  detectOnImport: boolean;
  pdf: Omit<PdfExportOptions, 'password'>;
  lockTimeout: LockTimeout;
  firstRunTipsDismissed: boolean;
}
