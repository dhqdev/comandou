import { ROLE_LABELS, type OrderStatus, type Role } from '@comandou/shared';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  ChefHat,
  ClipboardList,
  Clock,
  CornerDownLeft,
  CreditCard,
  ExternalLink,
  FileText,
  Hash,
  KeyRound,
  Layers,
  LayoutGrid,
  ListPlus,
  LogOut,
  MessageCircle,
  Moon,
  Package,
  Printer,
  Receipt,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  User,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  KeyboardEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import { Badge, Spinner } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { CHANNEL_LABELS, ORDER_STATUS_LABELS, STATUS_TONE, dateTime } from './format';
import {
  STATIC_ENTRIES,
  filterStatic,
  scoreEntry,
  type StaticEntry,
  type StaticIcon,
} from './search-catalog';
import './global-search.css';

/** Resultado que vem do servidor (GET /search). */
export interface SearchHit {
  kind:
    | 'order'
    | 'tab'
    | 'table'
    | 'customer'
    | 'product'
    | 'category'
    | 'option'
    | 'stock_item'
    | 'member'
    | 'courier'
    | 'finance_entry'
    | 'cash_register'
    | 'cash_session'
    | 'sector'
    | 'print_agent';
  id: string;
  title: string;
  detail: string | null;
  ref: string | null;
  amount: string | null;
  status: string | null;
  at: string | null;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

/** Para onde cada resultado leva. A tela de destino abre o item ou o destaca. */
export function hitHref(h: SearchHit): string {
  switch (h.kind) {
    case 'order':
      return `/pedidos?abrir=${h.id}`;
    case 'tab':
      return `/mesas?comanda=${h.id}`;
    case 'table':
      return h.ref ? `/mesas?comanda=${h.ref}` : `/mesas?foco=mesa-${h.id}`;
    case 'customer':
      return `/clientes?abrir=${h.id}`;
    case 'product':
      return `/cardapio?categoria=${h.ref}&foco=produto-${h.id}`;
    case 'category':
      return `/cardapio?categoria=${h.id}`;
    case 'option':
      return `/cardapio?foco=grupo-${h.id}`;
    case 'stock_item':
      return `/estoque?foco=insumo-${h.id}`;
    case 'member':
      return `/equipe?foco=membro-${h.id}`;
    case 'courier':
      return `/entregas?foco=entregador-${h.id}`;
    case 'finance_entry':
      return `/financeiro?conta=${h.id}&foco=conta-${h.id}`;
    case 'cash_register':
      return h.ref ? `/caixa?sessao=${h.ref}&foco=sessao-${h.ref}` : `/caixa?foco=caixa-${h.id}`;
    case 'cash_session':
      return `/caixa?sessao=${h.id}&foco=sessao-${h.id}`;
    case 'sector':
      return `/configuracoes?foco=setor-${h.id}`;
    case 'print_agent':
      return `/impressao?foco=agente-${h.id}`;
  }
}

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  order: 'Pedidos',
  tab: 'Comandas',
  table: 'Mesas',
  customer: 'Clientes',
  product: 'Produtos',
  category: 'Categorias',
  option: 'Adicionais',
  stock_item: 'Estoque',
  member: 'Equipe',
  courier: 'Entregadores',
  finance_entry: 'Financeiro',
  cash_register: 'Caixa',
  cash_session: 'Caixa',
  sector: 'Setores de produção',
  print_agent: 'Impressão',
};

const KIND_ICON: Record<SearchHit['kind'], ReactNode> = {
  order: <ClipboardList />,
  tab: <Receipt />,
  table: <LayoutGrid />,
  customer: <User />,
  product: <Package />,
  category: <Layers />,
  option: <ListPlus />,
  stock_item: <Boxes />,
  member: <UserCog />,
  courier: <Truck />,
  finance_entry: <Receipt />,
  cash_register: <Wallet />,
  cash_session: <Wallet />,
  sector: <ChefHat />,
  print_agent: <Printer />,
};

