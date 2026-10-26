import { create } from 'zustand';
import type { Collection, DocumentRecord, Settings } from '../types/models';
import type { SecretKind } from '../lib/security/vault';
import { DEFAULT_SETTINGS } from '../lib/settings';

export type Route =
  | { name: 'home' }
  | { name: 'library'; collectionId?: string | null; focusSearch?: boolean }
  | { name: 'settings' }
  | { name: 'camera'; docId: string; retakePageId?: string }
  | { name: 'review'; docId: string }
  | { name: 'editor'; docId: string; pageId: string };

export type Phase = 'boot' | 'setup' | 'locked' | 'unlocked' | 'fatal';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: { label: string; run: () => void };
  ms: number;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface AppState {
  phase: Phase;
  fatal: string | null;
  vaultKind: SecretKind | null;
  hasPasskey: boolean;
  route: Route;
  stack: Route[];
  /**
   * Decrypted document metadata. Populated only while unlocked and wiped on
   * lock, so a locked app holds no document titles or images in memory.
   */
  docs: Record<string, DocumentRecord>;
  damaged: string[];
  collections: Collection[];
  settings: Settings;
  libraryLoaded: boolean;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  /** Covers the UI while the app is in the background (app-switcher snapshot). */
  shield: boolean;
}

export const initialUnlockedData = (): Pick<AppState, 'docs' | 'damaged' | 'collections' | 'settings' | 'libraryLoaded' | 'route' | 'stack'> => ({
  docs: {},
  damaged: [],
  collections: [],
  settings: DEFAULT_SETTINGS,
  libraryLoaded: false,
  route: { name: 'home' },
  stack: [],
});

export const useApp = create<AppState>(() => ({
  phase: 'boot',
  fatal: null,
  vaultKind: null,
  hasPasskey: false,
  toasts: [],
  confirm: null,
  shield: false,
  ...initialUnlockedData(),
}));

export const getState = useApp.getState;
export const setState = useApp.setState;
