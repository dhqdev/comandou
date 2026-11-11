import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Alert } from '../../design-system';
import { useAuth } from '../../app/auth';
import { TourButton } from '../../features/tour/PageTour';
import { api } from '../../lib/api';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { StockFactor, StockItem, StockMovement, StockUnit } from '../../lib/types';

export const UNITS: [StockUnit, string][] = [
  ['un', 'unidade'],
  ['kg', 'quilo'],
  ['g', 'grama'],
  ['l', 'litro'],
  ['ml', 'mililitro'],
];

export const KIND_LABEL: Record<StockMovement['kind'], string> = {
  purchase: 'Entrada',
  adjustment: 'Contagem',
  sale: 'Venda',
  sale_reversal: 'Estorno de venda',
  loss: 'Perda',
  production: 'Produção',
  withdrawal: 'Saída avulsa',
};
export const KIND_TONE: Record<
  StockMovement['kind'],
  'success' | 'info' | 'neutral' | 'danger' | 'warning'
> = {
  purchase: 'success',
  adjustment: 'info',
  sale: 'neutral',
  sale_reversal: 'neutral',
  loss: 'danger',
  production: 'info',
  withdrawal: 'warning',
};

/** Rótulo do movimento ("Inventário" quando a contagem veio de uma sessão de inventário). */
export const kindLabel = (m: StockMovement) => (m.countId ? 'Inventário' : KIND_LABEL[m.kind]);

/** De onde veio o movimento, em texto curto ("Recebimento REC-000003", "Pedido #12"). */
export function originLabel(m: StockMovement) {
  if (m.orderNumber) return `Pedido #${m.orderNumber}`;
  if (m.receiptCode) return `Recebimento ${m.receiptCode}`;
  if (m.productionCode) return `Produção ${m.productionCode}`;
  return m.note ?? '—';
}

/** Insumos do estoque, recarregando sozinho quando alguém mexe no estoque. */
export function useStockItems() {
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems(await api<StockItem[]>('/stock/items'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'stock.changed') reload();
  }, load);
  return { items, error, reload: load };
}

/**
 * As quatro telas do Estoque e as abas de cada uma. Os endereços antigos continuam valendo: cada
 * aba é a seção que antes era um item do menu.
 */
interface StockTab {
  to: string;
  label: string;
  /** A aba também fica acesa nestes endereços (ex.: o cadastro do insumo). */
  under?: string[];
  perms?: string[];
}
export const STOCK_GROUPS: { title: string; tabs: StockTab[] }[] = [
  {
    title: 'Insumos',
    tabs: [
      { to: '/estoque', label: 'Insumos', under: ['/estoque/insumos'] },
      { to: '/estoque/lotes', label: 'Lotes e validade' },
    ],
  },
  {
    title: 'Movimentações',
    tabs: [
      { to: '/estoque/recebimento', label: 'Entrada' },
      { to: '/estoque/saida', label: 'Saída e perdas' },
      { to: '/estoque/producao', label: 'Produção' },
    ],
  },
  {
    title: 'Fichas técnicas',
    tabs: [
      { to: '/estoque/fichas', label: 'Fichas' },
      { to: '/estoque/fatores', label: 'Unidades de compra' },
      {
        to: '/estoque/precificacao',
        label: 'Custo e preço',
        perms: ['stock:write', 'reports:read'],
      },
    ],
  },
  { title: 'Inventário', tabs: [{ to: '/estoque/inventario', label: 'Inventário' }] },
];
const tabOn = (path: string, t: StockTab) =>
  t.to === '/estoque'
    ? path === '/estoque' || path === '/estoque/' || !!t.under?.some((u) => path.startsWith(u))
    : path === t.to || path.startsWith(`${t.to}/`);

/** Abas da tela atual do Estoque (some quando a tela tem uma aba só). */
function StockTabs() {
  const { pathname } = useLocation();
  const perms = useAuth().me?.permissions ?? [];
  const group = STOCK_GROUPS.find((g) => g.tabs.some((t) => tabOn(pathname, t)));
  const tabs = group?.tabs.filter((t) => !t.perms || t.perms.some((p) => perms.includes(p))) ?? [];
  if (tabs.length < 2) return null;
  return (
    <nav className="st-tabs" aria-label={`Abas de ${group!.title}`}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className="st-tabs__item"
          aria-current={tabOn(pathname, t) ? 'page' : undefined}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Cabeçalho de cada seção do Estoque: o nome e, logo embaixo, para que ela serve, em uma ou
 * duas frases. Ações (ex.: "Novo recebimento") ficam à direita.
 */
export function StockHead({
  title,
  children,
  actions,
  error,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  error?: string | null;
}) {
  return (
    <>
      <div className="page-head st-head">
        <div>
          <span className="st-head__eyebrow">Estoque</span>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{children}</p>
        </div>
        <div className="st-head__actions">
          <TourButton tour="estoque" />
          {actions}
        </div>
      </div>
      <StockTabs />
      {error && <Alert tone="danger">{error}</Alert>}
    </>
  );
}

/** Unidade de entrada no recebimento: a própria unidade do insumo, uma vizinha (g↔kg) ou um fator. */
export interface EntryUnit {
  key: string;
  label: string;
  /** Quanto 1 dessa unidade vale na unidade de controle do insumo. */
  factor: string;
}
const NEIGHBOR: Partial<Record<StockUnit, [StockUnit, string]>> = {
  kg: ['g', '0.001'],
  g: ['kg', '1000'],
  l: ['ml', '0.001'],
  ml: ['l', '1000'],
};
export function entryUnits(item: StockItem | undefined, factors: StockFactor[]): EntryUnit[] {
  if (!item) return [];
  const out: EntryUnit[] = [{ key: item.unit, label: item.unit, factor: '1' }];
  const n = NEIGHBOR[item.unit];
  if (n) out.push({ key: n[0], label: n[0], factor: n[1] });
  for (const f of factors) {
    if (f.unit !== item.unit || (f.stockItemId && f.stockItemId !== item.id)) continue;
    // O fator específico do insumo vale mais que o geral de mesma sigla.
    const key = `f:${f.code.toUpperCase()}`;
    const at = out.findIndex((u) => u.key === key);
    const unit = { key, label: f.code, factor: f.factor };
    if (at < 0) out.push(unit);
    else if (f.stockItemId) out[at] = unit;
  }
  return out;
}

/** Dias até a validade (negativo = vencido); null sem validade. */
export function daysToExpiry(expiresOn: string | null, today = new Date()) {
  if (!expiresOn) return null;
  const [y, m, d] = expiresOn.split('-').map(Number) as [number, number, number];
  const end = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - now) / 86400000);
}
