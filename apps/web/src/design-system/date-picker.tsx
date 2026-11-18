import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  forwardRef,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './app-frame';
import { commit, fieldName, setRef, useCoarse } from './picker-utils';

/**
 * Campo de data do Comandou. O `<input type="date">` nativo continua na página (digitar
 * dd/mm/aaaa, formulários, leitores de tela e `onChange` com AAAA-MM-DD funcionam igual), mas
 * clicar nele abre o calendário do sistema: no computador, uma caixa logo embaixo do campo
 * (mês, grade de dias e "Hoje"); no toque, a mesma grade, grande, numa folha que sobe de baixo.
 * O calendário nativo do navegador não aparece mais.
 */

export const MONTHS = [
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
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseIso(v: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const addDays = (v: string, n: number) => {
  const d = parseIso(v)!;
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
const addMonths = (v: string, n: number) => {
  const d = parseIso(v)!;
  // 31/01 + 1 mês = 28 (ou 29)/02, não 03/03.
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return isoOf(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last)));
};

/** As 6 semanas (42 dias, começando no domingo) que mostram o mês de `month`. */
export function monthCells(month: Date): string[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) =>
    isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)),
  );
}

export interface CalendarProps {
  value: string;
  min?: string;
  max?: string;
  /** A outra ponta de um período (ex.: o De, no campo Até): marca os dias entre ela e o dia
   * escolhido, e mostra a prévia ao passar o mouse. */
  rangeWith?: string;
  onPick(v: string): void;
  /** Mostra "Limpar" quando há data escolhida. */
  onClear?(): void;
  /** Folha do celular: dias maiores. */
  large?: boolean;
  /** Aberto pelo teclado: o foco vai para o dia escolhido (setas andam, Enter escolhe). */
  focusDay?: boolean;
}

