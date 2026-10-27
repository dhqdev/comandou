import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { DateInput, Select, Sheet } from '../../design-system';
import {
  chipText,
  DATE_PRESETS,
  dateBounds,
  fold,
  isoDay,
  optionCounts,
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
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const narrow = useNarrow();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || narrow) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      setPos({ top: r.bottom + 6, left, width, maxHeight: Math.max(220, Math.min(440, below)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, narrow, anchor, width]);

  useEffect(() => {
    if (!open || narrow) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      // Folha do seletor de data aberta por cima: não fecha a caixa.
      if ((t as HTMLElement).closest?.('dialog')) return;
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
    <div ref={box} className="lv-pop" role="dialog" aria-label={title} style={pos}>
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

/** Período: atalhos (hoje, 7 dias, este mês…) ou de/até. */
function DatePicker<T>({ lv, field }: { lv: ListView<T>; field: ListField<T> }) {
  const value = lv.filters[field.key]?.[0] ?? '';
  const bounds = dateBounds(value) ?? [isoDay(), isoDay()];
  const custom = value.startsWith('range:');
  const set = (v: string) => lv.setField(field.key, v ? [v] : []);
  const range = (a: string, b: string) => set(`range:${a}:${b}`);
  return (
    <div className="lv-opts" role="radiogroup" aria-label={field.label}>
      {[{ value: '', label: 'Qualquer data' }, ...DATE_PRESETS].map((p) => (
        <label key={p.value} className="lv-opt" data-on={value === p.value || undefined}>
          <input
            type="radio"
            name={`lv-${field.key}`}
            checked={value === p.value}
            onChange={() => set(p.value)}
          />
          <span className="lv-opt__label">{p.label}</span>
        </label>
      ))}
      <label className="lv-opt" data-on={custom || undefined}>
        <input
          type="radio"
          name={`lv-${field.key}`}
          checked={custom}
          onChange={() => range(bounds[0], bounds[1])}
        />
        <span className="lv-opt__label">Escolher período</span>
      </label>
      {custom && (
        <div className="lv-range">
          <DateInput
            aria-label="De"
            sheetTitle="A partir de"
            value={bounds[0]}
            onChange={(e) => e.target.value && range(e.target.value, bounds[1])}
          />
          <span aria-hidden>até</span>
          <DateInput
            aria-label="Até"
            sheetTitle="Até"
            value={bounds[1]}
            onChange={(e) => e.target.value && range(bounds[0], e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function Chip<T>({
  lv,
  field,
  open,
  onOpen,
  onClose,
}: {
  lv: ListView<T>;
  field: ListField<T>;
  open: boolean;
  onOpen(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const chosen = lv.filters[field.key];
  const set = !!chosen?.length;
  return (
    <span className="lv-chip" data-set={set || undefined}>
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
        footer={
          set && (
            <button
              type="button"
              className="lv-link"
              onClick={() => {
                lv.setField(field.key, []);
                if (field.kind === 'date') onClose();
              }}
            >
              Limpar
            </button>
          )
        }
      >
        {field.kind === 'date' ? (
          <DatePicker lv={lv} field={field} />
        ) : (
          <OptionsPicker lv={lv} field={field} />
        )}
      </Popover>
    </span>
  );
}

/** "+ Filtro": escolhe qualquer campo da lista para filtrar. */
function AddFilter<T>({ lv, onPick }: { lv: ListView<T>; onPick(key: string): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const rest = lv.fields.filter((f) => !lv.shown.includes(f.key));
  if (!rest.length) return null;
  const t = fold(term.trim());
  const list = t ? rest.filter((f) => fold(f.label).includes(t)) : rest;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="lv-add"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={14} aria-hidden />
        Filtro
      </button>
      <Popover anchor={ref} open={open} title="Filtrar por" onClose={() => setOpen(false)}>
        {rest.length > 6 && (
          <input
            className="cm-input lv-pop__search"
            type="search"
            autoFocus={fine()}
            placeholder="Procurar campo…"
            aria-label="Procurar campo"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        )}
        <div className="lv-opts">
          {list.map((f) => (
            <button
              key={f.key}
              type="button"
              className="lv-opt lv-opt--btn"
              onClick={() => {
                setOpen(false);
                setTerm('');
                onPick(f.key);
              }}
            >
              <span className="lv-opt__label">{f.label}</span>
            </button>
          ))}
        </div>
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
 * Fica grudada no topo ao rolar; o cabeçalho da tabela (classe lv-table) gruda logo abaixo.
 */
export function ListToolbar<T>({
  lv,
  searchLabel,
  placeholder,
  actions,
  summary,
}: {
  lv: ListView<T>;
  searchLabel: string;
  placeholder: string;
  /** Botões à direita das abas (ex.: atualizar). */
  actions?: ReactNode;
  /** Texto à direita dos filtros (ex.: "20 de 780 · R$ 1.234,00"). */
  summary?: ReactNode;
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
  const chips = lv.fields.filter((f) => lv.shown.includes(f.key));
  const pinned = chips.filter((f) => f.pinned);
  const others = chips.filter((f) => !f.pinned);
  const canClear = lv.active > 0 || !!lv.query;

  const chip = (f: ListField<T>) => (
    <Chip
      key={f.key}
      lv={lv}
      field={f}
      open={openKey === f.key}
      onOpen={() => setOpenKey(f.key)}
      onClose={() => setOpenKey((k) => (k === f.key ? null : k))}
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
            placeholder={placeholder}
            value={lv.query}
            onChange={(e) => lv.setQuery(e.target.value)}
          />
        </label>
        {lv.sorts.length > 0 && (
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
        {pinned.map(chip)}
        {pinned.length > 0 && <span className="lv-sep" aria-hidden />}
        <AddFilter
          lv={lv}
          onPick={(key) => {
            lv.addField(key);
            // Espera o chip existir para abrir a caixa embaixo dele.
            requestAnimationFrame(() => setOpenKey(key));
          }}
        />
        {others.map(chip)}
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
