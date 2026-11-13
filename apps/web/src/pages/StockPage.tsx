import { fromCents, toCents } from '@comandou/shared';
import {
  AlertTriangle,
  Boxes,
  ClipboardCheck,
  PackageMinus,
  PackagePlus,
  PackageX,
  Pencil,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '../design-system';
import { useCan } from '../app/auth';
import {
  fold,
  ListTable,
  ListToolbar,
  rowClick,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../features/list-view';
import { fmtQty } from '../features/forms';
import { agoLabel, coverageDays, daysSince, fmtCost, toMilli } from '../features/stock-math';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import type { StockItem } from '../lib/types';
import { InventoryTab } from './StockInventory';
import { PricingTab } from './StockPricing';
import { StockHead, useStockItems } from './stock/common';
import { EntryModal, ItemModal, type EntryKind } from './stock/ItemModals';
import { FactorsSection } from './stock/FactorsSection';
import { ItemDetail } from './stock/ItemDetail';
import { LotsSection } from './stock/LotsSection';
import { OutflowSection } from './stock/OutflowSection';
import { ProductionSection } from './stock/ProductionSection';
import { ReceiptDetail, ReceiptForm, ReceiptsSection } from './stock/ReceiptsSection';
import { RecipesSection } from './stock/RecipesSection';
import './stock.css';

/** Sem contagem há mais que isso, o insumo aparece como "conferir". */
const COUNT_STALE_DAYS = 30;

type View = 'all' | 'low' | 'stale' | 'inactive';

/** Endereços antigos (?aba=) que viraram seções próprias. */
const OLD_TABS: Record<string, string> = {
  count: '/estoque/inventario',
  recipes: '/estoque/fichas',
  pricing: '/estoque/precificacao',
  movements: '/estoque/saida',
};

/**
 * Estoque: cada seção é uma tela própria, com o submenu na barra (como o Cardápio).
 * Visão geral (insumos), Lotes, Produção, Recebimento, Saída de estoque, Inventário,
 * Fichas técnicas, Fatores de conversão e Precificação.
 */
export function StockPage() {
  return (
    <Routes>
      <Route path="insumos/:id" element={<ItemDetail />} />
      <Route path="lotes" element={<LotsSection />} />
      <Route path="producao" element={<ProductionSection />} />
      <Route path="recebimento" element={<ReceiptsSection />} />
      <Route path="recebimento/novo" element={<ReceiptForm />} />
      <Route path="recebimento/:id" element={<ReceiptDetail />} />
      <Route path="saida" element={<OutflowSection />} />
      <Route path="inventario" element={<InventorySection />} />
      <Route path="fichas" element={<RecipesSection />} />
      <Route path="fatores" element={<FactorsSection />} />
      <Route path="precificacao" element={<PricingSection />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  );
}

/** Visão geral: saldo, custo e alerta de cada insumo, com entrada, perda e contagem rápidas. */
function Overview() {
  const canWrite = useCan('stock:write');
  const navigate = useNavigate();
  const [view, setView] = useState<View>('all');
  const { items, error, reload } = useStockItems();
  useLinkParam('aba', (v) => {
    const to = OLD_TABS[v];
    if (to) navigate(to, { replace: true });
  });

  return (
    <div className="st-page">
      <StockHead title="Insumos" error={error}>
        Quanto tem de cada insumo e o que está acabando. Clique num insumo para ver o histórico.
      </StockHead>
      {items && <StockSummary items={items} onFocus={setView} />}
      {items === null ? (
        <Spinner />
      ) : (
        <ItemsTab items={items} canWrite={canWrite} view={view} onChanged={reload} />
      )}
    </div>
  );
}

function InventorySection() {
  const canWrite = useCan('stock:write');
  const { items, error, reload } = useStockItems();
  return (
    <div className="st-page">
      <StockHead title="Inventário" error={error}>
        Conte o que tem na prateleira e conclua: o sistema ajusta os saldos.
      </StockHead>
      {items === null ? (
        <Spinner />
      ) : (
        <InventoryTab items={items} canWrite={canWrite} onChanged={reload} />
      )}
    </div>
  );
}

function PricingSection() {
  const canWrite = useCan('stock:write');
  const canReports = useCan('reports:read');
  const canPricing = canWrite || canReports;
  return (
    <div className="st-page">
      <StockHead title="Fichas técnicas">
        Custo de cada item pela ficha, margem e preço sugerido. Nada muda o preço sozinho.
      </StockHead>
      {canPricing ? (
        <PricingTab />
      ) : (
        <Alert tone="info">Sua função não tem acesso aos custos e margens.</Alert>
      )}
    </div>
  );
}

/** Números do topo: valor parado, o que está acabando e o que precisa ser conferido. */
function StockSummary({ items, onFocus }: { items: StockItem[]; onFocus(v: View): void }) {
  const active = items.filter((i) => i.active);
  const total = active.reduce((s, i) => s + toCents(i.stockValue), 0);
  const low = active.filter((i) => i.low);
  const empty = active.filter((i) => toMilli(i.quantity) <= 0);
  const stale = active.filter((i) => !i.countedAt || daysSince(i.countedAt) > COUNT_STALE_DAYS);
  return (
    <div className="st-kpis">
      <div className="st-kpi">
        <span className="st-kpi__icon">
          <Wallet size={18} />
        </span>
        <span className="st-kpi__label">Valor em estoque</span>
        <strong className="st-kpi__value">{brl(fromCents(total))}</strong>
        <span className="st-kpi__hint">{active.length} insumos ativos</span>
      </div>
      <button
        type="button"
        className="st-kpi"
        data-tone={low.length ? 'warning' : undefined}
        onClick={() => onFocus('low')}
      >
        <span className="st-kpi__icon">
          <AlertTriangle size={18} />
        </span>
        <span className="st-kpi__label">Abaixo do mínimo</span>
        <strong className="st-kpi__value">{low.length}</strong>
        <span className="st-kpi__hint">
          {low.length
            ? low
                .slice(0, 3)
                .map((i) => i.name)
                .join(', ') + (low.length > 3 ? '…' : '')
            : 'Tudo acima do mínimo'}
        </span>
      </button>
      <button
        type="button"
        className="st-kpi"
        data-tone={empty.length ? 'danger' : undefined}
        onClick={() => onFocus('low')}
      >
        <span className="st-kpi__icon">
          <PackageX size={18} />
        </span>
        <span className="st-kpi__label">Zerados ou negativos</span>
        <strong className="st-kpi__value">{empty.length}</strong>
        <span className="st-kpi__hint">
          {empty.length ? 'Registre a entrada ou confira' : 'Nenhum insumo zerado'}
        </span>
      </button>
      <button
        type="button"
        className="st-kpi"
        data-tone={stale.length ? 'info' : undefined}
        onClick={() => onFocus('stale')}
      >
        <span className="st-kpi__icon">
          <ClipboardCheck size={18} />
        </span>
        <span className="st-kpi__label">Para conferir</span>
        <strong className="st-kpi__value">{stale.length}</strong>
        <span className="st-kpi__hint">Sem contagem há mais de {COUNT_STALE_DAYS} dias</span>
      </button>
    </div>
  );
}

/** Barra do saldo em relação ao mínimo (cheia = o dobro do mínimo). */
function LevelBar({ item }: { item: StockItem }) {
  const q = toMilli(item.quantity);
  const min = toMilli(item.minQuantity);
  if (min <= 0) return null;
  const ratio = Math.max(0, Math.min(1, q / (min * 2)));
  const tone = q < min ? 'danger' : q < min * 1.5 ? 'warning' : 'success';
  return (
    <span className="st-level" data-tone={tone} aria-hidden>
      <span style={{ width: `${Math.max(ratio * 100, q > 0 ? 4 : 0)}%` }} />
    </span>
  );
}

const stale = (i: StockItem) => !i.countedAt || daysSince(i.countedAt) > COUNT_STALE_DAYS;
const level = (i: StockItem) => (toMilli(i.quantity) <= 0 ? 'empty' : i.low ? 'low' : 'ok');

const STOCK_FIELDS: ListField<StockItem>[] = [
  {
    key: 'category',
    label: 'Categoria',
    value: (i) => i.category ?? 'Sem categoria',
    pinned: true,
  },
  {
    key: 'supplier',
    label: 'Fornecedor',
    value: (i) => i.supplier ?? 'Sem fornecedor',
    pinned: true,
  },
  {
    key: 'level',
    label: 'Saldo',
    value: level,
    options: [
      { value: 'ok', label: 'Acima do mínimo' },
      { value: 'low', label: 'Abaixo do mínimo' },
      { value: 'empty', label: 'Zerado ou negativo' },
    ],
  },
  {
    key: 'count',
    label: 'Contagem',
    value: (i) => (stale(i) ? 'stale' : 'ok'),
    options: [
      { value: 'ok', label: `Contado nos últimos ${COUNT_STALE_DAYS} dias` },
      { value: 'stale', label: 'Precisa conferir' },
    ],
  },
  {
    key: 'active',
    label: 'Situação',
    value: (i) => (i.active ? 'yes' : 'no'),
    options: [
      { value: 'yes', label: 'Ativo' },
      { value: 'no', label: 'Inativo' },
    ],
  },
  { key: 'unit', label: 'Unidade', value: (i) => i.unit },
];

const STOCK_TABS: ListTab[] = [
  { id: 'all', label: 'Ativos', filters: { active: ['yes'] } },
  { id: 'low', label: 'Acabando', filters: { active: ['yes'], level: ['low', 'empty'] } },
  { id: 'stale', label: 'Conferir', filters: { active: ['yes'], count: ['stale'] } },
  { id: 'inactive', label: 'Inativos', filters: { active: ['no'] } },
];

const STOCK_SORTS: ListSort<StockItem>[] = [
  { key: 'name', label: 'Nome', get: (i) => fold(i.name), asc: true },
  { key: 'value', label: 'Valor em estoque', get: (i) => Number(i.stockValue) },
  {
    key: 'days',
    label: 'Dura (dias)',
    get: (i) => coverageDays(i.quantity, i.dailyUsage) ?? 99999,
    asc: true,
  },
  { key: 'counted', label: 'Última contagem', get: (i) => i.countedAt ?? '', asc: true },
];

function ItemsTab({
  items,
  canWrite,
  view,
  onChanged,
}: {
  items: StockItem[];
  canWrite: boolean;
  view: View;
  onChanged(): void;
}) {
  const navigate = useNavigate();
  const [entry, setEntry] = useState<{ item: StockItem; kind: EntryKind } | null>(null);
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  useLinkParam('acao', (a) => a === 'insumo' && canWrite && setEditing('new'));
  const lv = useListView({
    id: 'estoque-insumos',
    rows: items,
    fields: STOCK_FIELDS,
    tabs: STOCK_TABS,
    search: (i) => `${i.code} ${i.barcode ?? ''} ${i.name} ${i.category ?? ''} ${i.supplier ?? ''}`,
    sorts: STOCK_SORTS,
  });
  // Cartões do topo (Abaixo do mínimo, Para conferir) abrem a aba certa.
  const first = useRef(true);
  const { selectTab } = lv;
  useEffect(() => {
    const skip = first.current && view === 'all';
    first.current = false;
    if (skip) return;
    const t = STOCK_TABS.find((x) => x.id === view);
    if (t) selectTab(t);
  }, [view]);
  const shown = lv.visible ?? [];

  return (
    <Card
      title="Insumos"
      actions={
        canWrite && (
          <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Novo insumo
          </Button>
        )
      }
      bodyless
    >
      <ListToolbar
        lv={lv}
        searchLabel="Buscar insumo"
        placeholder="Buscar: nome, código, categoria ou fornecedor"
        summary={`${shown.length} ${shown.length === 1 ? 'insumo' : 'insumos'}`}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<Boxes size={20} />}
          title="Nenhum insumo cadastrado"
          description="Cadastre os insumos (pão, carne, bebidas…) e depois monte a ficha técnica dos produtos."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Search size={20} />}
          title="Nada por aqui"
          description="Nenhum insumo com esses filtros."
        />
      ) : (
        <ListTable>
          <table className="cm-table cm-table--click lv-table st-table">
            <thead>
              <tr>
                <th>Insumo</th>
                <th className="cm-num">Saldo</th>
                <th className="cm-num">Mínimo</th>
                <th className="cm-num">Custo médio</th>
                <th className="cm-num">Valor</th>
                <th className="cm-num">Dura</th>
                {canWrite && <th className="cm-num">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const days = coverageDays(i.quantity, i.dailyUsage);
                const neg = toMilli(i.quantity) < 0;
                return (
                  <tr
                    key={i.id}
                    data-search-id={`insumo-${i.id}`}
                    {...rowClick(
                      () => navigate(`/estoque/insumos/${i.id}`),
                      `/estoque/insumos/${i.id}`,
                    )}
                  >
                    <td>
                      <div className="st-name">
                        <Link to={`/estoque/insumos/${i.id}`} className="st-name__link">
                          {i.name}
                        </Link>
                        <span className="st-name__meta">
                          <span className="st-code">{i.code}</span>
                          {' · '}
                          {[i.category, i.supplier].filter(Boolean).join(' · ') || 'Sem categoria'}
                          {' · '}contado {agoLabel(i.countedAt)}
                        </span>
                        <span className="st-name__badges">
                          {!i.active && <Badge>inativo</Badge>}
                          {i.active && neg && <Badge tone="danger">negativo</Badge>}
                          {i.active && !neg && i.low && (
                            <Badge tone="warning">abaixo do mínimo</Badge>
                          )}
                          {i.allowNegative && <Badge tone="info">aceita negativo</Badge>}
                          {i.hasPrep && <Badge tone="brand">produzido na casa</Badge>}
                        </span>
                      </div>
                    </td>
                    <td className="cm-num">
                      <div className="st-qty">
                        <strong data-neg={neg || undefined}>
                          {fmtQty(i.quantity)} {i.unit}
                        </strong>
                        <LevelBar item={i} />
                      </div>
                    </td>
                    <td className="cm-num">
                      {fmtQty(i.minQuantity)} {i.unit}
                    </td>
                    <td className="cm-num">
                      {fmtCost(i.avgCost)}/{i.unit}
                    </td>
                    <td className="cm-num">{brl(i.stockValue)}</td>
                    <td className="cm-num">
                      {days === null ? (
                        <span className="cm-hint">—</span>
                      ) : (
                        <span
                          className="st-days"
                          data-tone={days <= 3 ? 'danger' : days <= 7 ? 'warning' : undefined}
                        >
                          {days === 0 ? 'acabou' : `~${days} ${days === 1 ? 'dia' : 'dias'}`}
                        </span>
                      )}
                    </td>
                    {canWrite && (
                      <td className="cm-num" data-label="">
                        <div className="st-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<PackagePlus size={15} />}
                            onClick={() => setEntry({ item: i, kind: 'purchase' })}
                          >
                            Entrada
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<PackageMinus size={15} />}
                            onClick={() => setEntry({ item: i, kind: 'loss' })}
                          >
                            Perda
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<ClipboardCheck size={15} />}
                            onClick={() => setEntry({ item: i, kind: 'count' })}
                          >
                            Contar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil size={15} />}
                            onClick={() => setEditing(i)}
                          >
                            Editar
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListTable>
      )}
      {entry && (
        <EntryModal
          item={entry.item}
          kind={entry.kind}
          onClose={() => setEntry(null)}
          onDone={() => {
            setEntry(null);
            onChanged();
          }}
        />
      )}
      {editing && (
        <ItemModal
          item={editing === 'new' ? null : editing}
          categories={[
            ...new Set(items.map((i) => i.category).filter((c): c is string => !!c)),
          ].sort()}
          suppliers={[...new Set(items.map((i) => i.supplier).filter((s): s is string => !!s))]}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
