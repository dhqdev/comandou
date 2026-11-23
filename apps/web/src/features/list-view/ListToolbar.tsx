import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Pin,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { DateInput, Select, Sheet } from '../../design-system';
import {
  chipText,
  fieldKind,
  groupFields,
  onBar,
  rangeValue,
  DATE_PRESETS,
  dateBounds,
  fold,
  matchAll,
  optionCounts,
  presetCounts,
  type FieldPrefs,
  type ListField,
  type ListTab,
} from './list-view';
import type { ListView } from './useListView';
import './list-view.css';

const nf = new Intl.NumberFormat('pt-BR');
/** No toque, focar a busca da caixa abriria o teclado por cima das opções. */
const fine = () => !!window.matchMedia?.('(pointer: fine)').matches;

function useNarrow() {
  const q = '(max-width: 640px)';
  const [narrow, set] = useState(() => !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => set(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

/**
 * Caixa que abre embaixo de um botão (no computador) ou folha que sobe (no celular).
 * Fecha com Esc, clique fora ou rolagem da página.
 */
function Popover({
  anchor,
  open,
  title,
  onClose,
  children,
  footer,
  width = 280,
  maxHeight = 440,
  className,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  maxHeight?: number;
  className?: string;
}) {
  const narrow = useNarrow();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || narrow) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom - 12;
      setPos({
        top: r.bottom + 6,
        left,
        width: w,
        maxHeight: Math.max(220, Math.min(maxHeight, below)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, narrow, anchor, width, maxHeight]);

  useEffect(() => {
    if (!open || narrow) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      // Folha ou calendário do campo de data aberto por cima: não fecha a caixa.
      if ((t as HTMLElement).closest?.('dialog, [data-datepop]')) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, narrow, onClose, anchor]);

  if (narrow)
    return createPortal(
      <Sheet open={open} title={title} onClose={onClose} footer={footer}>
        <div className="lv-pop__sheet">{children}</div>
      </Sheet>,
      document.body,
    );
  if (!open) return null;
  return createPortal(
    <div
      ref={box}
      className={`lv-pop ${className ?? ''}`}
      role="dialog"
      aria-label={title}
      style={pos}
    >
      <div className="lv-pop__title">{title}</div>
      <div className="lv-pop__body">{children}</div>
      {footer && <div className="lv-pop__foot">{footer}</div>}
    </div>,
    document.body,
  );
}

/** Lista de opções com busca, caixas de seleção e quantas linhas cada uma tem. */
function OptionsPicker<T>({ lv, field }: { lv: ListView<T>; field: ListField<T> }) {
  const [term, setTerm] = useState('');
  const chosen = lv.filters[field.key] ?? [];
  const opts = optionCounts(field, lv.rows ?? [], lv.fields, lv.filters);
  const t = fold(term.trim());
  const list = t ? opts.filter((o) => fold(o.label).includes(t)) : opts;
  const toggle = (v: string) =>
    lv.setField(field.key, chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  return (
    <>
      {opts.length > 6 && (
        <input
          className="cm-input lv-pop__search"
          type="search"
          autoFocus={fine()}
          placeholder={`Procurar ${field.label.toLowerCase()}…`}
          aria-label={`Procurar ${field.label.toLowerCase()}`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      )}
      <div className="lv-opts" role="group" aria-label={field.label}>
        {list.length === 0 && <p className="lv-opts__empty">Nada encontrado.</p>}
        {list.map((o) => (
          <label key={o.value} className="lv-opt" data-on={chosen.includes(o.value) || undefined}>
            <input
              type="checkbox"
              checked={chosen.includes(o.value)}
              onChange={() => toggle(o.value)}
            />
            <span className="lv-opt__label">{o.label}</span>
            <span className="lv-opt__n">{nf.format(o.count)}</span>
          </label>
        ))}
      </div>
    </>
  );
}

/**
 * Período: grade de atalhos (Hoje, Ontem, Esta semana…) com quantas linhas cada um tem, e
 * De/Até livre com "Aplicar". Atalho aplica na hora; o De/Até só ao apertar "Aplicar".
 */
function DateGrid<T>({
  lv,
  field,
  counts,
  from,
  to,
  setFrom,
  setTo,
  onPick,
}: {
  lv: ListView<T>;
  field: ListField<T>;
  counts: Record<string, number> | null | undefined;
  from: string;
  to: string;
  setFrom(v: string): void;
  setTo(v: string): void;
  onPick(value: string): void;
}) {
  const value = lv.filters[field.key]?.[0] ?? '';
  const toRef = useRef<HTMLInputElement>(null);
  return (
    <div className="lv-date">
      <div className="lv-date__grid" role="radiogroup" aria-label={field.label}>
        {DATE_PRESETS.map((p) => {
          const n = counts?.[p.value];
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={value === p.value}
              className="lv-date__preset"
              data-on={value === p.value || undefined}
              onClick={() => onPick(p.value)}
            >
              <span className="lv-date__label">{p.label}</span>
              <span className="lv-date__n">{n == null ? '' : nf.format(n)}</span>
            </button>
          );
        })}
      </div>
      <div className="lv-date__range">
        <div className="lv-date__range-title">De / até</div>
        <div className="lv-date__fields">
          <div className="lv-date__field">
            <span id={`${field.key}-de`}>De</span>
            <DateInput
              aria-labelledby={`${field.key}-de`}
              sheetTitle="A partir de"
              value={from}
              max={to || undefined}
              rangeWith={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                // Escolheu o De com o mouse e falta o Até: já abre o calendário dele.
                const next = toRef.current;
                if (e.target.value && !to && next && fine())
                  requestAnimationFrame(() => {
                    next.focus();
                    next.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
                  });
              }}
            />
          </div>
          <div className="lv-date__field">
            <span id={`${field.key}-ate`}>Até</span>
            <DateInput
              ref={toRef}
              aria-labelledby={`${field.key}-ate`}
              sheetTitle="Até"
              value={to}
              min={from || undefined}
              rangeWith={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip<T>({
  lv,
  field,
  open,
  onOpen,
  onClose,
  dateCounts,
}: {
  lv: ListView<T>;
  field: ListField<T>;
  open: boolean;
  onOpen(): void;
  onClose(): void;
  dateCounts?: Record<string, number> | null;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const chosen = lv.filters[field.key];
  const set = !!chosen?.length;
  const isDate = field.kind === 'date';
  // Campo na barra (fixo da tela ou escolhido no "+ Filtro"): dá para tirar daqui mesmo.
  const removable = !field.server && onBar(field, lv.prefs);
  const remove = removable ? (
    <button
      type="button"
      className="lv-link lv-link--muted"
      onClick={() => {
        onClose();
        lv.removeField(field.key);
      }}
    >
      Tirar da barra
    </button>
  ) : null;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // De/Até começa com o período livre já aplicado (se houver) a cada abertura.
  const current = chosen?.[0] ?? '';
  useEffect(() => {
    if (!open || !isDate) return;
    const b = current.startsWith('range:') ? dateBounds(current) : null;
    setFrom(b?.[0] ?? '');
    setTo(b?.[1] ?? '');
  }, [open, isDate, current]);

  // Sem contagem do servidor, conta nas linhas já carregadas (respeitando os outros filtros).
  const counts = useMemo(() => {
    if (!isDate || !open) return null;
    if (dateCounts !== undefined) return dateCounts;
    if (field.server || !lv.rows) return null;
    return presetCounts(
      field,
      lv.rows.filter((r) => matchAll(lv.fields, r, lv.filters, field.key)),
    );
  }, [isDate, open, dateCounts, field, lv.rows, lv.fields, lv.filters]);

  const apply = (v: string) => {
    lv.setField(field.key, v ? [v] : []);
    onClose();
  };

  const footer = isDate ? (
    <>
      <p className="lv-date__note">
        {field.dateNote ?? 'Só o De: daí em diante. Só o Até: até esse dia.'}
      </p>
      <div className="lv-date__actions">
        {remove}
        {set && (
          <button type="button" className="lv-link" onClick={() => apply('')}>
            Limpar
          </button>
        )}
        <button
          type="button"
          className="cm-btn cm-btn--primary cm-btn--sm"
          disabled={!from && !to}
          onClick={() => apply(rangeValue(from, to))}
        >
          Aplicar
        </button>
      </div>
    </>
  ) : set || remove ? (
    <>
      {remove ?? <span />}
      {set && (
        <button type="button" className="lv-link" onClick={() => lv.setField(field.key, [])}>
          Limpar
        </button>
      )}
    </>
  ) : null;

  return (
    <span className="lv-chip" data-set={set || undefined} data-open={open || undefined}>
      <button
        ref={ref}
        type="button"
        className="lv-chip__btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? onClose() : onOpen())}
      >
        <span className="lv-chip__label">{field.label}:</span>
        <span className="lv-chip__value">{chipText(field, chosen)}</span>
        {(!set || field.server) && <ChevronDown size={13} aria-hidden />}
      </button>
      {set && !field.server && (
        <button
          type="button"
          className="lv-chip__x"
          aria-label={`Tirar filtro ${field.label}`}
          onClick={() => lv.setField(field.key, [])}
        >
          <X size={12} aria-hidden />
        </button>
      )}
      <Popover
        anchor={ref}
        open={open}
        title={field.label}
        onClose={onClose}
        width={isDate ? 384 : undefined}
        className={isDate ? 'lv-pop--date' : undefined}
        footer={footer}
      >
        {isDate ? (
          <DateGrid
            lv={lv}
            field={field}
            counts={counts}
            from={from}
            to={to}
            setFrom={setFrom}
            setTo={setTo}
            onPick={apply}
          />
        ) : (
          <OptionsPicker lv={lv} field={field} />
        )}
      </Popover>
    </span>
  );
}

/** Um grupo do seletor de campos ("Mais usados" ou "Demais campos"). */
function FieldGroup<T>({
  title,
  fields,
  lv,
  prefs,
  onPick,
  onPin,
  favorite,
}: {
  title: string;
  fields: ListField<T>[];
  lv: ListView<T>;
  prefs: FieldPrefs;
  onPick(f: ListField<T>): void;
  onPin(f: ListField<T>): void;
  favorite?: boolean;
}) {
  if (!fields.length) return null;
  return (
    <section className="lv-fields" data-fav={favorite || undefined}>
      <h3 className="lv-fields__title">
        {title}
        <span className="lv-fields__n">{nf.format(fields.length)}</span>
      </h3>
      <div className="lv-fields__grid">
        {fields.map((f) => {
          const pinned = onBar(f, prefs);
          const used = !!lv.filters[f.key]?.length;
          return (
            <div key={f.key} className="lv-field" data-used={used || undefined}>
              <button type="button" className="lv-field__pick" onClick={() => onPick(f)}>
                <span className="lv-field__label">{f.label}</span>
                <span className="lv-field__kind">{fieldKind(f)}</span>
              </button>
              <button
                type="button"
                className="lv-field__pin"
                data-on={pinned || undefined}
                aria-pressed={pinned}
                aria-label={pinned ? `Tirar ${f.label} da barra` : `Fixar ${f.label} na barra`}
                title={pinned ? 'Tirar da barra' : 'Fixar na barra'}
                onClick={() => onPin(f)}
              >
                <Pin size={14} aria-hidden fill={pinned ? 'currentColor' : 'none'} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * "+ Filtro": caixa larga para escolher o campo, com busca pelo título, os mais usados em cima
 * (os da barra e os usados muitas vezes) e os demais embaixo, cada um com o tipo. Escolher põe o
 * campo na barra (fica salvo) e abre o filtro dele; o alfinete põe ou tira da barra sem abrir.
 */
function AddFilter<T>({ lv, onPick }: { lv: ListView<T>; onPick(key: string): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  if (!lv.fields.length) return null;
  const prefs = lv.prefs;
  const { favorites, others } = groupFields(lv.fields, prefs, term);
  const close = () => {
    setOpen(false);
    setTerm('');
  };
  const pick = (f: ListField<T>) => {
    close();
    onPick(f.key);
  };
  const pin = (f: ListField<T>) => lv.pinField(f.key);
  const n = lv.fields.length;
  const width = n > 8 ? 820 : n > 4 ? 580 : 340;
  const first = favorites[0] ?? others[0];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="lv-add"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Plus size={14} aria-hidden />
        Filtro
      </button>
      <Popover
        anchor={ref}
        open={open}
        title="Selecionar campo"
        onClose={close}
        width={width}
        maxHeight={560}
        className="lv-pop--fields"
      >
        <form
          className="lv-fields__search"
          onSubmit={(e) => {
            e.preventDefault();
            if (first) pick(first);
          }}
        >
          <Search size={15} aria-hidden />
          <input
            className="cm-input"
            type="search"
            autoFocus={fine()}
            placeholder="Procurar o campo pelo título"
            aria-label="Procurar o campo pelo título"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </form>
        <FieldGroup
          title="Mais usados"
          fields={favorites}
          lv={lv}
          prefs={prefs}
          onPick={pick}
          onPin={pin}
          favorite
        />
        <FieldGroup
          title="Demais campos"
          fields={others}
          lv={lv}
          prefs={prefs}
          onPick={pick}
          onPin={pin}
        />
        {!favorites.length && !others.length && (
          <p className="lv-opts__empty">Nenhum campo com esse título.</p>
        )}
      </Popover>
    </>
  );
}

/** "Salvar como aba": guarda os filtros atuais com um nome. */
function SaveTab<T>({ lv }: { lv: ListView<T> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    lv.saveTab(name);
    setName('');
    setOpen(false);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="lv-savetab"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={13} aria-hidden />
        Salvar como aba
      </button>
      <Popover
        anchor={ref}
        open={open}
        title="Nova aba com estes filtros"
        onClose={() => setOpen(false)}
        footer={
          <button
            type="button"
            className="cm-btn cm-btn--primary cm-btn--sm"
            disabled={!name.trim()}
            onClick={submit}
          >
            Salvar aba
          </button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="cm-input lv-pop__search"
            autoFocus
            maxLength={40}
            placeholder="Nome da aba (ex.: Delivery pendente)"
            aria-label="Nome da aba"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </form>
      </Popover>
    </>
  );
}

function TabButton<T>({ lv, tab }: { lv: ListView<T>; tab: ListTab }) {
  const on = lv.tab?.id === tab.id;
  const n = lv.counts[tab.id];
  return (
    <span className="lv-tab" data-on={on || undefined}>
      <button type="button" role="tab" aria-selected={on} onClick={() => lv.selectTab(tab)}>
        {tab.label}
        {n != null && <span className="lv-tab__n">{nf.format(n)}</span>}
      </button>
      {on && tab.custom && (
        <button
          type="button"
          className="lv-tab__x"
          aria-label={`Apagar aba ${tab.label}`}
          title="Apagar aba"
          onClick={() => window.confirm(`Apagar a aba "${tab.label}"?`) && lv.deleteTab(tab)}
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

/**
 * Barra de lista no estilo do Frappe: abas com contagem, busca + ordenação e chips de filtro.
 * "+ Filtro" abre o seletor de campo (busca, mais usados e demais).
 * Fica grudada no topo ao rolar; o cabeçalho da tabela (classe lv-table) gruda logo abaixo.
 */
export function ListToolbar<T>({
  lv,
  searchLabel,
  searchHint,
  actions,
  summary,
  dateCounts,
  sortInHeader,
}: {
  lv: ListView<T>;
  searchLabel: string;
  /** O que a busca acha (ex.: "nº, cliente, telefone, mesa ou item"): vira a dica ao passar o mouse.
   * No campo fica só "Pesquisar" (pedido do David, 0.244: mais limpo). */
  searchHint?: string;
  /** Botões à direita das abas (ex.: atualizar). */
  actions?: ReactNode;
  /** Texto à direita dos filtros (ex.: "20 de 780 · R$ 1.234,00"). */
  summary?: ReactNode;
  /** Contagem de cada atalho de data vinda do servidor, por campo (ex.: { date: { today: 12 } }). */
  dateCounts?: Record<string, Record<string, number> | null>;
  /** A tabela ordena pelo cabeçalho das colunas: some o "Ordenar por" ao lado da busca. */
  sortInHeader?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Altura da barra vira variável no pai, para o cabeçalho da tabela grudar logo embaixo.
  useLayoutEffect(() => {
    const el = bar.current;
    const host = el?.parentElement;
    if (!el || !host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() =>
      host.style.setProperty('--lv-bar-h', `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sortOpt = lv.sorts.find((s) => s.key === lv.sort.key);
  // Chips na ordem da barra: fixos da tela, os escolhidos pela pessoa e os com filtro de uma aba.
  const chips = lv.shown.flatMap((k) => lv.fields.filter((f) => f.key === k));
  const canClear = lv.active > 0 || !!lv.query;

  const chip = (f: ListField<T>) => (
    <Chip
      key={f.key}
      lv={lv}
      field={f}
      open={openKey === f.key}
      onOpen={() => setOpenKey(f.key)}
      onClose={() => setOpenKey((k) => (k === f.key ? null : k))}
      dateCounts={dateCounts && f.key in dateCounts ? dateCounts[f.key] : undefined}
    />
  );

  return (
    <div ref={bar} className="lv-bar">
      <div className="lv-tabs">
        <div className="lv-tabs__list" role="tablist" aria-label="Abas da lista">
          {lv.tabs.map((t) => (
            <TabButton key={t.id} lv={lv} tab={t} />
          ))}
          {lv.dirty && <SaveTab lv={lv} />}
        </div>
        {actions && <div className="lv-tabs__actions">{actions}</div>}
      </div>

      <div className="lv-row">
        <label className="lv-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            className="cm-input"
            aria-label={searchLabel}
            placeholder="Pesquisar"
            title={searchHint ? `${searchLabel}: ${searchHint}` : undefined}
            value={lv.query}
            onChange={(e) => lv.setQuery(e.target.value)}
          />
        </label>
        {lv.sorts.length > 0 && !sortInHeader && (
          <div className="lv-sort">
            <button
              type="button"
              className="lv-sort__dir"
              aria-label={lv.sort.desc ? 'Ordem decrescente' : 'Ordem crescente'}
              title={lv.sort.desc ? 'Decrescente' : 'Crescente'}
              onClick={() => lv.setSort({ ...lv.sort, desc: !lv.sort.desc })}
            >
              {lv.sort.desc ? (
                <ArrowDownWideNarrow size={15} aria-hidden />
              ) : (
                <ArrowUpNarrowWide size={15} aria-hidden />
              )}
            </button>
            <Select
              className="lv-sort__field"
              aria-label="Ordenar por"
              sheetTitle="Ordenar por"
              value={sortOpt?.key ?? ''}
              onChange={(e) => {
                const s = lv.sorts.find((x) => x.key === e.target.value);
                if (s) lv.setSort({ key: s.key, desc: !s.asc });
              }}
            >
              {lv.sorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <div className="lv-chips">
        {chips.map(chip)}
        {chips.length > 0 && <span className="lv-sep" aria-hidden />}
        <AddFilter
          lv={lv}
          onPick={(key) => {
            lv.addField(key);
            // Espera o chip existir para abrir a caixa embaixo dele.
            requestAnimationFrame(() => setOpenKey(key));
          }}
        />
        {canClear && (
          <button type="button" className="lv-clear" onClick={lv.clear}>
            <X size={13} aria-hidden />
            Limpar filtros
          </button>
        )}
        {summary != null && <span className="lv-summary">{summary}</span>}
      </div>
    </div>
  );
}

/**
 * Área da tabela: sem rolagem própria (assim o cabeçalho gruda no topo da tela). Se a tabela
 * não couber na largura, rola para o lado e o cabeçalho deixa de grudar só nesse caso.
 */
export function ListTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const table = el.firstElementChild as HTMLElement | null;
      setWide(!!table && table.scrollWidth > el.clientWidth + 1);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="lv-scroll" data-wide={wide || undefined}>
      {children}
    </div>
  );
}
