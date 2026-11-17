import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Skeleton,
  TextField,
  useToast,
} from '../../design-system';
import { dateTime } from '../../features/format';
import { parseCostInput } from '../../features/forms';
import { fmtCost } from '../../features/stock-math';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { CostChange, StockItem, StockUsage } from '../../lib/types';

const SOURCE: Record<CostChange['source'], string> = {
  purchase: 'Entrada',
  receipt: 'Recebimento',
  production: 'Produção',
  manual: 'Mudar preço',
  prep_recipe: 'Ficha de preparo',
};

/** Quanto do preço o custo come (CMV %). */
function cmv(cost: string, price: string): string {
  const p = Number(price);
  if (!(p > 0)) return '—';
  return `${Math.round((Number(cost) / p) * 1000) / 10}%`.replace('.', ',');
}

function Arrow({ from, to, unit }: { from: string; to: string; unit?: string }) {
  const up = Number(to) > Number(from);
  return (
    <span className="st-costdiff" data-up={up || undefined} data-down={!up || undefined}>
      {fmtCost(from)} → <strong>{fmtCost(to)}</strong>
      {unit ? `/${unit}` : ''}
    </span>
  );
}

/** Tabela do que o cardápio sentiu numa mudança de custo. */
function ImpactTable({ products }: { products: CostChange['products'] }) {
  return (
    <div className="st-scroll">
      <table className="cm-table st-table">
        <thead>
          <tr>
            <th>Item do cardápio</th>
            <th className="cm-num">Preço</th>
            <th className="cm-num">Custo da ficha</th>
            <th className="cm-num">Custo no preço</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={`${p.kind}:${p.id}`}>
              <td>
                {p.name}
                {p.kind === 'option' && <div className="cm-hint">Complemento</div>}
              </td>
              <td className="cm-num">{brl(p.price)}</td>
              <td className="cm-num">
                <Arrow from={p.oldCost} to={p.newCost} />
              </td>
              <td className="cm-num">
                {cmv(p.oldCost, p.price)} → <strong>{cmv(p.newCost, p.price)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Histórico do custo automático: cada mudança de custo de insumo e o que foi recalculado sozinho
 * (preparos e itens do cardápio), com o antes e depois.
 */
export function CostChangesCard({ itemId, limit = 15 }: { itemId?: string; limit?: number }) {
  const [rows, setRows] = useState<CostChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (itemId) qs.set('itemId', itemId);
      setRows(await api<CostChange[]>(`/stock/cost-changes?${qs}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [itemId, limit]);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'stock.changed') reload();
  }, load);

  return (
    <Card title="Mudanças de custo" bodyless>
      <p className="cm-hint st-costlog__intro">
        Mudou o custo de um insumo, o sistema recalcula sozinho os preparos e os itens do cardápio
        que o usam. O preço de venda não muda sozinho.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows ? (
        <div className="cm-card__body">
          <Skeleton height={80} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma mudança de custo ainda"
          description="Aparece aqui quando uma entrada, um recebimento, uma produção ou o botão Mudar preço muda o custo de um insumo."
        />
      ) : (
        <ul className="st-costlog">
          {rows.map((c) => {
            const key = c.id ?? c.createdAt;
            const expanded = open === key;
            return (
              <li key={key}>
                <div className="st-costlog__head">
                  <div>
                    <Badge tone="neutral">{SOURCE[c.source]}</Badge>{' '}
                    <span className="cm-hint">
                      {dateTime(c.createdAt)}
                      {c.createdByName ? ` · ${c.createdByName}` : ''}
                      {c.label ? ` · ${c.label}` : ''}
                    </span>
                  </div>
                  {c.products.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpen(expanded ? null : key)}
                    >
                      {expanded ? 'Esconder' : `${c.products.length} item(ns) do cardápio`}
                    </Button>
                  )}
                </div>
                <div className="st-costlog__items">
                  {c.items.map((i) => (
                    <span key={i.id}>
                      <Link to={`/estoque/insumos/${i.id}`}>{i.name}</Link>{' '}
                      <Arrow from={i.oldCost} to={i.newCost} unit={i.unit} />
                    </span>
                  ))}
                </div>
                {expanded && <ImpactTable products={c.products} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Onde o insumo é usado: preparos (em cascata) e itens do cardápio, com o custo de cada ficha. */
export function UsageCard({ item }: { item: StockItem }) {
  const [data, setData] = useState<StockUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<StockUsage>(`/stock/items/${item.id}/usage`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [item.id]);
  useEffect(() => {
    void load();
  }, [load, item.avgCost]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Skeleton height={120} />;
  if (!data.preps.length && !data.menu.length)
    return (
      <Card>
        <EmptyState
          title="Nenhuma ficha usa este insumo"
          description="Coloque o insumo na ficha técnica de um item ou na ficha de preparo para o custo dele entrar no cardápio."
        />
      </Card>
    );
  return (
    <>
      {data.preps.length > 0 && (
        <Card title="Preparos que levam este insumo" bodyless>
          <div className="st-scroll">
            <table className="cm-table st-table">
              <thead>
                <tr>
                  <th>Preparo</th>
                  <th className="cm-num">Custo pela ficha</th>
                </tr>
              </thead>
              <tbody>
                {data.preps.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/estoque/insumos/${p.id}`}>{p.name}</Link>
                    </td>
                    <td className="cm-num">
                      {fmtCost(p.cost)}/{p.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {data.menu.length > 0 && (
        <Card title="Itens do cardápio" bodyless>
          <div className="st-scroll">
            <table className="cm-table st-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="cm-num">Preço</th>
                  <th className="cm-num">Custo da ficha</th>
                  <th className="cm-num">Custo no preço</th>
                </tr>
              </thead>
              <tbody>
                {data.menu.map((m) => (
                  <tr key={`${m.kind}:${m.id}`}>
                    <td>
                      {m.name}
                      {m.kind === 'option' && <div className="cm-hint">Complemento</div>}
                    </td>
                    <td className="cm-num">{brl(m.price)}</td>
                    <td className="cm-num">{fmtCost(m.cost)}</td>
                    <td className="cm-num">{cmv(m.cost, m.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * Mudar preço: o fornecedor aumentou (ou baixou). Mostra antes o impacto em cada preparo e item
 * do cardápio e, ao aplicar, o custo vira o novo valor e tudo é recalculado.
 */
export function CostModal({
  item,
  onClose,
  onDone,
}: {
  item: StockItem;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<CostChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitCost = value ? parseCostInput(value) : null;
  const body = () => ({ unitCost, note: note.trim().length >= 3 ? note.trim() : undefined });

  async function simulate() {
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await api<CostChange>(`/stock/items/${item.id}/cost/preview`, {
          method: 'POST',
          json: body(),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ change: CostChange }>(`/stock/items/${item.id}/cost`, {
        method: 'PUT',
        json: body(),
      });
      const n = r.change.products.length;
      toast(
        n ? `Preço atualizado: ${n} item(ns) do cardápio recalculado(s)` : 'Preço atualizado',
        'success',
      );
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
      title={`Mudar preço · ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {preview ? (
            <Button loading={busy} disabled={!unitCost} onClick={apply}>
              Aplicar novo preço
            </Button>
          ) : (
            <Button loading={busy} disabled={!unitCost} onClick={simulate}>
              Ver impacto
            </Button>
          )}
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="st-preview">
          <div>
            <span>Custo médio hoje</span>
            <strong>
              {fmtCost(item.avgCost)}/{item.unit}
            </strong>
          </div>
          {item.lastCost && (
            <div>
              <span>Último preço pago</span>
              <strong>
                {fmtCost(item.lastCost)}/{item.unit}
              </strong>
            </div>
          )}
          <div data-tone={unitCost ? 'brand' : undefined}>
            <span>Novo preço</span>
            <strong>{unitCost ? `${fmtCost(unitCost)}/${item.unit}` : '—'}</strong>
          </div>
        </div>
        <TextField
          label={`Novo preço por ${item.unit} (R$)`}
          inputMode="decimal"
          placeholder="0,00"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPreview(null);
          }}
          hint="O custo do insumo passa a ser esse valor, sem esperar a próxima compra. O preço de venda não muda sozinho."
          error={value && !unitCost ? 'Valor inválido' : undefined}
        />
        <TextField
          label="Motivo (opcional)"
          placeholder="Ex.: fornecedor aumentou"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
        />
        {preview &&
          (preview.products.length === 0 && preview.items.length <= 1 ? (
            <Alert tone="info">Nenhuma ficha usa este insumo: só o custo dele muda.</Alert>
          ) : (
            <>
              {preview.items.length > 1 && (
                <div className="st-costlog__items">
                  {preview.items
                    .filter((i) => i.id !== item.id)
                    .map((i) => (
                      <span key={i.id}>
                        {i.name} <Arrow from={i.oldCost} to={i.newCost} unit={i.unit} />
                      </span>
                    ))}
                </div>
              )}
              {preview.products.length > 0 && <ImpactTable products={preview.products} />}
            </>
          ))}
      </div>
    </Modal>
  );
}
