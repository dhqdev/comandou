import { formatBRL, toCents } from '@comandou/shared';
import { ClipboardList, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { useCan } from '../../app/auth';
import {
  fold,
  ListTable,
  rowClick,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../../features/list-view';
import { fmtQty, parseQtyInput, SelectField } from '../../features/forms';
import { fmtFactor, fmtPct } from '../../features/pricing';
import { fmtCost, recipeStock, toMilli, type RecipeStock } from '../../features/stock-math';
import { api, type Product } from '../../lib/api';
import type { MenuGroup, PrepRecipeLine, RecipeLine, StockItem } from '../../lib/types';
import { StockHead, useStockItems } from './common';

type Kind = 'product' | 'option' | 'prep';
const KIND: Record<Kind, string> = {
  product: 'Item do cardápio',
  option: 'Complemento',
  prep: 'Preparo da casa',
};

interface Row {
  key: string;
  kind: Kind;
  id: string;
  name: string;
  group: string;
  /** Preço em centavos (preparo não tem preço). */
  priceCents: number | null;
  lines: RecipeLine[];
  /** Custo da ficha em centavos (com fração). */
  costCents: number;
  /** Preparo: rendimento e unidade. */
  yieldQty?: string;
  unit?: string;
  /** Item vendido por peso (ficha por kg). */
  byWeight?: boolean;
  /** Item vendido (cardápio e complemento): quanto ainda dá para vender e o que falta. */
  stock: RecipeStock | null;
}

/** Item com ficha que não dá para vender mais nenhuma unidade. */
const isOut = (r: Row) => !!r.stock?.missing.length;

/** Custo exato da ficha em centavos (o arredondamento fica só na exibição). */
function costOf(lines: RecipeLine[], byId: Map<string, StockItem>, ratio = 1) {
  return lines.reduce((s, l) => {
    const it = byId.get(l.stockItemId);
    return it ? s + (toMilli(l.quantity) / 1000) * Number(it.avgCost) * 100 * ratio : s;
  }, 0);
}

const FIELDS: ListField<Row>[] = [
  {
    key: 'kind',
    label: 'Tipo',
    value: (r) => r.kind,
    options: Object.entries(KIND).map(([value, label]) => ({ value, label })),
    pinned: true,
  },
  {
    key: 'has',
    label: 'Ficha',
    value: (r) => (r.lines.length ? 'yes' : 'no'),
    options: [
      { value: 'yes', label: 'Com ficha' },
      { value: 'no', label: 'Sem ficha' },
    ],
    pinned: true,
  },
  {
    key: 'stock',
    label: 'Estoque',
    value: (r) => (isOut(r) ? 'out' : 'ok'),
    options: [
      { value: 'out', label: 'Sem estoque' },
      { value: 'ok', label: 'Com estoque' },
    ],
  },
  { key: 'group', label: 'Categoria / grupo', value: (r) => r.group },
];
const TABS: ListTab[] = [
  { id: 'menu', label: 'Cardápio', filters: { kind: ['product'] } },
  { id: 'missing', label: 'Sem ficha', filters: { kind: ['product'], has: ['no'] } },
  { id: 'out', label: 'Sem estoque', filters: { stock: ['out'] } },
  { id: 'options', label: 'Complementos', filters: { kind: ['option'] } },
  { id: 'prep', label: 'Preparos', filters: { kind: ['prep'] } },
];
const SORTS: ListSort<Row>[] = [
  { key: 'name', label: 'Nome', get: (r) => fold(r.name), asc: true },
  { key: 'cost', label: 'Custo', get: (r) => r.costCents },
  {
    key: 'portions',
    label: 'Dá para vender',
    get: (r) => r.stock?.portions ?? Number.MAX_SAFE_INTEGER,
    asc: true,
  },
  {
    key: 'cmv',
    label: 'CMV',
    get: (r) => (r.priceCents ? r.costCents / r.priceCents : 0),
  },
];

/**
 * Fichas técnicas num lugar só: quanto de cada insumo sai por item vendido (cardápio e
 * complementos) e por preparo feito na casa. É o que baixa o estoque e dá o custo.
 */
export function RecipesSection() {
  const canWrite = useCan('stock:write');
  const { items, error } = useStockItems();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [recipes, setRecipes] = useState<{
    products: (RecipeLine & { productId: string })[];
    options: (RecipeLine & { optionId: string })[];
  } | null>(null);
  const [preps, setPreps] = useState<PrepRecipeLine[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [newPrep, setNewPrep] = useState(false);

  const load = useCallback(async () => {
    const [p, g, r, pr] = await Promise.all([
      api<Product[]>('/products'),
      api<MenuGroup[]>('/option-groups').catch(() => []),
      api<NonNullable<typeof recipes>>('/stock/recipes'),
      api<PrepRecipeLine[]>('/stock/item-recipes').catch(() => []),
    ]);
    setProducts(p);
    setGroups(g);
    setRecipes(r);
    setPreps(pr);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const rows = useMemo<Row[] | null>(() => {
    if (!products || !recipes || !items) return null;
    const out: Row[] = [];
    for (const p of products) {
      const lines = recipes.products.filter((r) => r.productId === p.id);
      out.push({
        key: `p:${p.id}`,
        kind: 'product',
        id: p.id,
        name: p.name,
        group: 'Cardápio',
        priceCents: toCents(p.price),
        lines,
        costCents: costOf(lines, byId),
        byWeight: !!p.soldByWeight,
        stock: lines.length ? recipeStock(lines, byId, !!p.soldByWeight) : null,
      });
    }
    for (const g of groups) {
      for (const o of g.options) {
        const lines = recipes.options.filter((r) => r.optionId === o.id);
        out.push({
          key: `o:${o.id}`,
          kind: 'option',
          id: o.id,
          name: o.name,
          group: g.name,
          priceCents: toCents(o.priceDelta),
          lines,
          costCents: costOf(lines, byId),
          stock: lines.length ? recipeStock(lines, byId) : null,
        });
      }
    }
    for (const it of items.filter((i) => i.hasPrep)) {
      const lines = preps.filter((r) => r.itemId === it.id);
      out.push({
        key: `s:${it.id}`,
        kind: 'prep',
        id: it.id,
        name: it.name,
        group: it.category ?? 'Sem categoria',
        priceCents: null,
        lines,
        costCents: costOf(lines, byId),
        yieldQty: it.recipeYield,
        unit: it.unit,
        stock: null,
      });
    }
    return out;
  }, [products, recipes, items, groups, preps, byId]);

  const lv = useListView({
    id: 'estoque-fichas',
    rows,
    fields: FIELDS,
    tabs: TABS,
    search: (r) =>
      `${r.name} ${r.group} ${r.lines.map((l) => byId.get(l.stockItemId)?.name ?? '').join(' ')}`,
    sorts: SORTS,
  });
  const shown = lv.visible ?? [];
  const missing = rows?.filter((r) => r.kind === 'product' && !r.lines.length).length ?? 0;
  const out = rows?.filter((r) => r.kind !== 'prep' && isOut(r)) ?? [];

  return (
    <div className="st-page">
      <StockHead
        title="Fichas técnicas"
        error={error}
        actions={
          canWrite && (
            <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setNewPrep(true)}>
              Ficha de preparo
            </Button>
          )
        }
      >
        Quanto de cada insumo sai por unidade vendida. Quando um insumo acaba, o item sai do
        cardápio até a reposição.
      </StockHead>
      {out.length > 0 && (
        <Alert tone="danger">
          <strong>
            {out.length === 1
              ? `${out[0]!.name} está sem estoque`
              : `${out.length} itens estão sem estoque`}
          </strong>{' '}
          e não dá para vender até dar entrada nos insumos
          {out.length === 1 ? ` (falta ${out[0]!.stock!.missing.join(', ')})` : ''}. No PDV, no
          garçom e no cardápio online eles aparecem como esgotados.{' '}
          {lv.tab?.id !== 'out' && (
            <button
              type="button"
              className="st-linkbtn"
              onClick={() => lv.selectTab(TABS.find((t) => t.id === 'out')!)}
            >
              Ver quais
            </button>
          )}
        </Alert>
      )}
      {missing > 0 && (
        <Alert tone="info">
          {missing} {missing === 1 ? 'item do cardápio está' : 'itens do cardápio estão'} sem ficha:
          a venda deles não baixa estoque e o custo fica desconhecido.
        </Alert>
      )}
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar ficha"
          placeholder="Buscar: item ou insumo usado"
          summary={`${shown.length} ${shown.length === 1 ? 'ficha' : 'fichas'}`}
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={lv.tab?.id === 'prep' ? <ClipboardList size={20} /> : <Search size={20} />}
            title={lv.tab?.id === 'prep' ? 'Nenhum preparo da casa' : 'Nada por aqui'}
            description={
              lv.tab?.id === 'prep'
                ? 'Molho, massa ou recheio feitos na cozinha? Clique em "Ficha de preparo" e diga o que cada um leva.'
                : 'Nenhuma ficha com esses filtros.'
            }
          />
        ) : (
          <ListTable>
            <table className="cm-table cm-table--click lv-table st-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Insumos</th>
                  <th>Dá para vender</th>
                  <th className="cm-num">Custo</th>
                  <th className="cm-num">Preço</th>
                  <th className="cm-num">CMV</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} {...rowClick(() => setEditing(r))}>
                    <td>
                      <div className="st-name">
                        <button
                          type="button"
                          className="st-name__link st-linkbtn"
                          onClick={() => setEditing(r)}
                        >
                          {r.name}
                        </button>
                        <span className="st-name__meta">
                          {KIND[r.kind]}
                          {r.kind !== 'product' && ` · ${r.group}`}
                          {r.byWeight && ' · ficha por 1 kg'}
                          {r.kind === 'prep' &&
                            ` · rende ${fmtQty(r.yieldQty ?? '1')} ${r.unit ?? ''}`}
                        </span>
                      </div>
                    </td>
                    <td>
                      {r.lines.length ? (
                        <span className="st-ingredients">
                          {r.lines
                            .map((l) => byId.get(l.stockItemId)?.name)
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      ) : (
                        <Badge tone="warning">sem ficha</Badge>
                      )}
                    </td>
                    <td>
                      <StockCell row={r} />
                    </td>
                    <td className="cm-num">{r.lines.length ? formatBRL(r.costCents) : '—'}</td>
                    <td className="cm-num">
                      {r.priceCents === null ? '—' : formatBRL(r.priceCents)}
                    </td>
                    <td className="cm-num">
                      {r.priceCents && r.lines.length
                        ? fmtPct((r.costCents / r.priceCents) * 100)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
      {editing && items && (
        <RecipeModal
          row={editing}
          items={items}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {newPrep && items && (
        <PickPrepModal
          items={items.filter((i) => i.active && !i.hasPrep)}
          onClose={() => setNewPrep(false)}
          onPick={(it) => {
            setNewPrep(false);
            setEditing({
              key: `s:${it.id}`,
              kind: 'prep',
              id: it.id,
              name: it.name,
              group: it.category ?? 'Sem categoria',
              priceCents: null,
              lines: [],
              costCents: 0,
              yieldQty: it.recipeYield,
              unit: it.unit,
              stock: null,
            });
          }}
        />
      )}
    </div>
  );
}

/** Quanto ainda dá para vender do item com o estoque de hoje (ou o que falta). */
function StockCell({ row }: { row: Row }) {
  const st = row.stock;
  if (row.kind === 'prep' || !st) return <span className="cm-hint">—</span>;
  if (st.missing.length)
    return (
      <div className="st-name">
        <Badge tone="danger">Sem estoque · não vende</Badge>
        <span className="st-name__meta">Falta {st.missing.join(', ')}</span>
      </div>
    );
  if (st.portions === null)
    return <Badge tone="success">{row.byWeight ? 'Tem estoque' : 'Sem limite'}</Badge>;
  return (
    <Badge tone={st.portions <= LOW_PORTIONS ? 'warning' : 'success'}>
      {st.portions} {st.portions === 1 ? 'unidade' : 'unidades'}
    </Badge>
  );
}

/** Com tão pouco para vender, o item já aparece em amarelo. */
const LOW_PORTIONS = 5;

function PickPrepModal({
  items,
  onClose,
  onPick,
}: {
  items: StockItem[];
  onClose(): void;
  onPick(it: StockItem): void;
}) {
  const [id, setId] = useState('');
  const it = items.find((i) => i.id === id);
  return (
    <Modal
      open
      title="Nova ficha de preparo"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!it} onClick={() => it && onPick(it)}>
            Continuar
          </Button>
        </>
      }
    >
      <div className="cm-form">
        <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
          Preparo é o que a cozinha faz com outros insumos (molho, massa, recheio) e guarda para
          usar depois. Escolha o insumo do preparo; se ainda não existe, cadastre na Visão geral.
        </p>
        <SelectField label="Preparo" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Escolha…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </SelectField>
      </div>
    </Modal>
  );
}

function RecipeModal({
  row,
  items,
  canWrite,
  onClose,
  onSaved,
}: {
  row: Row;
  items: StockItem[];
  canWrite: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRecipeEditor(
    row.lines,
    row.yieldQty ?? '1',
    items,
    row.kind === 'prep' ? row.id : null,
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (row.kind === 'prep') {
        await api(`/stock/items/${row.id}/recipe`, {
          method: 'PUT',
          json: { yield: editor.yieldParsed, lines: editor.parsed },
        });
      } else {
        await api(`/stock/recipes/${row.kind === 'product' ? 'products' : 'options'}/${row.id}`, {
          method: 'PUT',
          json: { lines: editor.parsed },
        });
      }
      toast('Ficha técnica salva', 'success');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Ficha técnica · ${row.name}`}
      onClose={onClose}
      footer={
        canWrite ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={!editor.valid} onClick={save}>
              Salvar ficha
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="cm-hint" style={{ marginTop: 0 }}>
        {row.kind === 'prep'
          ? `Quanto de cada insumo vai na receita e quanto ela rende de ${row.name}. A produção usa isso para baixar os insumos e calcular o custo.`
          : row.byWeight
            ? `Item vendido por peso: a ficha é por 1 kg vendido. Cada venda baixa a ficha × o peso (350 g baixam 0,35 da ficha). O custo usa o custo médio atual de cada insumo.`
            : `Quanto de cada insumo sai por 1 unidade vendida. O custo usa o custo médio atual de cada insumo.`}
        {row.kind === 'product' && (
          <>
            {' '}
            <Link to={`/cardapio/itens/${row.id}`}>Abrir o cadastro do item</Link>
          </>
        )}
      </p>
      <RecipeEditor
        editor={editor}
        canWrite={canWrite}
        priceCents={row.priceCents}
        unit={row.unit}
        byWeight={row.byWeight}
      />
    </Modal>
  );
}

/** Estado do editor de ficha (linhas e rendimento) com o custo calculado. */
function useRecipeEditor(
  initial: RecipeLine[],
  initialYield: string,
  items: StockItem[],
  selfId: string | null,
) {
  const [lines, setLines] = useState(() =>
    initial.map((l) => ({ stockItemId: l.stockItemId, quantity: fmtQty(l.quantity) })),
  );
  const [yieldInput, setYield] = useState(fmtQty(initialYield));
  const byId = new Map(items.map((i) => [i.id, i]));
  const parsed = lines.map((l) => ({
    stockItemId: l.stockItemId,
    quantity: parseQtyInput(l.quantity),
  }));
  const yieldParsed = parseQtyInput(yieldInput);
  const valid =
    parsed.every((l) => l.stockItemId && l.quantity && Number(l.quantity) > 0) &&
    new Set(parsed.map((l) => l.stockItemId)).size === parsed.length &&
    (!selfId || (!!yieldParsed && Number(yieldParsed) > 0));
  const total = parsed.reduce((s, l) => {
    const it = byId.get(l.stockItemId);
    return it && l.quantity ? s + (toMilli(l.quantity) / 1000) * Number(it.avgCost) * 100 : s;
  }, 0);
  return {
    lines,
    setLines,
    yieldInput,
    setYield,
    parsed,
    yieldParsed,
    valid,
    total,
    byId,
    items: items.filter((i) => i.id !== selfId),
    isPrep: !!selfId,
  };
}
type Editor = ReturnType<typeof useRecipeEditor>;

function RecipeEditor({
  editor,
  canWrite,
  priceCents,
  unit,
  byWeight,
}: {
  editor: Editor;
  canWrite: boolean;
  priceCents: number | null;
  unit?: string;
  byWeight?: boolean;
}) {
  const { lines, setLines, parsed, byId, total } = editor;
  // Item vendido: com o estoque de hoje, quantas unidades dá e qual insumo segura.
  const stock = editor.isPrep ? null : recipeStock(parsed, byId, byWeight);
  const perUnit =
    editor.isPrep && editor.yieldParsed && Number(editor.yieldParsed) > 0
      ? total / 100 / Number(editor.yieldParsed)
      : null;
  return (
    <div className="st-recipe">
      {editor.isPrep && (
        <div className="cm-form">
          <TextField
            label={`Rendimento da receita (${unit ?? ''})`}
            inputMode="decimal"
            value={editor.yieldInput}
            disabled={!canWrite}
            hint="Quanto a receita abaixo produz"
            error={editor.yieldInput && editor.yieldParsed === null ? 'Use até 3 casas' : undefined}
            onChange={(e) => editor.setYield(e.target.value)}
          />
        </div>
      )}
      {lines.length === 0 && (
        <p className="cm-hint" style={{ margin: 0 }}>
          Sem insumos: {editor.isPrep ? 'a produção não baixa nada' : 'a venda não baixa estoque'} e
          o custo fica desconhecido.
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
        const it = byId.get(l.stockItemId);
        const p = parsed[idx]!;
        const cost = it && p.quantity ? (toMilli(p.quantity) / 1000) * Number(it.avgCost) * 100 : 0;
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
              {editor.items
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
              <strong>{formatBRL(cost)}</strong>
              {it && (
                <span className="cm-hint">
                  {fmtCost(it.avgCost)}/{it.unit}
                </span>
              )}
              {it && stock && (
                <span
                  className="cm-hint"
                  style={
                    stock.lines.find((x) => x.stockItemId === it.id)?.short
                      ? { color: 'var(--cm-danger)', fontWeight: 600 }
                      : undefined
                  }
                >
                  Tem {fmtQty(it.quantity)} {it.unit}
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
      {stock && stock.lines.length > 0 && (
        <Alert tone={stock.missing.length ? 'danger' : 'info'}>
          {stock.missing.length
            ? `Sem estoque: falta ${stock.missing.join(', ')}. O item não vende até dar entrada.`
            : stock.portions === null
              ? 'Tem estoque para vender.'
              : `Com o estoque de hoje dá para vender ${stock.portions} ${stock.portions === 1 ? 'unidade' : 'unidades'}.`}
        </Alert>
      )}
      {lines.length > 0 && (
        <div className="st-preview st-preview--compact">
          {priceCents !== null && (
            <div>
              <span>Preço de venda</span>
              <strong>{formatBRL(priceCents)}</strong>
            </div>
          )}
          <div data-tone="brand">
            <span>Custo da ficha</span>
            <strong>{formatBRL(total)}</strong>
          </div>
          {priceCents !== null ? (
            <>
              <div>
                <span>CMV</span>
                <strong>{priceCents > 0 ? fmtPct((total / priceCents) * 100) : '—'}</strong>
              </div>
              <div>
                <span>Markup</span>
                <strong>{total > 0 ? fmtFactor(priceCents / total) : '—'}</strong>
              </div>
            </>
          ) : (
            <div>
              <span>Custo por {unit}</span>
              <strong>{perUnit === null ? '—' : fmtCost(perUnit)}</strong>
            </div>
          )}
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
        </div>
      )}
    </div>
  );
}

/** Ficha de preparo de um insumo, na aba do detalhe do insumo. */
export function PrepRecipeCard({
  item,
  items,
  canWrite,
  onSaved,
}: {
  item: StockItem;
  items: StockItem[];
  canWrite: boolean;
  onSaved(): void;
}) {
  const toast = useToast();
  const [lines, setLines] = useState<PrepRecipeLine[] | null>(null);
  useEffect(() => {
    void api<PrepRecipeLine[]>('/stock/item-recipes').then((r) =>
      setLines(r.filter((l) => l.itemId === item.id)),
    );
  }, [item.id]);
  if (!lines) return <Spinner />;
  return (
    <PrepCardBody
      key={lines.length}
      item={item}
      items={items}
      initial={lines}
      canWrite={canWrite}
      onSave={async (yieldQty, parsed) => {
        try {
          await api(`/stock/items/${item.id}/recipe`, {
            method: 'PUT',
            json: { yield: yieldQty, lines: parsed },
          });
          toast('Ficha de preparo salva', 'success');
          onSaved();
        } catch (e) {
          toast((e as Error).message, 'danger');
        }
      }}
    />
  );
}

function PrepCardBody({
  item,
  items,
  initial,
  canWrite,
  onSave,
}: {
  item: StockItem;
  items: StockItem[];
  initial: RecipeLine[];
  canWrite: boolean;
  onSave(
    yieldQty: string | null,
    lines: { stockItemId: string; quantity: string | null }[],
  ): Promise<void>;
}) {
  const editor = useRecipeEditor(initial, item.recipeYield, items, item.id);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Ficha de preparo">
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Se {item.name} é feito na casa, diga o que a receita leva e quanto rende. Aí é só registrar
        em Estoque › Produção: os insumos baixam e o custo de {item.name} é calculado sozinho.
      </p>
      <RecipeEditor editor={editor} canWrite={canWrite} priceCents={null} unit={item.unit} />
      {canWrite && (
        <div className="actions-row" style={{ justifyContent: 'flex-end' }}>
          <Button
            loading={busy}
            disabled={!editor.valid}
            onClick={async () => {
              setBusy(true);
              await onSave(editor.yieldParsed, editor.parsed);
              setBusy(false);
            }}
          >
            Salvar ficha de preparo
          </Button>
        </div>
      )}
    </Card>
  );
}
