import { fromCents, toCents } from '@comandou/shared';
import { Boxes, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '../design-system';
import { useCan } from '../app/auth';
import { dateTime } from '../features/format';
import { fmtQty, parseCostInput, parseQtyInput, SelectField, Tabs } from '../features/forms';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Product } from '../lib/api';
import type { MenuGroup, RecipeLine, StockItem, StockMovement, StockUnit } from '../lib/types';

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
type EntryKind = 'purchase' | 'loss' | 'count';
const ENTRY_TITLE: Record<EntryKind, string> = {
  purchase: 'Entrada de mercadoria',
  loss: 'Registrar perda',
  count: 'Contagem (inventário)',
};

/** Estoque por insumo, com ficha técnica que baixa automaticamente a cada venda. */
export function StockPage() {
  const canWrite = useCan('stock:write');
  const [tab, setTab] = useState<'items' | 'recipes' | 'movements'>('items');
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

  const low = items?.filter((i) => i.active && i.low) ?? [];
  return (
    <>
      <div>
        <h1 className="page-title">Estoque</h1>
        <p className="page-sub">
          Insumos, entradas, perdas e contagens. Cada venda baixa os insumos pela ficha técnica.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {low.length > 0 && (
        <Alert tone="warning">
          Abaixo do mínimo:{' '}
          {low.map((i) => `${i.name} (${fmtQty(i.quantity)} ${i.unit})`).join(', ')}
        </Alert>
      )}
      <Tabs<typeof tab>
        value={tab}
        onChange={setTab}
        items={[
          ['items', 'Insumos'],
          ['recipes', 'Ficha técnica'],
          ['movements', 'Movimentos'],
        ]}
      />
      {items === null ? (
        <Spinner />
      ) : tab === 'items' ? (
        <ItemsTab items={items} canWrite={canWrite} onChanged={load} />
      ) : tab === 'recipes' ? (
        <RecipesTab items={items} canWrite={canWrite} />
      ) : (
        <MovementsTab items={items} />
      )}
    </>
  );
}

function ItemsTab({
  items,
  canWrite,
  onChanged,
}: {
  items: StockItem[];
  canWrite: boolean;
  onChanged(): void;
}) {
  const [entry, setEntry] = useState<{ item: StockItem; kind: EntryKind } | null>(null);
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  const total = useMemo(() => items.reduce((s, i) => s + toCents(i.stockValue), 0), [items]);
  return (
    <Card
      title={`Insumos · valor em estoque ${brl(fromCents(total))}`}
      actions={
        canWrite && (
          <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Novo insumo
          </Button>
        )
      }
      bodyless
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<Boxes size={20} />}
          title="Nenhum insumo cadastrado"
          description="Cadastre os insumos (pão, carne, bebidas…) e depois monte a ficha técnica dos produtos."
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="cm-table">
            <thead>
              <tr>
                <th>Insumo</th>
                <th className="cm-num">Saldo</th>
                <th className="cm-num">Mínimo</th>
                <th className="cm-num">Custo médio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong> {!i.active && <Badge>inativo</Badge>}{' '}
                    {i.active && i.low && <Badge tone="warning">baixo</Badge>}{' '}
                    {i.allowNegative && <Badge tone="info">aceita negativo</Badge>}
                  </td>
                  <td className="cm-num">
                    {fmtQty(i.quantity)} {i.unit}
                  </td>
                  <td className="cm-num">
                    {fmtQty(i.minQuantity)} {i.unit}
                  </td>
                  <td className="cm-num">
                    R$ {i.avgCost.replace(/(\.\d\d)\d*$/, '$1').replace('.', ',')}/{i.unit}
                  </td>
                  <td className="cm-num">
                    {canWrite && (
                      <div className="actions-row" style={{ justifyContent: 'end' }}>
                        <Button
                          variant="secondary"
                          onClick={() => setEntry({ item: i, kind: 'purchase' })}
                        >
                          Entrada
                        </Button>
                        <Button variant="ghost" onClick={() => setEntry({ item: i, kind: 'loss' })}>
                          Perda
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setEntry({ item: i, kind: 'count' })}
                        >
                          Contagem
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(i)}>
                          Editar
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
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
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantity = parseQtyInput(q);
  const unitCost = cost ? parseCostInput(cost) : undefined;
  const needsNote = kind !== 'purchase';
  const valid =
    quantity !== null &&
    (kind === 'count' || Number(quantity) > 0) &&
    unitCost !== null &&
    (!needsNote || note.trim().length >= 3);

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
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="cm-hint">
        Saldo atual: {fmtQty(item.quantity)} {item.unit}
      </p>
      <TextField
        label={kind === 'count' ? `Quantidade contada (${item.unit})` : `Quantidade (${item.unit})`}
        inputMode="decimal"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        error={q && quantity === null ? 'Use até 3 casas decimais' : undefined}
      />
      {kind === 'purchase' && (
        <TextField
          label={`Custo por ${item.unit} (opcional)`}
          inputMode="decimal"
          hint="Atualiza o custo médio do insumo"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          error={unitCost === null ? 'Valor inválido' : undefined}
        />
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
              : 'Ex.: NF 1234'
        }
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  );
}

