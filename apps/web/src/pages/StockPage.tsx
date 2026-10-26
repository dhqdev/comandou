import { formatBRL, fromCents, toCents } from '@comandou/shared';
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
  Trash2,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { useCan } from '../app/auth';
import { dateTime } from '../features/format';
import {
  CheckField,
  fmtQty,
  parseCostInput,
  parseQtyInput,
  SelectField,
  Tabs,
} from '../features/forms';
import {
  agoLabel,
  coverageDays,
  daysSince,
  fmtCost,
  milliToQty,
  toMilli,
  unitCostFromTotal,
  valueCents,
} from '../features/stock-math';
import { fmtFactor, fmtPct } from '../features/pricing';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl, parseBrlInput } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Product } from '../lib/api';
import type { MenuGroup, RecipeLine, StockItem, StockMovement, StockUnit } from '../lib/types';
import { InventoryTab } from './StockInventory';
import { PricingTab } from './StockPricing';
import './stock.css';

const UNITS: [StockUnit, string][] = [
  ['un', 'unidade'],
  ['kg', 'quilo'],
  ['g', 'grama'],
  ['l', 'litro'],
  ['ml', 'mililitro'],
];
const KIND_LABEL: Record<StockMovement['kind'], string> = {
  purchase: 'Entrada',
  adjustment: 'Contagem',
  sale: 'Venda',
  sale_reversal: 'Estorno de venda',
  loss: 'Perda',
};
const KIND_TONE: Record<StockMovement['kind'], 'success' | 'info' | 'neutral' | 'danger'> = {
  purchase: 'success',
  adjustment: 'info',
  sale: 'neutral',
  sale_reversal: 'neutral',
  loss: 'danger',
};
type EntryKind = 'purchase' | 'loss' | 'count';
const ENTRY_TITLE: Record<EntryKind, string> = {
  purchase: 'Entrada de mercadoria',
  loss: 'Registrar perda',
  count: 'Contagem',
};
const LOSS_REASONS = [
  'Vencido',
  'Estragado',
  'Quebrado/derramado',
  'Erro de preparo',
  'Consumo da equipe',
];
const COUNT_REASONS = ['Conferência diária', 'Inventário semanal', 'Inventário mensal'];
/** Sem contagem há mais que isso, o insumo aparece como "conferir". */
const COUNT_STALE_DAYS = 30;

type Tab = 'items' | 'count' | 'recipes' | 'pricing' | 'movements';
type View = 'all' | 'low' | 'stale' | 'inactive';

