import { useCallback, useEffect, useRef, useState } from 'react';
import { suspendAutoLock } from '../state/actions';
import { useApp } from '../state/store';
import { storageStatus, type StorageStatus } from '../lib/storage/repo';

/**
 * Open the system file picker (or native Camera with `capture`). iOS sends
 * the page to the background while the picker is up, so auto-lock is
 * suspended until a file arrives or the picker is dismissed.
 */
export function useFilePicker() {
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRef.current?.(), []);
  return useCallback((opts: { accept: string; multiple?: boolean; capture?: 'environment' }): Promise<File[]> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = opts.accept;
      input.multiple = !!opts.multiple;
      if (opts.capture) input.setAttribute('capture', opts.capture);
      input.style.display = 'none';
      releaseRef.current?.();
      const release = suspendAutoLock();
      releaseRef.current = release;
      let done = false;
      const finish = (files: File[]) => {
        if (done) return;
        done = true;
        release();
        input.remove();
        resolve(files);
      };
      input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
      input.addEventListener('cancel', () => finish([]));
      document.body.appendChild(input);
      input.click();
    });
  }, []);
}

export function useDoc(docId: string) {
  return useApp((s) => s.docs[docId]);
}

export function useStorageStatus(deps: unknown[] = []): StorageStatus | null {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  useEffect(() => {
    let alive = true;
    storageStatus().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return status;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
