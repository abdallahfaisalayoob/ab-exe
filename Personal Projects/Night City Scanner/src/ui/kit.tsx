import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { blobUrl } from '../lib/storage/blobUrls';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'magenta';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: ReactNode;
  busy?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', block, icon, busy, className = '', children, disabled, ...rest }: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  round?: boolean;
  size?: 'sm' | 'md';
}

/** Icon-only button; `label` is required so screen readers announce it. */
export function IconButton({ label, variant = 'ghost', round, size = 'md', className = '', children, ...rest }: IconButtonProps) {
  const cls = ['btn', `btn--${variant}`, 'btn--icon', round && 'btn--round', size === 'sm' && 'btn--sm', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function TopBar({ title, onBack, backLabel = 'Back', start, end }: { title: ReactNode; onBack?: () => void; backLabel?: string; start?: ReactNode; end?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar__side">
        {onBack && (
          <IconButton label={backLabel} onClick={onBack}>
            <ChevronLeft size={24} />
          </IconButton>
        )}
        {start}
      </div>
      <h1 className="topbar__title">{title}</h1>
      <div className="topbar__side topbar__side--end">{end}</div>
    </header>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="seg__opt" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function SwitchRow({ title, hint, checked, onChange, disabled }: { title: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="list-row">
      <div className="list-row__text">
        <div className="list-row__title">{title}</div>
        {hint && <div className="list-row__hint">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Bottom sheet modal with Escape-to-close, focus management and a labelled title. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={ref}>
        <div className="sheet__head">
          <h2 className="sheet__title" id={id}>
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={22} />
          </IconButton>
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="bottombar">{footer}</div>}
      </div>
    </>
  );
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'danger'; icon: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice ${tone !== 'info' ? `notice--${tone}` : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

/** Decrypts and shows a stored image; nothing renders until the blob is available. */
export function BlobImage({ blobId, alt, className, onLoad }: { blobId: string | null; alt: string; className?: string; onLoad?: (img: HTMLImageElement) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (!blobId) return;
    blobUrl(blobId)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [blobId]);
  if (failed) return <div className={`img-missing ${className ?? ''}`}>Image unavailable</div>;
  if (!url) return <div className={`img-loading ${className ?? ''}`} aria-hidden />;
  return <img src={url} alt={alt} className={className} decoding="async" draggable={false} onLoad={(e) => onLoad?.(e.currentTarget)} />;
}

export function Spinner({ large, label = 'Loading' }: { large?: boolean; label?: string }) {
  return <span className={`spinner ${large ? 'spinner--lg' : ''}`} role="status" aria-label={label} />;
}

export function formatDate(ms: number, withTime = false): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
