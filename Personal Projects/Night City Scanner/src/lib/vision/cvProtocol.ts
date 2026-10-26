import type { FilterPreset, Quad, Rotation } from '../../types/models';

export interface FrameStats {
  /** Mean luminance 0..1. */
  brightness: number;
  /** Variance of the Laplacian; low values mean blur. */
  sharpness: number;
}

export interface DetectResult {
  quad: Quad | null;
  confidence: number;
  stats: FrameStats;
}

export interface ProcessArgs {
  blob: Blob;
  quad: Quad | null;
  filter: FilterPreset;
  rotation: Rotation;
  /** Longest side of the output in pixels. */
  maxLong: number;
  /** Thumbnail longest side; 0 = no thumbnail. */
  thumbMax: number;
}

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
  thumb: Blob | null;
  hash: string | null;
  resolvedFilter: Exclude<FilterPreset, 'auto'>;
}

export type CvRequest =
  | { method: 'init'; args?: undefined }
  | { method: 'detectFrame'; args: { data: ArrayBuffer; width: number; height: number } }
  | { method: 'analyzeBlob'; args: { blob: Blob; maxSide: number } }
  | { method: 'process'; args: ProcessArgs };

export type CvResultMap = {
  init: boolean;
  detectFrame: DetectResult;
  analyzeBlob: DetectResult & { width: number; height: number };
  process: ProcessResult;
};
