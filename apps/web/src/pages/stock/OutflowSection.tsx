import { formatBRL } from '@comandou/shared';
import { PackageMinus, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../../features/list-view';
import { dateTime } from '../../features/format';
import { fmtQty, parseQtyInput, SelectField } from '../../features/forms';
import { milliToQty, toMilli, valueCents } from '../../features/stock-math';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { StockItem, StockMovement } from '../../lib/types';
import { KIND_TONE, kindLabel, originLabel, StockHead, useStockItems } from './common';

/** Motivo da saída, para filtrar: venda, perda, produção, saída avulsa ou contagem para menos. */
const reason = (m: StockMovement) => (m.countId ? 'count' : m.kind);
const FIELDS: ListField<StockMovement>[] = [
  {
    key: 'reason',
    label: 'Motivo',
    value: reason,
    options: [
      { value: 'sale', label: 'Venda' },
      { value: 'loss', label: 'Perda' },
      { value: 'production', label: 'Produção' },
      { value: 'withdrawal', label: 'Saída avulsa' },
      { value: 'adjustment', label: 'Contagem' },
      { value: 'count', label: 'Inventário' },
    ],
    pinned: true,
  },
  { key: 'when', label: 'Data', kind: 'date', date: (m) => m.createdAt, pinned: true },
  { key: 'item', label: 'Insumo', value: (m) => m.itemName },
  { key: 'by', label: 'Quem lançou', value: (m) => m.createdByName ?? 'Sistema' },
];
const TABS: ListTab[] = [
  { id: 'all', label: 'Todas', filters: {} },
  { id: 'sale', label: 'Vendas', filters: { reason: ['sale'] } },
  { id: 'loss', label: 'Perdas', filters: { reason: ['loss'] } },
  { id: 'production', label: 'Produção', filters: { reason: ['production'] } },
  { id: 'withdrawal', label: 'Avulsas', filters: { reason: ['withdrawal'] } },
];
const SORTS: ListSort<StockMovement>[] = [
  { key: 'when', label: 'Data', get: (m) => Number(m.id) },
  { key: 'value', label: 'Valor', get: (m) => -Number(m.value ?? 0) },
  { key: 'item', label: 'Insumo', get: (m) => fold(m.itemName), asc: true },
];

/** Saídas de estoque: tudo o que saiu (vendas, perdas, produção e saídas avulsas). */
export function OutflowSection() {
  const canWrite = useCan('stock:write');
  const { items } = useStockItems();
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    try {
      setRows(await api<StockMovement[]>('/stock/movements?direction=out&limit=1000'));
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
  const lv = useListView({
    id: 'estoque-saidas',
    rows,
    fields: FIELDS,
    tabs: TABS,
    search: (m) => `${m.itemName} ${m.itemCode} ${m.note ?? ''} ${m.orderNumber ?? ''}`,
    sorts: SORTS,
  });
  const shown = lv.visible ?? [];
  const total = shown.reduce((s, m) => s - Math.round(Number(m.value ?? 0) * 100), 0);

  return (
    <div className="st-page">
      <StockHead
        title="Movimentações"
        error={error}
        actions={
          canWrite && (
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Nova saída avulsa
            </Button>
          )
        }
      >
        Tudo o que saiu e por quê: vendas, perdas, produção e saídas avulsas.
      </StockHead>
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar saída"
          placeholder="Buscar: insumo, motivo ou pedido"
          summary={`${shown.length} ${shown.length === 1 ? 'saída' : 'saídas'} · ${formatBRL(total)}`}
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<PackageMinus size={20} />}
            title="Nenhuma saída ainda"
            description="As vendas baixam o estoque sozinhas quando o item tem ficha técnica."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nada por aqui"
            description="Nenhuma saída com esses filtros."
          />
        ) : (
          <ListTable>
            <table className="cm-table lv-table st-table">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Data</th>
                  <th className="cm-num">Quantidade</th>
                  <th className="cm-num">Valor</th>
                  <th>Motivo</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link to={`/estoque/insumos/${m.stockItemId}`} className="st-name__link">
                        {m.itemName}
                      </Link>
                    </td>
                    <td>{dateTime(m.createdAt)}</td>
                    <td className="cm-num">
                      <span className="st-delta" data-neg>
                        {fmtQty(m.quantity.replace('-', ''))} {m.unit}
                      </span>
                    </td>
                    <td className="cm-num">{m.value ? brl(m.value.replace('-', '')) : '—'}</td>
                    <td>
                      <Badge tone={KIND_TONE[m.kind]}>{kindLabel(m)}</Badge>
                    </td>
                    <td>
                      {originLabel(m)}
                      {m.createdByName && <div className="cm-hint">{m.createdByName}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
      {creating && items && (
        <OutflowModal
          items={items}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

const REASONS: { value: string; label: string; kind: 'loss' | 'withdrawal' }[] = [
  { value: 'internal', label: 'Consumo da equipe', kind: 'withdrawal' },
  { value: 'donation', label: 'Doação', kind: 'withdrawal' },
  { value: 'transfer', label: 'Transferência para outra loja', kind: 'withdrawal' },
  { value: 'tasting', label: 'Degustação / cortesia', kind: 'withdrawal' },
  { value: 'loss', label: 'Perda (vencido, estragou, quebrou)', kind: 'loss' },
  { value: 'other', label: 'Outro', kind: 'withdrawal' },
];

function OutflowModal({
  items,
  onClose,
  onDone,
}: {
  items: StockItem[];
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [itemId, setItemId] = useState('');
  const [q, setQ] = useState('');
  const [why, setWhy] = useState('internal');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId);
  const quantity = parseQtyInput(q);
  const r = REASONS.find((x) => x.value === why)!;
  const after = item && quantity ? toMilli(item.quantity) - toMilli(quantity) : null;
  const negative = after !== null && after < 0 && !item!.allowNegative;
  const text = [r.label, note.trim()].filter(Boolean).join(': ');
  const valid =
    !!item &&
    !!quantity &&
    Number(quantity) > 0 &&
    !negative &&
    (why !== 'other' || note.trim().length >= 3);

  async function save() {
    setBusy(true);
    try {
      await api(`/stock/items/${itemId}/movements`, {
        method: 'POST',
        json: { kind: r.kind, quantity, note: text.slice(0, 300) },
      });
      toast('Saída registrada', 'success');
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
      title="Nova saída avulsa"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Registrar saída
          </Button>
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <SelectField label="Insumo" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Escolha…</option>
          {items
            .filter((i) => i.active)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit})
              </option>
            ))}
        </SelectField>
        <TextField
          label={`Quantidade${item ? ` (${item.unit})` : ''}`}
          inputMode="decimal"
          value={q}
          hint={
            item && after !== null
              ? `Fica ${fmtQty(milliToQty(after))} ${item.unit} · ${formatBRL(valueCents(toMilli(quantity!), item.avgCost))}`
              : item
                ? `Tem ${fmtQty(item.quantity)} ${item.unit}`
                : undefined
          }
          error={
            q && quantity === null
              ? 'Use até 3 casas decimais'
              : negative
                ? 'Saldo insuficiente'
                : undefined
          }
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField label="Motivo" value={why} onChange={(e) => setWhy(e.target.value)}>
          {REASONS.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label={why === 'other' ? 'Qual o motivo?' : 'Observação (opcional)'}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
