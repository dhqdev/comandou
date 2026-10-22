import { ReactNode, SelectHTMLAttributes, useId } from 'react';

/** Campo de seleção com rótulo, no mesmo visual do TextField. */
export function SelectField({
  label,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="cm-field">
      <label className="cm-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="cm-input" {...rest}>
        {children}
      </select>
    </div>
  );
}

/** Abas simples (botões com aria-selected). */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange(v: T): void;
  items: [NoInfer<T>, string][];
}) {
  return (
    <div className="chips" role="tablist">
      {items.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          className="chip"
          aria-selected={value === v}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Quantidade de estoque digitada no padrão brasileiro ("0,350") → "0.350". */
export function parseQtyInput(input: string): string | null {
  const clean = input.trim().replace(/\./g, '').replace(',', '.');
  return /^\d{1,10}(\.\d{1,3})?$/.test(clean) ? clean : null;
}

/** Custo unitário com até 4 casas ("12,3456"). */
export function parseCostInput(input: string): string | null {
  const clean = input
    .trim()
    .replace(/\s|R\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return /^\d{1,10}(\.\d{1,4})?$/.test(clean) ? clean : null;
}

/** "12.500" → "12,5" para exibição (sem float). */
export function fmtQty(q: string): string {
  const neg = q.startsWith('-');
  const [i, f = ''] = (neg ? q.slice(1) : q).split('.');
  const frac = f.replace(/0+$/, '');
  return `${neg ? '-' : ''}${Number(i).toLocaleString('pt-BR')}${frac ? `,${frac}` : ''}`;
}

/** "2026-10-22" → "22/10/2026". */
export const fmtDate = (d: string) => d.split('-').reverse().join('/');

/** Data local de hoje (AAAA-MM-DD) no fuso do aparelho. */
export function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
