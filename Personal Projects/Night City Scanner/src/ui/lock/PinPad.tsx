import { useEffect } from 'react';
import { Delete } from 'lucide-react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Numeric keypad for passcodes of 6–16 digits. Digits are never shown, only
 * a count; a hardware keyboard works too.
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled,
  max = 16,
  submitLabel = 'Enter',
  minLength = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  max?: number;
  submitLabel?: string;
  minLength?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        if (value.length < max) onChange(value + e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        onChange(value.slice(0, -1));
      } else if (e.key === 'Enter' && value.length >= minLength) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onSubmit, disabled, max, minLength]);

  const press = (d: string) => !disabled && value.length < max && onChange(value + d);
  const dots = Math.max(6, value.length);

  return (
    <div className="pinpad">
      <div className="pin-dots" aria-live="polite" aria-label={`${value.length} digit${value.length === 1 ? '' : 's'} entered`}>
        {Array.from({ length: dots }, (_, i) => (
          <span key={i} className={`pin-dot ${i < value.length ? 'pin-dot--on' : ''}`} />
        ))}
      </div>
      <div className="pin-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" className="pin-key" onClick={() => press(k)} disabled={disabled} aria-label={k}>
            {k}
          </button>
        ))}
        <button type="button" className="pin-key pin-key--fn" onClick={() => onChange(value.slice(0, -1))} disabled={disabled || !value} aria-label="Delete last digit">
          <Delete size={24} />
        </button>
        <button type="button" className="pin-key" onClick={() => press('0')} disabled={disabled} aria-label="0">
          0
        </button>
        <button type="button" className="pin-key pin-key--fn pin-key--ok" onClick={onSubmit} disabled={disabled || value.length < minLength} aria-label={submitLabel}>
          {submitLabel === 'Enter' ? 'OK' : submitLabel}
        </button>
      </div>
    </div>
  );
}