const STATIC_ICON: Record<StaticIcon, ReactNode> = {
  pdv: <Store />,
  orders: <ClipboardList />,
  tables: <LayoutGrid />,
  kitchen: <ChefHat />,
  cash: <Wallet />,
  delivery: <Truck />,
  menu: <BookOpen />,
  store: <Smartphone />,
  customers: <Users />,
  stock: <Boxes />,
  finance: <Receipt />,
  reports: <BarChart3 />,
  team: <UserCog />,
  printing: <Printer />,
  fiscal: <FileText />,
  whatsapp: <MessageCircle />,
  plan: <CreditCard />,
  settings: <Settings />,
  news: <Sparkles />,
  plus: <ListPlus />,
  theme: <Moon />,
  password: <KeyRound />,
  logout: <LogOut />,
  external: <ExternalLink />,
};

const SIMPLE_STATUS: Record<string, [string, Tone]> = {
  'tab:open': ['Aberta', 'success'],
  'tab:closed': ['Fechada', 'neutral'],
  'tab:cancelled': ['Cancelada', 'danger'],
  'table:busy': ['Ocupada', 'brand'],
  'table:free': ['Livre', 'neutral'],
  'customer:blocked': ['Bloqueado', 'danger'],
  'product:sold_out': ['Esgotado', 'danger'],
  'product:inactive': ['Inativo', 'neutral'],
  'category:inactive': ['Inativa', 'neutral'],
  'stock_item:low': ['Baixo', 'warning'],
  'stock_item:inactive': ['Inativo', 'neutral'],
  'member:revoked': ['Desativado', 'danger'],
  'courier:inactive': ['Inativo', 'neutral'],
  'finance_entry:open': ['Em aberto', 'warning'],
  'finance_entry:paid': ['Pago', 'success'],
  'finance_entry:cancelled': ['Cancelado', 'neutral'],
  'cash_register:open': ['Aberto', 'success'],
  'cash_register:closed': ['Fechado', 'neutral'],
  'cash_session:open': ['Aberta', 'success'],
  'cash_session:closed': ['Fechada', 'neutral'],
  'print_agent:inactive': ['Inativo', 'neutral'],
};

function hitStatus(h: SearchHit): [string, Tone] | null {
  if (!h.status) return null;
  if (h.kind === 'order') {
    const s = h.status as OrderStatus;
    return ORDER_STATUS_LABELS[s] ? [ORDER_STATUS_LABELS[s], STATUS_TONE[s]] : null;
  }
  return SIMPLE_STATUS[`${h.kind}:${h.status}`] ?? null;
}

function hitDetail(h: SearchHit): string | null {
  const parts: (string | null)[] = [];
  if (h.kind === 'order') {
    parts.push(
      CHANNEL_LABELS[h.ref as keyof typeof CHANNEL_LABELS] ?? null,
      h.detail,
      h.at ? dateTime(h.at) : null,
    );
  } else if (h.kind === 'member') {
    parts.push(ROLE_LABELS[h.ref as Role] ?? null, h.detail);
  } else if (h.kind === 'finance_entry') {
    parts.push(
      h.detail,
      h.at ? `vence ${new Date(`${h.at}T12:00:00`).toLocaleDateString('pt-BR')}` : null,
    );
  } else if (h.kind === 'cash_session') {
    parts.push(h.detail, h.at ? `aberta ${dateTime(h.at)}` : null);
  } else {
    parts.push(h.detail);
  }
  return parts.filter(Boolean).join(' · ') || null;
}

/** Item mostrado na lista (resultado do servidor, tela, seção ou atalho). */
interface Row {
  key: string;
  group: string;
  icon: ReactNode;
  title: string;
  detail?: string | null;
  amount?: string | null;
  status?: [string, Tone] | null;
  /** Guardado em "Recentes" (só o que leva a algum lugar). */
  recent?: Recent;
  run(): void;
}

interface Recent {
  title: string;
  detail?: string | null;
  to: string;
  icon: string;
}

