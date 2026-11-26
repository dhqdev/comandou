import { ArrowLeft, ClipboardCheck, PackageMinus, PackagePlus, Pencil, Tag } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from '../../design-system';
import { useCan } from '../../app/auth';
import { dateTime } from '../../features/format';
import { fmtDate, fmtQty, Tabs } from '../../features/forms';
import { fmtCost } from '../../features/stock-math';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { StockItem, StockLot, StockMovement } from '../../lib/types';
import { CostChangesCard, CostModal, UsageCard } from './CostChanges';
import { EntryModal, ItemModal, type EntryKind } from './ItemModals';
import { KIND_TONE, kindLabel, originLabel, useStockItems } from './common';
import { ExpiryBadge, LOT_STATUS } from './LotsSection';
import { PrepRecipeCard } from './RecipesSection';

type Tab = 'movements' | 'lots' | 'prep' | 'usage' | 'costs';
const PAGE = 20;

/**
 * Um insumo (como o detalhe do estoque do PedidoJá): saldo e custo no topo e, nas abas, a
 * movimentação, os lotes com validade e a ficha de preparo (se é produzido na casa).
 */
export function ItemDetail() {
  const { id = '' } = useParams();
  const canWrite = useCan('stock:write');
  const canReports = useCan('reports:read');
  const { items } = useStockItems();
  const [item, setItem] = useState<StockItem | null>(null);
  const [moves, setMoves] = useState<StockMovement[] | null>(null);
  const [lots, setLots] = useState<StockLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('movements');
  const [page, setPage] = useState(0);
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const canCosts = canWrite || canReports;

  const load = useCallback(async () => {
    try {
      const [it, mv, lt] = await Promise.all([
        api<StockItem>(`/stock/items/${id}`),
        api<StockMovement[]>(`/stock/movements?itemId=${id}&limit=1000`),
        api<StockLot[]>(`/stock/lots?itemId=${id}`),
      ]);
      setItem(it);
      setMoves(mv);
      setLots(lt);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'stock.changed') reload();
  }, load);

  const shown = moves?.slice(page * PAGE, (page + 1) * PAGE) ?? [];
  const pages = moves ? Math.max(1, Math.ceil(moves.length / PAGE)) : 1;
  const openLots = lots?.filter((l) => l.status === 'available').length ?? 0;

  return (
    <div className="st-page">
      <div className="mn-crumbs">
        <div className="mn-crumbs__path">
          <Link to="/estoque" className="mn-crumbs__back">
            <ArrowLeft size={16} aria-hidden /> Insumos
          </Link>
          <span aria-hidden>/</span>
          <h1>{item?.name ?? 'Insumo'}</h1>
          {item && !item.active && <Badge>inativo</Badge>}
        </div>
        {item && <span className="st-code">{item.code}</span>}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!item ? (
        !error && <Skeleton height={240} />
      ) : (
        <>
          <div className="st-facts">
            <div>
              <span>Estoque</span>
              <strong data-neg={item.quantity.startsWith('-') || undefined}>
                {fmtQty(item.quantity)} {item.unit}
              </strong>
            </div>
            <div>
              <span>Mínimo</span>
              <strong>
                {fmtQty(item.minQuantity)} {item.unit}
              </strong>
            </div>
            <div>
              <span>Custo médio</span>
              <strong>
                {fmtCost(item.avgCost)}/{item.unit}
              </strong>
            </div>
            {item.lastCost && (
              <div>
                <span>Último custo de entrada</span>
                <strong>
                  {fmtCost(item.lastCost)}/{item.unit}
                </strong>
              </div>
            )}
            <div>
              <span>Valor parado</span>
              <strong>{brl(item.stockValue)}</strong>
            </div>
            <div>
              <span>Lotes abertos</span>
              <strong>{openLots}</strong>
            </div>
          </div>
          {canWrite && (
            <div className="st-bar" role="group" aria-label={`Ações de ${item.name}`}>
              <Button
                size="lg"
                variant="secondary"
                icon={<PackagePlus size={18} />}
                onClick={() => setEntry('purchase')}
              >
                Entrada
              </Button>
              <Button
                size="lg"
                variant="secondary"
                icon={<PackageMinus size={18} />}
                onClick={() => setEntry('loss')}
              >
                Perda
              </Button>
              <Button
                size="lg"
                variant="secondary"
                icon={<ClipboardCheck size={18} />}
                onClick={() => setEntry('count')}
              >
                Contar
              </Button>
              {!item.hasPrep && (
                <Button
                  size="lg"
                  variant="secondary"
                  icon={<Tag size={18} />}
                  onClick={() => setPricing(true)}
                >
                  Mudar preço
                </Button>
              )}
              <Button
                size="lg"
                variant="secondary"
                icon={<Pencil size={18} />}
                onClick={() => setEditing(true)}
              >
                Editar
              </Button>
            </div>
          )}
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              ['movements', 'Movimentação'],
              ['lots', `Lotes${lots?.length ? ` (${lots.length})` : ''}`],
              ['prep', 'Ficha de preparo'],
              ...(canCosts
                ? ([
                    ['usage', 'Onde é usado'],
                    ['costs', 'Mudanças de custo'],
                  ] as [Tab, string][])
                : []),
            ]}
          />
          {tab === 'movements' && (
            <Card bodyless>
              {!moves ? (
                <div className="cm-card__body">
                  <Skeleton height={120} />
                </div>
              ) : moves.length === 0 ? (
                <EmptyState title="Nenhuma movimentação registrada" />
              ) : (
                <>
                  <div className="st-scroll">
                    <table className="cm-table st-table">
                      <thead>
                        <tr>
                          <th>Quando</th>
                          <th>Movimento</th>
                          <th className="cm-num">Quantidade</th>
                          <th className="cm-num">Custo</th>
                          <th className="cm-num">Saldo</th>
                          <th>Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((m) => (
                          <tr key={m.id}>
                            <td>{dateTime(m.createdAt)}</td>
                            <td>
                              <Badge tone={KIND_TONE[m.kind]}>{kindLabel(m)}</Badge>
                            </td>
                            <td className="cm-num">
                              <span
                                className="st-delta"
                                data-neg={m.quantity.startsWith('-') || undefined}
                              >
                                {m.quantity.startsWith('-') ? '' : '+'}
                                {fmtQty(m.quantity)} {m.unit}
                              </span>
                            </td>
                            <td className="cm-num">
                              {m.unitCost ? `${fmtCost(m.unitCost)}/${m.unit}` : '—'}
                            </td>
                            <td className="cm-num">
                              {fmtQty(m.balanceAfter)} {m.unit}
                            </td>
                            <td>
                              {m.receiptId ? (
                                <Link to={`/estoque/recebimento/${m.receiptId}`}>
                                  {originLabel(m)}
                                </Link>
                              ) : (
                                originLabel(m)
                              )}
                              {m.lotCode && <div className="cm-hint">Lote {m.lotCode}</div>}
                              {m.createdByName && <div className="cm-hint">{m.createdByName}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="st-pager">
                    <span className="cm-hint">
                      {page * PAGE + 1}–{Math.min((page + 1) * PAGE, moves.length)} de{' '}
                      {moves.length}
                    </span>
                    <div className="st-pager__nav">
                      <Button
                        variant="secondary"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={page >= pages - 1}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Próxima
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}
          {tab === 'lots' && (
            <Card bodyless>
              {!lots || lots.length === 0 ? (
                <EmptyState
                  title="Nenhum lote"
                  description="Lotes nascem no recebimento (com validade) e na produção. Veja todos em Estoque › Lotes e validade."
                />
              ) : (
                <div className="st-scroll">
                  <table className="cm-table st-table">
                    <thead>
                      <tr>
                        <th>Lote</th>
                        <th className="cm-num">Quantidade</th>
                        <th>Fabricação</th>
                        <th>Validade</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lots.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <strong>{l.code}</strong>
                          </td>
                          <td className="cm-num">
                            {fmtQty(l.quantity)} {l.unit}
                          </td>
                          <td>{fmtDate(l.madeOn)}</td>
                          <td>
                            <ExpiryBadge lot={l} />
                          </td>
                          <td>{LOT_STATUS[l.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {tab === 'usage' && canCosts && <UsageCard item={item} />}
          {tab === 'costs' && canCosts && <CostChangesCard itemId={item.id} />}
          {tab === 'prep' && items && (
            <PrepRecipeCard item={item} items={items} canWrite={canWrite} onSaved={load} />
          )}
        </>
      )}
      {item && entry && (
        <EntryModal
          item={item}
          kind={entry}
          onClose={() => setEntry(null)}
          onDone={() => {
            setEntry(null);
            void load();
          }}
        />
      )}
      {item && pricing && (
        <CostModal
          item={item}
          onClose={() => setPricing(false)}
          onDone={() => {
            setPricing(false);
            void load();
          }}
        />
      )}
      {item && editing && (
        <ItemModal
          item={item}
          categories={[
            ...new Set((items ?? []).map((i) => i.category).filter((c): c is string => !!c)),
          ].sort()}
          suppliers={[
            ...new Set((items ?? []).map((i) => i.supplier).filter((c): c is string => !!c)),
          ]}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
