import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useApp, type Toast } from '../state/store';
import { dismissToast } from '../state/actions';
import { Button } from './kit';
import { Logo } from './Brand';

function ToastView({ t }: { t: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(t.id), t.ms);
    return () => clearTimeout(timer);
  }, [t.id, t.ms]);
  const Icon = t.kind === 'success' ? CircleCheck : t.kind === 'error' ? CircleAlert : Info;
  return (
    <div className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={20} className="toast__icon" aria-hidden />
      <span className="toast__msg">{t.message}</span>
      {t.action && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            t.action!.run();
            dismissToast(t.id);
          }}
        >
          {t.action.label}
        </Button>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const req = useApp((s) => s.confirm);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && req.resolve(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  return (
    <>
      <div className="backdrop dialog-backdrop" onClick={() => req.resolve(false)} aria-hidden />
      <div className="panel dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <h2 className="dialog__title" id="confirm-title">
          {req.title}
        </h2>
        <p className="dialog__body" id="confirm-body">
          {req.body}
        </p>
        <div className="dialog__actions">
          <Button block onClick={() => req.resolve(false)} autoFocus>
            {req.cancelLabel ?? 'Cancel'}
          </Button>
          <Button block variant={req.danger ? 'danger' : 'primary'} onClick={() => req.resolve(true)}>
            {req.confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Opaque cover shown while the app is backgrounded so the app switcher shows no documents. */
export function PrivacyShield() {
  const shield = useApp((s) => s.shield);
  if (!shield) return null;
  return (
    <div className="shield" aria-hidden>
      <Logo size={64} />
    </div>
  );
}
