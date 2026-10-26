import { toast } from './state/actions';

/**
 * Service worker: caches the app's own files so it opens and scans offline.
 * It never caches or sees documents (those live encrypted in IndexedDB).
 * Updates are applied on the next launch after the user confirms.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast('info', 'An update is ready.', { action: { label: 'Reload', run: () => void update(true) }, ms: 15000 });
      },
      onOfflineReady() {
        toast('success', 'Ready to work offline.');
      },
    });
  });
}