/** Calendário de um mês: setas para trocar o mês, clique no título escolhe mês e ano. */
export function Calendar({
  value,
  min,
  max,
  rangeWith,
  onPick,
  onClear,
  large,
  focusDay,
}: CalendarProps) {
  const [hover, setHover] = useState('');
  const today = isoOf(new Date());
  const valid = parseIso(value) ? value.slice(0, 10) : '';
  const [cursor, setCursor] = useState(() => valid || clamp(today, min, max));
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [year, setYear] = useState(() => parseIso(cursor)!.getFullYear());
  const grid = useRef<HTMLDivElement>(null);
  const kbd = useRef(!!focusDay);

  // Digitou outra data no campo: o calendário vai junto para o mês dela.
  useEffect(() => {
    if (valid) setCursor(valid);
  }, [valid]);

  useEffect(() => {
    if (!kbd.current || mode !== 'days') return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor, mode]);

  const month = parseIso(cursor)!;
  const cells = monthCells(month);
  const out = (d: string) => (!!min && d < min) || (!!max && d > max);
  const go = (n: number) => setCursor((c) => addMonths(c, n));
  const end = hover || valid;
  const [lo, hi] = rangeWith && end ? [rangeWith, end].sort() : ['', ''];

  const onGridKey = (e: ReactKeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => addDays(cursor, -parseIso(cursor)!.getDay()),
      End: () => addDays(cursor, 6 - parseIso(cursor)!.getDay()),
      PageUp: () => (e.shiftKey ? addMonths(cursor, -12) : addMonths(cursor, -1)),
      PageDown: () => (e.shiftKey ? addMonths(cursor, 12) : addMonths(cursor, 1)),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    kbd.current = true;
    setCursor(move());
  };

  const title = (
    <button
      type="button"
      className="cm-cal__title"
      aria-label={mode === 'days' ? 'Escolher mês e ano' : 'Voltar para os dias'}
      onClick={() => {
        setYear(month.getFullYear());
        setMode((m) => (m === 'days' ? 'months' : 'days'));
      }}
    >
      {mode === 'days' ? (
        <>
          {MONTHS[month.getMonth()]} <span>{month.getFullYear()}</span>
        </>
      ) : (
        <>{year}</>
      )}
    </button>
  );

  return (
    <div className={`cm-cal ${large ? 'cm-cal--lg' : ''}`}>
      <div className="cm-cal__head">
        <button
          type="button"
          className="cm-cal__nav"
          aria-label={mode === 'days' ? 'Mês anterior' : 'Ano anterior'}
          onClick={() => (mode === 'days' ? go(-1) : setYear((y) => y - 1))}
        >
          <ChevronLeft size={large ? 20 : 17} aria-hidden />
        </button>
        {title}
        <button
          type="button"
          className="cm-cal__nav"
          aria-label={mode === 'days' ? 'Próximo mês' : 'Próximo ano'}
          onClick={() => (mode === 'days' ? go(1) : setYear((y) => y + 1))}
        >
          <ChevronRight size={large ? 20 : 17} aria-hidden />
        </button>
      </div>

      {mode === 'months' ? (
        <div className="cm-cal__months">
          {MONTHS.map((m, i) => {
            const on = year === month.getFullYear() && i === month.getMonth();
            const now = year === new Date().getFullYear() && i === new Date().getMonth();
            const last = isoOf(new Date(year, i + 1, 0));
            const first = isoOf(new Date(year, i, 1));
            return (
              <button
                key={m}
                type="button"
                aria-label={`${m} de ${year}`}
                className={`cm-cal__month ${on ? 'is-on' : ''} ${now ? 'is-today' : ''}`}
                disabled={(!!min && last < min) || (!!max && first > max)}
                onClick={() => {
                  const day = Math.min(month.getDate(), new Date(year, i + 1, 0).getDate());
                  setCursor(isoOf(new Date(year, i, day)));
                  setMode('days');
                }}
              >
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : (
        <div
          ref={grid}
          className="cm-cal__grid"
          role="grid"
          aria-label={`${MONTHS[month.getMonth()]} de ${month.getFullYear()}`}
          onKeyDown={onGridKey}
          onMouseLeave={() => setHover('')}
        >
          {WEEK.map((w) => (
            <span key={w} className="cm-cal__dow" aria-hidden>
              {w}
            </span>
          ))}
          {cells.map((d) => {
            const other = Number(d.slice(5, 7)) !== month.getMonth() + 1;
            const inRange = !!lo && d > lo && d < hi;
            const edge = !!lo && (d === lo || d === hi);
            return (
              <button
                key={d}
                type="button"
                data-day={d}
                tabIndex={d === cursor ? 0 : -1}
                disabled={out(d)}
                aria-pressed={d === valid}
                aria-label={`${Number(d.slice(8))} de ${MONTHS[Number(d.slice(5, 7)) - 1]!.toLowerCase()} de ${d.slice(0, 4)}`}
                className={[
                  'cm-cal__day',
                  d === valid && 'is-on',
                  d === today && 'is-today',
                  other && 'is-other',
                  inRange && 'is-range',
                  edge && 'is-edge',
                  edge && d === lo && lo !== hi && 'is-start',
                  edge && d === hi && lo !== hi && 'is-end',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => rangeWith && !out(d) && setHover(d)}
                onClick={() => onPick(d)}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      )}

      <div className="cm-cal__foot">
        {onClear && valid ? (
          <button type="button" className="cm-cal__link" onClick={onClear}>
            Limpar
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="cm-cal__link cm-cal__today"
          disabled={out(today)}
          onClick={() => onPick(today)}
        >
          Hoje
        </button>
        <span />
      </div>
    </div>
  );
}

/** Navegador com a camada de cima (`popover`); sem ela, a caixa fica em position: fixed. */
const canPopover =
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

function clamp(d: string, min?: string, max?: string) {
  if (min && d < min) return min;
  if (max && d > max) return max;
  return d;
}

/**
 * Caixa do calendário no computador: nasce logo embaixo do campo (ou em cima, se não couber),
 * acompanha a rolagem e fecha com Esc ou clique fora. Usa a camada de cima do navegador
 * (`popover`), então aparece por cima de janelas, folhas e caixas com rolagem.
 */
function DatePop({
  anchor,
  onClose,
  children,
  label,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Dentro de uma janela (<dialog>), mora nela: fora dela tudo fica inerte.
  const [host] = useState(() => anchor.current?.closest('dialog') ?? document.body);

  useLayoutEffect(() => {
    const b = box.current;
    const a = anchor.current;
    if (!b || !a) return;
    try {
      b.showPopover?.();
    } catch {
      /* navegador sem popover: fica em position: fixed */
    }
    const place = () => {
      const r = a.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return close.current();
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8 && r.top - 6 - h >= 8) top = r.top - 6 - h;
      b.style.left = `${Math.round(left)}px`;
      b.style.top = `${Math.round(top)}px`;
      b.dataset.side = top < r.top ? 'top' : 'bottom';
    };
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (b.contains(t) || a.contains(t)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Só fecha o calendário: a janela ou caixa de filtro por baixo continua aberta.
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
      a.querySelector('input')?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      try {
        b.hidePopover?.();
      } catch {
        /* já fechado */
      }
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={box}
      className="cm-datepop"
      popover={canPopover ? 'manual' : undefined}
      role="dialog"
      aria-label={label}
      data-datepop=""
      // Clicar no calendário não tira o foco do campo (dá para seguir digitando).
      onMouseDown={(e) => e.preventDefault()}
      // Andando pelo teclado: o foco saiu do calendário e não voltou para o campo, fecha.
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !box.current?.contains(to) && !anchor.current?.contains(to)) onClose();
      }}
    >
      {children}
    </div>,
    host,
  );
}

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Título da folha no celular (padrão: o rótulo do campo). */
  sheetTitle?: string;
  /** A outra ponta de um período (ex.: o De de um filtro De/Até), marcada no calendário. */
  rangeWith?: string;
};

/** Campo de data com o calendário do Comandou (computador e celular). */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className = '', sheetTitle, rangeWith, ...rest },
  ref,
) {
  const el = useRef<HTMLInputElement | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const coarse = useCoarse();
  const [open, setOpen] = useState<false | 'mouse' | 'keyboard'>(false);
  const [title, setTitle] = useState('');
  const [typed, setTyped] = useState(String(rest.defaultValue ?? ''));
  const value = rest.value != null ? String(rest.value) : typed;
  const blocked = () => !el.current || el.current.disabled || el.current.readOnly;

  const show = (how: 'mouse' | 'keyboard') => {
    if (blocked()) return;
    setTitle(sheetTitle ?? fieldName(el.current!, 'Escolha o dia'));
    setOpen(how);
  };
  const pick = (v: string) => {
    setOpen(false);
    const i = el.current;
    if (!i) return;
    if (i.value !== v) commit(i, v, 'input');
    if (!coarse) i.focus();
  };

  const calendar = (large: boolean) => (
    <Calendar
      value={value}
      min={rest.min as string | undefined}
      max={rest.max as string | undefined}
      rangeWith={rangeWith}
      large={large}
      focusDay={open === 'keyboard'}
      onPick={pick}
      onClear={rest.required ? undefined : () => pick('')}
    />
  );

  return (
    <span
      ref={wrap}
      className={`cm-picker cm-date ${coarse ? 'is-touch' : ''} ${open ? 'is-open' : ''}`}
    >
      <input
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        type="date"
        className={`cm-input ${className}`}
        aria-haspopup="dialog"
        aria-expanded={!!open}
        {...rest}
        onChange={(e) => {
          setTyped(e.target.value);
          rest.onChange?.(e);
        }}
        onFocus={(e) => {
          // No toque, o foco (ex.: tocar no rótulo) abriria a roleta nativa.
          if (coarse) {
            e.currentTarget.blur();
            show('mouse');
          }
          rest.onFocus?.(e);
        }}
        onMouseDown={(e) => {
          if (!coarse && e.button === 0) {
            if (open) setOpen(false);
            else show('mouse');
          }
          rest.onMouseDown?.(e);
        }}
        onClick={(e) => {
          // Firefox e Safari abririam o calendário nativo por cima do nosso.
          if (!coarse) e.preventDefault();
          rest.onClick?.(e);
        }}
        onKeyDown={(e) => {
          if (!coarse && ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4')) {
            e.preventDefault();
            show('keyboard');
          } else if (e.key === 'Tab' && open) {
            setOpen(false);
          }
          rest.onKeyDown?.(e);
        }}
        onBlur={(e) => {
          const to = e.relatedTarget as HTMLElement | null;
          if (open && !to?.closest('[data-datepop]')) setOpen(false);
          rest.onBlur?.(e);
        }}
      />
      {coarse && (
        <button
          type="button"
          className="cm-picker__tap"
          tabIndex={-1}
          aria-hidden
          disabled={rest.disabled}
          onClick={() => show('mouse')}
        />
      )}
      {!coarse && open && (
        <DatePop anchor={wrap} label={title} onClose={() => setOpen(false)}>
          {calendar(false)}
        </DatePop>
      )}
      {coarse &&
        createPortal(
          <Sheet open={!!open} title={title} onClose={() => setOpen(false)}>
            {calendar(true)}
          </Sheet>,
          document.body,
        )}
    </span>
  );
});

export type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Data e hora (o antigo `datetime-local`): o calendário do Comandou para o dia e um campo de
 * hora ao lado. O valor continua AAAA-MM-DDTHH:mm num campo escondido, com o mesmo `onChange`.
 */
export const DateTimeInput = forwardRef<HTMLInputElement, DateTimeInputProps>(
  function DateTimeInput({ className = '', value, onChange, id, min, max, ...rest }, ref) {
    const hidden = useRef<HTMLInputElement | null>(null);
    const [own, setOwn] = useState(String(rest.defaultValue ?? ''));
    const v = value != null ? String(value) : own;
    const day = v.slice(0, 10);
    const time = v.slice(11, 16);
    const emit = (d: string, t: string) => {
      if (!hidden.current) return;
      commit(hidden.current, d ? `${d}T${t || '00:00'}` : '', 'input');
    };
    const { required, disabled } = rest;
    return (
      <span className={`cm-datetime ${className}`}>
        <input
          ref={(n) => {
            hidden.current = n;
            setRef(ref, n);
          }}
          type="datetime-local"
          hidden
          tabIndex={-1}
          aria-hidden
          value={v}
          min={min}
          max={max}
          onChange={(e) => {
            setOwn(e.target.value);
            onChange?.(e);
          }}
        />
        <DateInput
          id={id}
          value={day}
          required={required}
          disabled={disabled}
          aria-invalid={rest['aria-invalid']}
          aria-describedby={rest['aria-describedby']}
          min={typeof min === 'string' ? min.slice(0, 10) : undefined}
          max={typeof max === 'string' ? max.slice(0, 10) : undefined}
          onChange={(e) => emit(e.target.value, time)}
        />
        <input
          type="time"
          className="cm-input cm-datetime__time"
          aria-label="Hora"
          value={time}
          required={required}
          disabled={disabled || !day}
          onChange={(e) => emit(day, e.target.value)}
        />
      </span>
    );
  },
);
