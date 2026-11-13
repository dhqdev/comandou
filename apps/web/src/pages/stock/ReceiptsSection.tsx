import { formatBRL } from '@comandou/shared';
import { ArrowLeft, Plus, Search, Trash2, Truck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Skeleton,
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
import { dateTime } from '../../features/format';
import {
  fmtDate,
  fmtQty,
  parseCostInput,
  parseQtyInput,
  SelectField,
  todayIso,
} from '../../features/forms';
import { fmtCost } from '../../features/stock-math';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { StockFactor, StockReceipt } from '../../lib/types';
import { entryUnits, StockHead, useStockItems } from './common';

const FIELDS: ListField<StockReceipt>[] = [
  {
    key: 'supplier',
    label: 'Fornecedor',
    value: (r) => r.supplier ?? 'Sem fornecedor',
    pinned: true,
  },
  { key: 'received', label: 'Data', kind: 'date', date: (r) => r.receivedOn, pinned: true },
];
const TABS: ListTab[] = [
  { id: 'all', label: 'Todos', filters: {} },
  { id: 'month', label: 'Este mês', filters: { received: ['month'] } },
];
const SORTS: ListSort<StockReceipt>[] = [
  { key: 'date', label: 'Data', get: (r) => `${r.receivedOn} ${r.createdAt}` },
  { key: 'total', label: 'Valor', get: (r) => Number(r.total) },
  { key: 'supplier', label: 'Fornecedor', get: (r) => fold(r.supplier ?? ''), asc: true },
];

/** Recebimentos: a mercadoria que chegou do fornecedor, com nota, itens, custo e validade. */
export function ReceiptsSection() {
  const canWrite = useCan('stock:write');
  const navigate = useNavigate();
  const [rows, setRows] = useState<StockReceipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(await api<StockReceipt[]>('/stock/receipts'));
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
    id: 'estoque-recebimentos',
    rows,
    fields: FIELDS,
    tabs: TABS,
    search: (r) => `${r.code} ${r.supplier ?? ''} ${r.invoice ?? ''} ${r.note ?? ''}`,
    sorts: SORTS,
  });
  const shown = lv.visible ?? [];
  const total = shown.reduce((s, r) => s + Math.round(Number(r.total) * 100), 0);

  return (
    <div className="st-page">
      <StockHead
        title="Movimentações"
        error={error}
        actions={
          canWrite && (
            <Button icon={<Plus size={16} />} onClick={() => navigate('/estoque/recebimento/novo')}>
              Novo recebimento
            </Button>
          )
        }
      >
        Lance a mercadoria que chegou. Cada item entra no estoque e atualiza o custo médio.
      </StockHead>
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar recebimento"
          placeholder="Buscar: código, fornecedor ou nota"
          summary={`${shown.length} ${shown.length === 1 ? 'recebimento' : 'recebimentos'} · ${formatBRL(total)}`}
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Truck size={20} />}
            title="Nenhum recebimento"
            description="Quando a mercadoria chegar, clique em Novo recebimento e lance os itens da nota."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nada por aqui"
            description="Nenhum recebimento com esses filtros."
          />
        ) : (
          <ListTable>
            <table className="cm-table cm-table--click lv-table st-table">
              <thead>
                <tr>
                  <th>Recebimento</th>
                  <th>Data</th>
                  <th>Nota</th>
                  <th className="cm-num">Itens</th>
                  <th className="cm-num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    {...rowClick(
                      () => navigate(`/estoque/recebimento/${r.id}`),
                      `/estoque/recebimento/${r.id}`,
                    )}
                  >
                    <td>
                      <div className="st-name">
                        <Link to={`/estoque/recebimento/${r.id}`} className="st-name__link">
                          {r.supplier ?? 'Sem fornecedor'}
                        </Link>
                        <span className="st-name__meta">
                          <span className="st-code">{r.code}</span>
                          {r.createdByName && ` · ${r.createdByName}`}
                        </span>
                      </div>
                    </td>
                    <td>{fmtDate(r.receivedOn)}</td>
                    <td>{r.invoice ?? '—'}</td>
                    <td className="cm-num">{r.linesCount}</td>
                    <td className="cm-num">{brl(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
    </div>
  );
}

interface Line {
  key: number;
  stockItemId: string;
  quantity: string;
  unitKey: string;
  cost: string;
  expiresOn: string;
  lotCode: string;
}
let lineSeq = 0;
const newLine = (): Line => ({
  key: ++lineSeq,
  stockItemId: '',
  quantity: '',
  unitKey: '',
  cost: '',
  expiresOn: '',
  lotCode: '',
});

