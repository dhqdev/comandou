import { useId } from 'react';

/** "2026-11-30T23:59" para o campo de data e hora, no horário do aparelho. */
export const localInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** Campo de data e hora (horário do aparelho) → ISO com fuso, como a API pede. */
export const isoOf = (local: string) => (local ? new Date(local).toISOString() : null);

/** Texto de várias linhas no padrão dos formulários (ocupa a linha toda). */
export function AreaField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  hint,
  rows = 2,
  wide = true,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  maxLength: number;
  placeholder?: string;
  hint?: string;
  rows?: number;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={`cm-field${wide ? ' cm-form__wide' : ''}`}>
      <label className="cm-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="cm-input"
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <small id={`${id}-hint`} className="cm-hint">
          {hint}
        </small>
      )}
    </div>
  );
}

/** Liga/desliga com título e explicação (texto à esquerda, interruptor à direita). */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <label className="os-toggle cm-form__wide">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch__track" aria-hidden />
      </span>
    </label>
  );
}
