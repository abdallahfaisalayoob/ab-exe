import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from '../kit';

export function SecretInput({
  value,
  onChange,
  onSubmit,
  label,
  autoFocus,
  autoComplete,
  disabled,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  label: string;
  autoFocus?: boolean;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
  numeric?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="input-wrap">
        <input
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          maxLength={256}
          inputMode={numeric ? 'numeric' : undefined}
          pattern={numeric ? '[0-9]*' : undefined}
        />
        <IconButton className="input-wrap__action" label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((s) => !s)}>
          {shown ? <EyeOff size={20} /> : <Eye size={20} />}
        </IconButton>
      </span>
    </label>
  );
}