/** Lançar um recebimento: cabeçalho da nota e as linhas, com conversão de unidade. */
export function ReceiptForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const canWrite = useCan('stock:write');
  const { items } = useStockItems();
  const [factors, setFactors] = useState<StockFactor[]>([]);
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<StockFactor[]>('/stock/factors')
      .then(setFactors)
      .catch(() => undefined);
  }, []);

  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => {
    const it = byId.get(l.stockItemId);
    const units = entryUnits(it, factors);
    const unit = units.find((u) => u.key === l.unitKey) ?? units[0];
    const q = parseQtyInput(l.quantity);
    const cost = l.cost ? parseCostInput(l.cost) : undefined;
    const base = q && unit ? Number(q) * Number(unit.factor) : 0;
    const total = q && cost ? Math.round(Number(q) * Number(cost) * 100) : 0;
    return { ...l, it, units, unit, q, unitCost: cost, base, total };
  });
  const total = parsed.reduce((s, l) => s + l.total, 0);
  const valid =
    parsed.length > 0 &&
    parsed.every(
      (l) =>
        l.it &&
        l.q &&
        Number(l.q) > 0 &&
        l.unitCost !== null &&
        l.base >= 0.001 &&
        (!l.expiresOn || l.expiresOn >= receivedOn),
    );
  const suppliers = [
    ...new Set((items ?? []).map((i) => i.supplier).filter((s): s is string => !!s)),
  ];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; code: string }>('/stock/receipts', {
        method: 'POST',
        json: {
          supplier: supplier.trim() || null,
          invoice: invoice.trim() || null,
          receivedOn,
          note: note.trim() || null,
          lines: parsed.map((l) => ({
            stockItemId: l.stockItemId,
            quantity: l.q,
            unit: l.unit!.label,
            factor: l.unit!.factor,
            unitCost: l.unitCost ?? undefined,
            expiresOn: l.expiresOn || undefined,
            lotCode: l.lotCode.trim() || undefined,
            madeOn: l.expiresOn || l.lotCode.trim() ? receivedOn : undefined,
          })),
        },
      });
      toast(`Recebimento ${r.code} lançado`, 'success');
      navigate(`/estoque/recebimento/${r.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-page">
      <div className="mn-crumbs">
        <div className="mn-crumbs__path">
          <Link to="/estoque/recebimento" className="mn-crumbs__back">
            <ArrowLeft size={16} aria-hidden /> Recebimento
          </Link>
          <span aria-hidden>/</span>
          <h1>Novo recebimento</h1>
        </div>
        {canWrite && (
          <Button loading={busy} disabled={!valid} onClick={save}>
            Confirmar<span className="st-hide-sm"> recebimento</span>
          </Button>
        )}
      </div>
      <p className="page-sub" style={{ margin: 0 }}>
        Um item por linha, como está na nota. Comprou em caixa ou fardo? Escolha a unidade da compra
        e o sistema converte (cadastre as suas em Fatores de conversão). O custo é por unidade da
        compra.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card title="Nota">
        <div className="cm-form">
          <TextField
            label="Fornecedor"
            value={supplier}
            maxLength={80}
            list="st-rec-suppliers"
            placeholder="Ex.: Distribuidora Sul"
            onChange={(e) => setSupplier(e.target.value)}
          />
          <datalist id="st-rec-suppliers">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <TextField
            label="Nota fiscal (opcional)"
            value={invoice}
            maxLength={60}
            placeholder="Número da NF"
            onChange={(e) => setInvoice(e.target.value)}
          />
          <TextField
            label="Data do recebimento"
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
          <TextField
            label="Observação (opcional)"
            wrapClass="cm-form__wide"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Card>
      <Card title="Itens" bodyless>
        {!items ? (
          <div className="cm-card__body">
            <Skeleton height={80} />
          </div>
        ) : (
          <div className="st-scroll">
            <table className="cm-table st-table st-rec">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Quantidade</th>
                  <th>Unidade</th>
                  <th>Custo por unidade</th>
                  <th>Validade</th>
                  <th>Lote</th>
                  <th className="cm-num">Total</th>
                  <th aria-label="Remover" />
                </tr>
              </thead>
              <tbody>
                {parsed.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <SelectField
                        label="Insumo"
                        value={l.stockItemId}
                        onChange={(e) => set(l.key, { stockItemId: e.target.value, unitKey: '' })}
                      >
                        <option value="">Escolha…</option>
                        {items
                          .filter((i) => i.active)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.unit})
                            </option>
                          ))}
                      </SelectField>
                    </td>
                    <td>
                      <TextField
                        label="Quantidade"
                        inputMode="decimal"
                        value={l.quantity}
                        error={l.quantity && l.q === null ? 'Até 3 casas' : undefined}
                        onChange={(e) => set(l.key, { quantity: e.target.value })}
                      />
                    </td>
                    <td>
                      <SelectField
                        label="Unidade"
                        value={l.unit?.key ?? ''}
                        disabled={!l.it}
                        onChange={(e) => set(l.key, { unitKey: e.target.value })}
                      >
                        {l.units.map((u) => (
                          <option key={u.key} value={u.key}>
                            {u.label}
                            {u.factor !== '1' && l.it
                              ? ` (= ${fmtQty(String(Number(u.factor)))} ${l.it.unit})`
                              : ''}
                          </option>
                        ))}
                      </SelectField>
                      {l.it && l.unit && l.unit.factor !== '1' && l.q && (
                        <span className="cm-hint">
                          entra {fmtQty(l.base.toFixed(3))} {l.it.unit}
                        </span>
                      )}
                    </td>
                    <td>
                      <TextField
                        label={`Custo por ${l.unit?.label ?? 'unidade'} (R$)`}
                        inputMode="decimal"
                        placeholder="0,00"
                        value={l.cost}
                        error={l.cost && l.unitCost === null ? 'Valor inválido' : undefined}
                        onChange={(e) => set(l.key, { cost: e.target.value })}
                      />
                      {l.it && l.unitCost && l.unit && l.unit.factor !== '1' && (
                        <span className="cm-hint">
                          {fmtCost(Number(l.unitCost) / Number(l.unit.factor))}/{l.it.unit}
                        </span>
                      )}
                    </td>
                    <td>
                      <TextField
                        label="Validade"
                        type="date"
                        value={l.expiresOn}
                        error={
                          l.expiresOn && l.expiresOn < receivedOn
                            ? 'Antes do recebimento'
                            : undefined
                        }
                        onChange={(e) => set(l.key, { expiresOn: e.target.value })}
                      />
                    </td>
                    <td>
                      <TextField
                        label="Lote"
                        value={l.lotCode}
                        maxLength={40}
                        placeholder="Opcional"
                        onChange={(e) => set(l.key, { lotCode: e.target.value })}
                      />
                    </td>
                    <td className="cm-num">{l.total ? formatBRL(l.total) : '—'}</td>
                    <td className="cm-num" data-label="">
                      <Button
                        variant="ghost"
                        aria-label="Remover linha"
                        title="Remover linha"
                        icon={<Trash2 size={16} />}
                        disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="st-rec__foot">
          <Button
            variant="secondary"
            icon={<Plus size={16} />}
            onClick={() => setLines((ls) => [...ls, newLine()])}
          >
            Adicionar item
          </Button>
          <span>
            Total da nota <strong>{formatBRL(total)}</strong>
          </span>
        </div>
      </Card>
    </div>
  );
}

/** Um recebimento já lançado (somente leitura: correções são feitas por perda ou contagem). */
export function ReceiptDetail() {
  const { id = '' } = useParams();
  const [r, setR] = useState<StockReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<StockReceipt>(`/stock/receipts/${id}`)
      .then(setR)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  return (
    <div className="st-page">
      <div className="mn-crumbs">
        <div className="mn-crumbs__path">
          <Link to="/estoque/recebimento" className="mn-crumbs__back">
            <ArrowLeft size={16} aria-hidden /> Recebimento
          </Link>
          <span aria-hidden>/</span>
          <h1>{r?.code ?? 'Recebimento'}</h1>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!r ? (
        !error && <Skeleton height={200} />
      ) : (
        <>
          <div className="st-facts">
            <div>
              <span>Fornecedor</span>
              <strong>{r.supplier ?? '—'}</strong>
            </div>
            <div>
              <span>Nota fiscal</span>
              <strong>{r.invoice ?? '—'}</strong>
            </div>
            <div>
              <span>Recebido em</span>
              <strong>{fmtDate(r.receivedOn)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{brl(r.total)}</strong>
            </div>
          </div>
          <p className="cm-hint" style={{ margin: 0 }}>
            Lançado em {dateTime(r.createdAt)}
            {r.createdByName && ` por ${r.createdByName}`}
            {r.note && ` · ${r.note}`}. Para corrigir, registre uma perda ou uma contagem do insumo.
          </p>
          <Card bodyless>
            <div className="st-scroll">
              <table className="cm-table st-table">
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th className="cm-num">Na nota</th>
                    <th className="cm-num">Entrou</th>
                    <th className="cm-num">Custo</th>
                    <th>Lote</th>
                    <th className="cm-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines?.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link to={`/estoque/insumos/${l.stockItemId}`}>{l.itemName}</Link>
                      </td>
                      <td className="cm-num">
                        {fmtQty(l.enteredQuantity)} {l.enteredUnit}
                      </td>
                      <td className="cm-num">
                        {fmtQty(l.quantity)} {l.unit}
                      </td>
                      <td className="cm-num">
                        {l.unitCost ? `${fmtCost(l.unitCost)}/${l.unit}` : '—'}
                      </td>
                      <td>
                        {l.lotCode ?? '—'}
                        {l.expiresOn && <div className="cm-hint">vence {fmtDate(l.expiresOn)}</div>}
                      </td>
                      <td className="cm-num">{l.total ? brl(l.total) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
