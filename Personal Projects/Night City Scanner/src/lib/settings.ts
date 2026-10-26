import type { Settings } from '../types/models';
import { loadSecureMeta, saveSecureMeta } from './storage/repo';

export const DEFAULT_SETTINGS: Settings = {
  autoCapture: true,
  sensitivity: 'balanced',
  defaultFilter: 'auto',
  detectOnImport: true,
  pdf: { pageSize: 'a4', margin: 'none', quality: 'max', searchable: true },
  lockTimeout: 60_000,
  firstRunTipsDismissed: false,
};

/** Settings are stored encrypted like everything else; unknown/missing keys fall back to defaults. */
export async function loadSettings(): Promise<Settings> {
  const stored = await loadSecureMeta<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...stored, pdf: { ...DEFAULT_SETTINGS.pdf, ...(stored.pdf ?? {}) } };
}

export const saveSettings = (s: Settings) => saveSecureMeta('settings', s);
