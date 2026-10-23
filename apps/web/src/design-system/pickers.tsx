import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  forwardRef,
  InputHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './app-frame';

/**
 * Seletores do Comandou. No computador usam o controle nativo; no toque (celular, PWA),
 * tocar no campo abre uma folha que sobe de baixo, grande e no visual do sistema, em vez
 * da roleta do iPhone/Android. O elemento nativo continua na página (formulários, leitores
 * de tela e testes funcionam igual), e a escolha na folha dispara o mesmo `onChange`.
 */

function useCoarse() {
  const q = '(pointer: coarse)';
  const [coarse, set] = useState(() => !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => set(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

function setRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: T | null }).current = el;
}

/** Troca o valor do elemento nativo e avisa o React, como se a pessoa tivesse escolhido ali. */
function commit(
  el: HTMLInputElement | HTMLSelectElement,
  value: string,
  event: 'input' | 'change',
) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

/** Nome do campo para o título da folha: aria-label, <label> ou o rótulo do .cm-field. */
function fieldName(el: HTMLElement, fallback: string) {
  const label = (el as HTMLInputElement).labels?.[0];
  return (
    el.getAttribute('aria-label') ||
    el.closest('.cm-field')?.querySelector('.cm-label')?.textContent?.trim() ||
    // <label> que envolve o campo: só o texto dele, sem as opções do select.
    (label && !label.contains(el) ? label.textContent?.trim() : '') ||
    fallback
  );
}

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Título da folha no celular (padrão: o rótulo do campo). */
  sheetTitle?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', sheetTitle, children, ...rest },
  ref,
) {
  const el = useRef<HTMLSelectElement | null>(null);
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [title, setTitle] = useState('');
  const [current, setCurrent] = useState('');

  const show = () => {
    const s = el.current;
    if (!s || s.disabled) return;
    setOpts([...s.options].map((o) => ({ value: o.value, label: o.text, disabled: o.disabled })));
    setTitle(sheetTitle ?? fieldName(s, 'Escolha uma opção'));
    setCurrent(s.value);
    setOpen(true);
  };

  return (
    <span className={`cm-picker ${coarse ? 'is-touch' : ''}`}>
      <select
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        className={`cm-input ${className}`}
        {...rest}
        onFocus={(e) => {
          // No toque, o foco (ex.: tocar no rótulo) abriria a roleta nativa.
          if (coarse) {
            e.currentTarget.blur();
            show();
          }
          rest.onFocus?.(e);
        }}
      >
        {children}
      </select>
      {coarse && (
        <button
          type="button"
          className="cm-picker__tap"
          tabIndex={-1}
          aria-hidden
          disabled={rest.disabled}
          onClick={show}
        />
      )}
      {coarse &&
        createPortal(
          <Sheet open={open} title={title} onClose={() => setOpen(false)}>
            <div className="cm-options" role="listbox" aria-label={title}>
              {opts.map((o) => {
                const on = o.value === current;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={o.disabled}
                    className={`cm-option ${on ? 'is-on' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      if (el.current && el.current.value !== o.value)
                        commit(el.current, o.value, 'change');
                    }}
                  >
                    <span>{o.label}</span>
                    {on && <Check size={20} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </Sheet>,
          document.body,
        )}
    </span>
  );
});

/* ------------------------------------------------------------------ data */

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parse(v: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function shift(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

function Calendar({
  value,
  min,
  max,
  onPick,
}: {
  value: string;
  min?: string;
  max?: string;
  onPick: (v: string) => void;
}) {
  const start = parse(value) ?? new Date();
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const today = iso(new Date());
  const first = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(first).fill(null),
    ...Array.from({ length: days }, (_, i) =>
      iso(new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ),
  ];
  const out = (d: string) => (!!min && d < min) || (!!max && d > max);
  const go = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const quick: [string, string][] = [
    ['Hoje', today],
    ['Ontem', shift(-1)],
    ['Há 7 dias', shift(-7)],
  ];

  return (
    <div className="cm-cal">
      <div className="cm-cal__quick">
        {quick
          .filter(([, d]) => !out(d))
          .map(([label, d]) => (
            <button
              key={label}
              type="button"
              className={`cm-cal__chip ${d === value ? 'is-on' : ''}`}
              onClick={() => onPick(d)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="cm-cal__head">
        <button
          type="button"
          className="cm-cal__nav"
          aria-label="Mês anterior"
          onClick={() => go(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <strong>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </strong>
        <button
          type="button"
          className="cm-cal__nav"
          aria-label="Próximo mês"
          onClick={() => go(1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="cm-cal__grid" role="grid">
        {WEEK.map((w, i) => (
          <span key={i} className="cm-cal__dow" aria-hidden>
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              disabled={out(d)}
              aria-pressed={d === value}
              className={`cm-cal__day ${d === value ? 'is-on' : ''} ${d === today ? 'is-today' : ''}`}
              onClick={() => onPick(d)}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`b${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  sheetTitle?: string;
};

/** Campo de data: no toque, abre um calendário numa folha; no computador, o nativo. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className = '', sheetTitle, ...rest },
  ref,
) {
  const el = useRef<HTMLInputElement | null>(null);
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const show = () => {
    const i = el.current;
    if (!i || i.disabled || i.readOnly) return;
    setTitle(sheetTitle ?? fieldName(i, 'Escolha o dia'));
    setOpen(true);
  };

  return (
    <span className={`cm-picker ${coarse ? 'is-touch' : ''}`}>
      <input
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        type="date"
        className={`cm-input ${className}`}
        {...rest}
        onFocus={(e) => {
          if (coarse) {
            e.currentTarget.blur();
            show();
          }
          rest.onFocus?.(e);
        }}
      />
      {coarse && (
        <button
          type="button"
          className="cm-picker__tap"
          tabIndex={-1}
          aria-hidden
          disabled={rest.disabled}
          onClick={show}
        />
      )}
      {coarse &&
        createPortal(
          <Sheet open={open} title={title} onClose={() => setOpen(false)}>
            <Calendar
              value={String(rest.value ?? el.current?.value ?? '')}
              min={rest.min as string | undefined}
              max={rest.max as string | undefined}
              onPick={(v) => {
                setOpen(false);
                if (el.current && el.current.value !== v) commit(el.current, v, 'input');
              }}
            />
          </Sheet>,
          document.body,
        )}
    </span>
  );
});