const RECENT_KEY = 'cm.search.recent';
function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch {
    return [];
  }
}
function pushRecent(r: Recent) {
  try {
    const list = [r, ...readRecent().filter((x) => x.to !== r.to)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Sem armazenamento local (aba anônima etc.): só não lembra os recentes.
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const SEARCH_SHORTCUT = isMac ? '⌘K' : 'Ctrl K';

/** Primeiras telas sugeridas com a busca vazia. */
const QUICK = ['s-pedidos', 's-salao', 's-cardapio', 's-caixa', 's-clientes', 's-relatorios'];

export function GlobalSearch({
  open,
  onClose,
  can,
  onAction,
}: {
  open: boolean;
  onClose(): void;
  can(perms?: string[]): boolean;
  onAction(action: NonNullable<StaticEntry['action']>): void;
}) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitsFor, setHitsFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);

  // Abre já com o foco no campo, antes da próxima tecla (quem digita rápido não perde letra).
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal?.();
      setRecent(readRecent());
      setActive(0);
      // Mantém a última busca, já selecionada: digitar substitui.
      input.current?.select();
    }
    if (!open && d.open) d.close?.();
  }, [open]);

  // Consulta o servidor com uma pequena espera entre teclas; a resposta antiga é descartada.
  const term = query.trim();
  useEffect(() => {
    if (!open) return;
    if (!term) {
      setHits([]);
      setHitsFor('');
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(term)}`, {
        signal: ctrl.signal,
      }).then(
        (r) => {
          setHits(r.results);
          setHitsFor(term);
          setError(null);
          setLoading(false);
        },
        (e: Error) => {
          if (ctrl.signal.aborted) return;
          setError(e.message);
          setLoading(false);
        },
      );
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term, open]);

  function go(to: string, external?: boolean) {
    onClose();
    if (external) window.open(to, '_blank', 'noopener');
    else navigate(to);
  }

  const staticRow = (e: StaticEntry, group: string): Row => ({
    key: e.id,
    group,
    icon: STATIC_ICON[e.icon],
    title: e.title,
    detail: e.hint,
    recent:
      e.to && !e.external ? { title: e.title, detail: e.hint, to: e.to, icon: e.icon } : undefined,
    run: () => {
      if (e.action) {
        onClose();
        onAction(e.action);
      } else if (e.to) go(e.to, e.external);
    },
  });

  const rows = useMemo<Row[]>(() => {
    if (!term) {
      const out: Row[] = recent.map((r, i) => ({
        key: `r-${i}`,
        group: 'Recentes',
        icon: STATIC_ICON[r.icon as StaticIcon] ?? KIND_ICON[r.icon as SearchHit['kind']] ?? (
          <Clock />
        ),
        title: r.title,
        detail: r.detail,
        recent: r,
        run: () => go(r.to),
      }));
      const quick = QUICK.map((id) => STATIC_ENTRIES.find((e) => e.id === id)!).filter((e) =>
        can(e.perms),
      );
      return [...out, ...quick.map((e) => staticRow(e, 'Ir para'))];
    }
    const statics = filterStatic(STATIC_ENTRIES, term, can, 10);
    const strong = statics.filter((e) => scoreEntry(e, term) >= 60).slice(0, 5);
    const weak = statics.filter((e) => !strong.includes(e)).slice(0, 4);
    const server: Row[] = (hitsFor === term ? hits : []).map((h) => {
      const to = hitHref(h);
      const detail = hitDetail(h);
      return {
        key: `${h.kind}-${h.id}-${h.title}`,
        group: KIND_LABEL[h.kind],
        icon: KIND_ICON[h.kind],
        title: h.title,
        detail,
        amount: h.amount,
        status: hitStatus(h),
        recent: { title: h.title, detail, to, icon: h.kind },
        run: () => go(to),
      };
    });
    // Número puro ("123") quase sempre é pedido/comanda: o servidor vem primeiro.
    const numeric = /^#?\d+$/.test(term);
    const first = numeric ? [] : strong.map((e) => staticRow(e, 'Telas e atalhos'));
    const restLabel = first.length || server.length ? 'Mais opções' : 'Telas e atalhos';
    const rest = (numeric ? statics : weak).map((e) => staticRow(e, restLabel));
    return [...first, ...server, ...rest];
  }, [term, hits, hitsFor, recent, can]);

  useEffect(() => setActive(0), [term, hitsFor]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(r: Row | undefined) {
    if (!r) return;
    if (r.recent) pushRecent(r.recent);
    r.run();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === 'Escape') {
      // No campo de busca o Esc do navegador só limparia o texto: aqui ele fecha a busca.
      e.preventDefault();
      onClose();
    }
  }

  const waiting = !!term && (loading || hitsFor !== term);
  let lastGroup = '';
  return (
    <dialog
      ref={dialog}
      className="gsearch"
      aria-label="Buscar no sistema"
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gsearch__box">
        <div className="gsearch__bar">
          <Search size={18} aria-hidden className="gsearch__glass" />
          <input
            ref={input}
            className="gsearch__input"
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
            placeholder="Buscar pedido, mesa, cliente, tela…"
            aria-label="Buscar no sistema"
            aria-controls="gsearch-list"
            aria-activedescendant={rows[active] ? `gsearch-${active}` : undefined}
            role="combobox"
            aria-expanded
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          {waiting && <Spinner label="Buscando" />}
          <button type="button" className="gsearch__close" onClick={onClose} aria-label="Fechar">
            <X size={18} className="gsearch__x" />
            <span className="gsearch__esc">Esc</span>
          </button>
        </div>

        <div className="gsearch__list" id="gsearch-list" role="listbox" ref={list}>
          {rows.map((r, i) => {
            const header = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <div key={r.key} role="presentation">
                {header && <div className="gsearch__group">{r.group}</div>}
                <button
                  type="button"
                  id={`gsearch-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className="gsearch__item"
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => choose(r)}
                >
                  <span className="gsearch__icon" aria-hidden>
                    {r.icon}
                  </span>
                  <span className="gsearch__text">
                    <span className="gsearch__title">{r.title}</span>
                    {r.detail && <span className="gsearch__detail">{r.detail}</span>}
                  </span>
                  {r.status && <Badge tone={r.status[1]}>{r.status[0]}</Badge>}
                  {r.amount && <span className="gsearch__amount">{brl(r.amount)}</span>}
                  <ArrowRight size={16} className="gsearch__go" aria-hidden />
                </button>
              </div>
            );
          })}
          {term && !waiting && rows.length === 0 && (
            <div className="gsearch__empty">
              <Search size={22} aria-hidden />
              <strong>Nada encontrado para “{term}”</strong>
              <span>
                Tente o número do pedido ou da comanda, o nome ou celular do cliente, o nome de um
                produto ou de uma tela.
              </span>
            </div>
          )}
          {error && <div className="gsearch__error">{error}</div>}
        </div>

        <div className="gsearch__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={11} />
            </kbd>{' '}
            abrir
          </span>
          <span>
            <kbd>{SEARCH_SHORTCUT}</kbd> de qualquer tela
          </span>
          <span className="gsearch__tip">
            <Hash size={12} aria-hidden /> número acha pedido e comanda
          </span>
        </div>
      </div>
    </dialog>
  );
}

/** Abre a busca: campo no topo (computador) ou lupa ao lado do tema (celular). */
export function GlobalSearchTrigger({ onOpen, icon }: { onOpen(): void; icon?: boolean }) {
  if (icon) {
    return (
      <button
        type="button"
        className="gsearch-trigger--icon"
        onClick={onOpen}
        aria-label="Buscar no sistema"
      >
        <Search size={20} />
      </button>
    );
  }
  return (
    <button type="button" className="gsearch-trigger" onClick={onOpen} aria-label="Buscar">
      <Search size={16} aria-hidden />
      <span className="gsearch-trigger__text">Buscar mesa, comanda, pedido, cliente, tela…</span>
      <kbd>{SEARCH_SHORTCUT}</kbd>
    </button>
  );
}

/** Ctrl+K / ⌘K de qualquer lugar; "/" fora de campos de texto. */
export function useSearchHotkey(open: () => void) {
  const cb = useRef(open);
  cb.current = open;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        flushSync(() => cb.current());
        return;
      }
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      e.preventDefault();
      flushSync(() => cb.current());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