function ItemModal({
  item,
  onClose,
  onDone,
}: {
  item: StockItem | null;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? 'un');
  const [min, setMin] = useState(item ? fmtQty(item.minQuantity) : '0');
  const [allowNegative, setAllowNegative] = useState(item?.allowNegative ?? false);
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minQuantity = parseQtyInput(min);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const json = { name, unit, minQuantity, allowNegative, active };
      if (item) await api(`/stock/items/${item.id}`, { method: 'PATCH', json });
      else await api('/stock/items', { method: 'POST', json });
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
          <Button loading={busy} disabled={!name.trim() || minQuantity === null} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Nome"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <SelectField
        label="Unidade"
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
        onChange={(e) => setMin(e.target.value)}
      />
      <label className="option-row">
        <input
          type="checkbox"
          checked={allowNegative}
          onChange={(e) => setAllowNegative(e.target.checked)}
        />
        Permitir vender sem saldo (estoque negativo)
      </label>
      {item && (
        <label className="option-row">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Ativo
        </label>
      )}
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
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Quanto de cada insumo sai por unidade vendida. Adicionais também podem ter ficha (ex.: bacon
        extra).
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
        <div className="inline-form" style={{ marginTop: 12 }}>
          {lines.length === 0 && <p className="cm-hint">Sem insumos: a venda não baixa estoque.</p>}
          {lines.map((l, idx) => (
            <div key={idx} className="actions-row" style={{ alignItems: 'end' }}>
              <div style={{ flex: '2 1 200px' }}>
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
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <TextField
                  label={`Quantidade${itemById.get(l.stockItemId) ? ` (${itemById.get(l.stockItemId)!.unit})` : ''}`}
                  inputMode="decimal"
                  value={l.quantity}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                >
                  Remover
                </Button>
              )}
            </div>
          ))}
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
    </Card>
  );
}

function MovementsTab({ items }: { items: StockItem[] }) {
  const [itemId, setItemId] = useState('');
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  useEffect(() => {
    setRows(null);
    void api<StockMovement[]>(
      `/stock/movements?limit=200${itemId ? `&itemId=${itemId}` : ''}`,
    ).then(setRows);
  }, [itemId]);
  return (
    <Card title="Movimentos" bodyless>
      <div className="cm-card__body filters">
        <SelectField label="Insumo" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Todos</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </SelectField>
      </div>
      {rows === null ? (
        <div className="cm-card__body">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum movimento" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="cm-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Insumo</th>
                <th>Tipo</th>
                <th className="cm-num">Quantidade</th>
                <th className="cm-num">Saldo</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{dateTime(m.createdAt)}</td>
                  <td>{m.itemName}</td>
                  <td>{KIND_LABEL[m.kind]}</td>
                  <td className="cm-num">
                    {m.quantity.startsWith('-') ? '' : '+'}
                    {fmtQty(m.quantity)} {m.unit}
                  </td>
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