/** Estoque por insumo, com ficha técnica que baixa automaticamente a cada venda. */
export function StockPage() {
  const canWrite = useCan('stock:write');
  const canReports = useCan('reports:read');
  const canPricing = canWrite || canReports;
  const [tab, setTab] = useState<Tab>('items');
  const [view, setView] = useState<View>('all');
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLinkParam('aba', (v) => {
    if (['items', 'count', 'recipes', 'pricing', 'movements'].includes(v)) setTab(v as Tab);
  });

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

  const tabs: [Tab, string][] = [
    ['items', 'Insumos'],
    ['count', 'Inventário'],
    ['recipes', 'Ficha técnica'],
    ...(canPricing ? ([['pricing', 'Precificação']] as [Tab, string][]) : []),
    ['movements', 'Movimentos'],
  ];
  const focus = (v: View) => {
    setTab('items');
    setView(v);
  };

  return (
    <div className="st-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Estoque</h1>
          <p className="page-sub">
            Insumos, entradas, perdas e inventário. Cada venda baixa os insumos pela ficha técnica.
          </p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {items && <StockSummary items={items} onFocus={focus} />}
      <Tabs<Tab> value={tab} onChange={setTab} items={tabs} />
      {items === null ? (
        <Spinner />
      ) : tab === 'items' ? (
        <ItemsTab items={items} canWrite={canWrite} view={view} onView={setView} onChanged={load} />
      ) : tab === 'count' ? (
        <InventoryTab items={items} canWrite={canWrite} onChanged={load} />
      ) : tab === 'recipes' ? (
        <RecipesTab items={items} canWrite={canWrite} />
      ) : tab === 'pricing' ? (
        <PricingTab />
      ) : (
        <MovementsTab items={items} />
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

function ItemsTab({
  items,
  canWrite,
  view,
  onView,
  onChanged,
}: {
  items: StockItem[];
  canWrite: boolean;
  view: View;
  onView(v: View): void;
  onChanged(): void;
}) {
  const [entry, setEntry] = useState<{ item: StockItem; kind: EntryKind } | null>(null);
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  useLinkParam('acao', (a) => a === 'insumo' && canWrite && setEditing('new'));
  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
    [items],
  );
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = items.filter((i) => {
    if (view === 'inactive' ? i.active : !i.active) return false;
    if (view === 'low' && !(i.low || toMilli(i.quantity) <= 0)) return false;
    if (view === 'stale' && i.countedAt && daysSince(i.countedAt) <= COUNT_STALE_DAYS) return false;
    if (category && (i.category ?? '') !== category) return false;
    const q = fold(query.trim());
    return !q || fold(`${i.name} ${i.category ?? ''} ${i.supplier ?? ''}`).includes(q);
  });

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
      <div className="st-toolbar">
        <TextField
          label="Buscar"
          placeholder="Nome, categoria ou fornecedor"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          wrapClass="st-toolbar__search"
        />
        {categories.length > 0 && (
          <SelectField
            label="Categoria"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
        )}
        <div className="cm-field">
          <span className="cm-label">Mostrar</span>
          <Segmented<View>
            label="Filtro de insumos"
            value={view}
            onChange={onView}
            options={[
              { value: 'all', label: 'Ativos' },
              { value: 'low', label: 'Acabando' },
              { value: 'stale', label: 'Conferir' },
              { value: 'inactive', label: 'Inativos' },
            ]}
          />
        </div>
      </div>
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
        <div className="st-scroll">
          <table className="cm-table st-table">
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
                  <tr key={i.id} data-search-id={`insumo-${i.id}`}>
                    <td>
                      <div className="st-name">
                        <strong>{i.name}</strong>
                        <span className="st-name__meta">
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
        </div>
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
          categories={categories}
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

function EntryModal({
  item,
  kind,
  onClose,
  onDone,
}: {
  item: StockItem;
  kind: EntryKind;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [q, setQ] = useState(kind === 'count' ? fmtQty(item.quantity).replace('-', '') : '');
  const [costMode, setCostMode] = useState<'unit' | 'total'>('unit');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantity = parseQtyInput(q);
  const qtyMilli = quantity ? toMilli(quantity) : 0;
  const totalCost = costMode === 'total' && cost ? parseBrlInput(cost) : undefined;
  const unitCost: string | null | undefined = !cost
    ? undefined
    : costMode === 'unit'
      ? parseCostInput(cost)
      : totalCost && qtyMilli > 0
        ? unitCostFromTotal(toCents(totalCost), qtyMilli)
        : null;
  const needsNote = kind !== 'purchase';
  const current = toMilli(item.quantity);
  const after =
    quantity === null
      ? null
      : kind === 'purchase'
        ? current + qtyMilli
        : kind === 'loss'
          ? current - qtyMilli
          : qtyMilli;
  const delta = after === null ? 0 : after - current;
  const goesNegative = after !== null && after < 0 && !item.allowNegative;
  const valid =
    quantity !== null &&
    (kind === 'count' || qtyMilli > 0) &&
    unitCost !== null &&
    !goesNegative &&
    (!needsNote || note.trim().length >= 3);
  // Custo médio ponderado depois da entrada (mesma conta do servidor), só para mostrar.
  const newAvg =
    kind === 'purchase' && unitCost && qtyMilli > 0
      ? (Math.max(current, 0) * Number(item.avgCost) + qtyMilli * Number(unitCost)) /
        (Math.max(current, 0) + qtyMilli)
      : null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/stock/items/${item.id}/movements`, {
        method: 'POST',
        json: { kind, quantity, unitCost: unitCost ?? undefined, note: note.trim() || undefined },
      });
      toast('Estoque atualizado', 'success');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reasons = kind === 'loss' ? LOSS_REASONS : kind === 'count' ? COUNT_REASONS : [];
  return (
    <Modal
      open
      title={`${ENTRY_TITLE[kind]} · ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="st-preview">
          <div>
            <span>Saldo atual</span>
            <strong>
              {fmtQty(item.quantity)} {item.unit}
            </strong>
          </div>
          <div data-tone={after === null ? undefined : goesNegative ? 'danger' : 'brand'}>
            <span>Fica</span>
            <strong>{after === null ? '—' : `${fmtQty(milliToQty(after))} ${item.unit}`}</strong>
          </div>
          {kind === 'purchase' ? (
            <div>
              <span>Custo médio</span>
              <strong>
                {newAvg !== null ? fmtCost(newAvg) : fmtCost(item.avgCost)}/{item.unit}
              </strong>
            </div>
          ) : (
            <div data-tone={delta < 0 ? 'danger' : delta > 0 ? 'success' : undefined}>
              <span>{kind === 'loss' ? 'Valor da perda' : 'Diferença'}</span>
              <strong>
                {kind === 'count' && `${delta > 0 ? '+' : ''}${fmtQty(milliToQty(delta))} · `}
                {formatBRL(valueCents(delta, item.avgCost))}
              </strong>
            </div>
          )}
        </div>
        <TextField
          label={
            kind === 'count' ? `Quantidade contada (${item.unit})` : `Quantidade (${item.unit})`
          }
          inputMode="decimal"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          error={
            q && quantity === null
              ? 'Use até 3 casas decimais'
              : goesNegative
                ? 'Saldo insuficiente para essa perda'
                : undefined
          }
        />
        {kind === 'purchase' && (
          <div className="st-cost">
            <div className="cm-field">
              <span className="cm-label">Custo (opcional)</span>
              <Segmented<'unit' | 'total'>
                label="Como informar o custo"
                value={costMode}
                onChange={(v) => {
                  setCostMode(v);
                  setCost('');
                }}
                options={[
                  { value: 'unit', label: `Por ${item.unit}` },
                  { value: 'total', label: 'Total da nota' },
                ]}
              />
            </div>
            <TextField
              label={costMode === 'unit' ? `Custo por ${item.unit} (R$)` : 'Valor total pago (R$)'}
              inputMode="decimal"
              placeholder="0,00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              hint={
                costMode === 'total' && unitCost
                  ? `Sai a ${fmtCost(unitCost)} por ${item.unit}`
                  : 'Atualiza o custo médio do insumo'
              }
              error={cost && unitCost === null ? 'Valor inválido' : undefined}
            />
          </div>
        )}
        {reasons.length > 0 && (
          <div className="st-chips" role="group" aria-label="Motivos comuns">
            {reasons.map((r) => (
              <button
                key={r}
                type="button"
                className="st-chip"
                aria-pressed={note === r}
                onClick={() => setNote(r)}
              >
                {r}
              </button>
            ))}
          </div>
        )}
        <TextField
          label={needsNote ? 'Motivo' : 'Observação (opcional)'}
          value={note}
          maxLength={300}
          placeholder={
            kind === 'loss'
              ? 'Ex.: vencido, quebrado'
              : kind === 'count'
                ? 'Ex.: inventário semanal'
                : 'Ex.: NF 1234, fornecedor'
          }
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function ItemModal({
  item,
  categories,
  suppliers,
  onClose,
  onDone,
}: {
  item: StockItem | null;
  categories: string[];
  suppliers: string[];
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? 'un');
  const [min, setMin] = useState(item ? fmtQty(item.minQuantity) : '0');
  const [category, setCategory] = useState(item?.category ?? '');
  const [supplier, setSupplier] = useState(item?.supplier ?? '');
  const [initial, setInitial] = useState('');
  const [initialCost, setInitialCost] = useState('');
  const [allowNegative, setAllowNegative] = useState(item?.allowNegative ?? false);
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minQuantity = parseQtyInput(min);
  const initialQty = initial ? parseQtyInput(initial) : undefined;
  const initialUnitCost = initialCost ? parseCostInput(initialCost) : undefined;
  const valid =
    !!name.trim() && minQuantity !== null && initialQty !== null && initialUnitCost !== null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const json = {
        name,
        unit,
        minQuantity,
        allowNegative,
        active,
        category: category.trim() || null,
        supplier: supplier.trim() || null,
      };
      if (item) await api(`/stock/items/${item.id}`, { method: 'PATCH', json });
      else {
        const created = await api<StockItem>('/stock/items', { method: 'POST', json });
        if (initialQty && toMilli(initialQty) > 0) {
          await api(`/stock/items/${created.id}/movements`, {
            method: 'POST',
            json: {
              kind: 'purchase',
              quantity: initialQty,
              unitCost: initialUnitCost ?? undefined,
              note: 'Saldo inicial',
            },
          });
        }
      }
      toast(item ? 'Insumo atualizado' : 'Insumo cadastrado', 'success');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={item ? `Editar ${item.name}` : 'Novo insumo'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="st-grid">
          <TextField
            label="Nome"
            value={name}
            maxLength={80}
            placeholder="Ex.: Queijo muçarela"
            wrapClass="st-grid__full"
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Categoria"
            value={category}
            maxLength={40}
            list="st-categories"
            placeholder="Ex.: Laticínios"
            onChange={(e) => setCategory(e.target.value)}
          />
          <TextField
            label="Fornecedor (opcional)"
            value={supplier}
            maxLength={80}
            list="st-suppliers"
            placeholder="Ex.: Distribuidora Sul"
            onChange={(e) => setSupplier(e.target.value)}
          />
          <SelectField
            label="Unidade de controle"
            value={unit}
            onChange={(e) => setUnit(e.target.value as StockUnit)}
          >
            {UNITS.map(([u, l]) => (
              <option key={u} value={u}>
                {u} ({l})
              </option>
            ))}
          </SelectField>
          <TextField
            label={`Estoque mínimo (${unit})`}
            inputMode="decimal"
            value={min}
            hint="Abaixo disso o insumo aparece em alerta"
            error={minQuantity === null ? 'Use até 3 casas decimais' : undefined}
            onChange={(e) => setMin(e.target.value)}
          />
          {!item && (
            <>
              <TextField
                label={`Saldo inicial (${unit})`}
                inputMode="decimal"
                placeholder="0"
                value={initial}
                error={initialQty === null ? 'Use até 3 casas decimais' : undefined}
                onChange={(e) => setInitial(e.target.value)}
              />
              <TextField
                label={`Custo por ${unit} (R$)`}
                inputMode="decimal"
                placeholder="0,00"
                value={initialCost}
                hint="Base do custo médio e da precificação"
                error={initialUnitCost === null ? 'Valor inválido' : undefined}
                onChange={(e) => setInitialCost(e.target.value)}
              />
            </>
          )}
        </div>
        <datalist id="st-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="st-suppliers">
          {suppliers.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="st-checks">
          <CheckField
            label="Permitir vender sem saldo"
            description="A venda passa mesmo com o estoque zerado (o saldo fica negativo)."
            checked={allowNegative}
            onChange={setAllowNegative}
          />
          {item && (
            <CheckField
              label="Insumo ativo"
              description="Inativo some das listas e da ficha técnica, mas mantém o histórico."
              checked={active}
              onChange={setActive}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

function RecipesTab({ items, canWrite }: { items: StockItem[]; canWrite: boolean }) {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [recipes, setRecipes] = useState<{
    products: (RecipeLine & { productId: string })[];
    options: (RecipeLine & { optionId: string })[];
  } | null>(null);
  const [target, setTarget] = useState('');
  const [lines, setLines] = useState<{ stockItemId: string; quantity: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, g, r] = await Promise.all([
      api<Product[]>('/products'),
      api<MenuGroup[]>('/option-groups').catch(() => []),
      api<typeof recipes>('/stock/recipes'),
    ]);
    setProducts(p);
    setGroups(g);
    setRecipes(r);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [kind, id] = target.split(':') as ['p' | 'o', string];
  useEffect(() => {
    if (!recipes || !target) return;
    const src =
      kind === 'p'
        ? recipes.products.filter((r) => r.productId === id)
        : recipes.options.filter((r) => r.optionId === id);
    setLines(src.map((r) => ({ stockItemId: r.stockItemId, quantity: fmtQty(r.quantity) })));
  }, [recipes, target, kind, id]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const has = (k: 'p' | 'o', x: string) =>
    k === 'p'
      ? recipes?.products.some((r) => r.productId === x)
      : recipes?.options.some((r) => r.optionId === x);
  const parsed = lines.map((l) => ({
    stockItemId: l.stockItemId,
    quantity: parseQtyInput(l.quantity),
  }));
  const valid =
    parsed.every((l) => l.stockItemId && l.quantity && Number(l.quantity) > 0) &&
    new Set(parsed.map((l) => l.stockItemId)).size === parsed.length;
  const lineCost = (l: { stockItemId: string; quantity: string | null }) => {
    const it = itemById.get(l.stockItemId);
    return it && l.quantity ? valueCents(toMilli(l.quantity), it.avgCost) : 0;
  };
  // Custo exato em centavos com fração (o arredondamento fica só na exibição).
  const totalCost = parsed.reduce((s, l) => {
    const it = itemById.get(l.stockItemId);
    return it && l.quantity ? s + (toMilli(l.quantity) / 1000) * Number(it.avgCost) * 100 : s;
  }, 0);
  const priceCents =
    kind === 'p'
      ? toCents(products.find((p) => p.id === id)?.price ?? '0')
      : toCents(groups.flatMap((g) => g.options).find((o) => o.id === id)?.priceDelta ?? '0');

  async function save() {
    setBusy(true);
    try {
      await api(`/stock/recipes/${kind === 'p' ? 'products' : 'options'}/${id}`, {
        method: 'PUT',
        json: { lines: parsed },
      });
      toast('Ficha técnica salva', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (!recipes) return <Spinner />;
  return (
    <Card title="Ficha técnica">
      <div className="cm-form">
        <p className="cm-hint" style={{ margin: 0 }}>
          Quanto de cada insumo sai por unidade vendida. Adicionais também podem ter ficha (ex.:
          bacon extra). O custo usa o custo médio atual de cada insumo.
        </p>
        <SelectField
          label="Produto ou adicional"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Escolha…</option>
          <optgroup label="Produtos">
            {products.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {has('p', p.id) ? '✓ ' : ''}
                {p.name}
              </option>
            ))}
          </optgroup>
          {groups.map((g) => (
            <optgroup key={g.id} label={`Adicionais · ${g.name}`}>
              {g.options.map((o) => (
                <option key={o.id} value={`o:${o.id}`}>
                  {has('o', o.id) ? '✓ ' : ''}
                  {o.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        {target && (
          <div className="st-recipe">
            {lines.length === 0 && (
              <p className="cm-hint" style={{ margin: 0 }}>
                Sem insumos: a venda não baixa estoque e o custo fica desconhecido.
              </p>
            )}
            {lines.length > 0 && (
              <div className="st-recipe__head" aria-hidden>
                <span>Insumo</span>
                <span>Quantidade</span>
                <span className="cm-num">Custo</span>
                <span />
              </div>
            )}
            {lines.map((l, idx) => {
              const it = itemById.get(l.stockItemId);
              return (
                <div key={idx} className="st-recipe__line">
                  <SelectField
                    label="Insumo"
                    value={l.stockItemId}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x, i) => (i === idx ? { ...x, stockItemId: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">Escolha…</option>
                    {items
                      .filter((i) => i.active || i.id === l.stockItemId)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unit})
                        </option>
                      ))}
                  </SelectField>
                  <TextField
                    label={`Quantidade${it ? ` (${it.unit})` : ''}`}
                    inputMode="decimal"
                    value={l.quantity}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)),
                      )
                    }
                  />
                  <div className="st-recipe__cost">
                    <span className="cm-hint">Custo</span>
                    <strong>{formatBRL(lineCost(parsed[idx]!))}</strong>
                    {it && (
                      <span className="cm-hint">
                        {fmtCost(it.avgCost)}/{it.unit}
                      </span>
                    )}
                  </div>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      aria-label="Remover insumo"
                      title="Remover insumo"
                      icon={<Trash2 size={16} />}
                      onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                    />
                  )}
                </div>
              );
            })}
            {lines.length > 0 && (
              <div className="st-preview st-preview--compact">
                <div>
                  <span>{kind === 'p' ? 'Preço de venda' : 'Preço do adicional'}</span>
                  <strong>{formatBRL(priceCents)}</strong>
                </div>
                <div data-tone="brand">
                  <span>Custo da ficha</span>
                  <strong>{formatBRL(totalCost)}</strong>
                </div>
                <div>
                  <span>CMV</span>
                  <strong>{priceCents > 0 ? fmtPct((totalCost / priceCents) * 100) : '—'}</strong>
                </div>
                <div>
                  <span>Markup</span>
                  <strong>{totalCost > 0 ? fmtFactor(priceCents / totalCost) : '—'}</strong>
                </div>
              </div>
            )}
            {canWrite && (
              <div className="actions-row">
                <Button
                  variant="secondary"
                  icon={<Plus size={16} />}
                  onClick={() => setLines((ls) => [...ls, { stockItemId: '', quantity: '' }])}
                >
                  Adicionar insumo
                </Button>
                <Button loading={busy} disabled={!valid} onClick={save}>
                  Salvar ficha
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function MovementsTab({ items }: { items: StockItem[] }) {
  const [itemId, setItemId] = useState('');
  const [kind, setKind] = useState<'' | StockMovement['kind']>('');
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  useEffect(() => {
    setRows(null);
    void api<StockMovement[]>(
      `/stock/movements?limit=300${itemId ? `&itemId=${itemId}` : ''}`,
    ).then(setRows);
  }, [itemId]);
  const shown = rows?.filter((m) => !kind || m.kind === kind) ?? null;
  return (
    <Card title="Movimentos" bodyless>
      <div className="st-toolbar">
        <SelectField label="Insumo" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Todos</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="">Todos</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
      </div>
      {shown === null ? (
        <div className="cm-card__body">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState title="Nenhum movimento" />
      ) : (
        <div className="st-scroll">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Insumo</th>
                <th>Tipo</th>
                <th className="cm-num">Quantidade</th>
                <th className="cm-num">Valor</th>
                <th className="cm-num">Saldo</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td>{dateTime(m.createdAt)}</td>
                  <td>{m.itemName}</td>
                  <td>
                    <Badge tone={KIND_TONE[m.kind]}>
                      {m.countId ? 'Inventário' : KIND_LABEL[m.kind]}
                    </Badge>
                  </td>
                  <td className="cm-num">
                    <span className="st-delta" data-neg={m.quantity.startsWith('-') || undefined}>
                      {m.quantity.startsWith('-') ? '' : '+'}
                      {fmtQty(m.quantity)} {m.unit}
                    </span>
                  </td>
                  <td className="cm-num">{m.value ? brl(m.value) : '—'}</td>
                  <td className="cm-num">
                    {fmtQty(m.balanceAfter)} {m.unit}
                  </td>
                  <td>
                    {m.orderNumber ? `Pedido #${m.orderNumber}` : m.note}
                    {m.createdByName && <div className="cm-hint">{m.createdByName}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
