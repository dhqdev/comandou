import { CheckCheck, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
  Skeleton,
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
import { fmtDate, fmtQty, parseQtyInput, SelectField, todayIso } from '../../features/forms';
import { api } from '../../lib/api';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { StockItem, StockLot, StockLotStatus } from '../../lib/types';
import { daysToExpiry, StockHead, useStockItems } from './common';

/** Quantos dias antes da validade o lote aparece como "vencendo". */
const SOON_DAYS = 3;

export const LOT_STATUS: Record<StockLotStatus, string> = {
  available: 'Disponível',
  used: 'Usado',
  discarded: 'Descartado',
};
const ORIGIN: Record<StockLot['origin'], string> = {
  receipt: 'Recebimento',
  production: 'Produção',
  manual: 'Manual',
};

const expiry = (l: StockLot) => {
  const d = daysToExpiry(l.expiresOn);
  return d === null ? 'none' : d < 0 ? 'expired' : d <= SOON_DAYS ? 'soon' : 'ok';
};

/** Validade com o aviso: vencida, vence hoje, vence em N dias. */
export function ExpiryBadge({ lot }: { lot: StockLot }) {
  if (!lot.expiresOn) return <span className="cm-hint">sem validade</span>;
  const d = daysToExpiry(lot.expiresOn)!;
  const open = lot.status === 'available';
  return (
    <span className="st-expiry">
      {fmtDate(lot.expiresOn)}
      {open && d < 0 && <Badge tone="danger">vencida</Badge>}
      {open && d === 0 && <Badge tone="warning">vence hoje</Badge>}
      {open && d > 0 && d <= SOON_DAYS && (
        <Badge tone="warning">{d === 1 ? 'vence amanhã' : `vence em ${d} dias`}</Badge>
      )}
    </span>
  );
}

const FIELDS: ListField<StockLot>[] = [
  {
    key: 'status',
    label: 'Status',
    value: (l) => l.status,
    options: Object.entries(LOT_STATUS).map(([value, label]) => ({ value, label })),
    pinned: true,
  },
  {
    key: 'expiry',
    label: 'Validade',
    value: expiry,
    options: [
      { value: 'expired', label: 'Vencida' },
      { value: 'soon', label: `Vence em até ${SOON_DAYS} dias` },
      { value: 'ok', label: 'No prazo' },
      { value: 'none', label: 'Sem validade' },
    ],
    pinned: true,
  },
  { key: 'item', label: 'Insumo', value: (l) => l.itemName },
  {
    key: 'origin',
    label: 'Origem',
    value: (l) => l.origin,
    options: Object.entries(ORIGIN).map(([value, label]) => ({ value, label })),
  },
  { key: 'made', label: 'Fabricação', kind: 'date', date: (l) => l.madeOn },
];
const TABS: ListTab[] = [
  { id: 'open', label: 'Disponíveis', filters: { status: ['available'] } },
  { id: 'soon', label: 'Vencendo', filters: { status: ['available'], expiry: ['soon'] } },
  { id: 'expired', label: 'Vencidos', filters: { status: ['available'], expiry: ['expired'] } },
  { id: 'all', label: 'Todos', filters: {} },
];
const SORTS: ListSort<StockLot>[] = [
  { key: 'expires', label: 'Validade', get: (l) => l.expiresOn ?? '9999', asc: true },
  { key: 'made', label: 'Fabricação', get: (l) => l.madeOn },
  { key: 'item', label: 'Insumo', get: (l) => fold(l.itemName), asc: true },
];

/** Lotes: o que entrou com fabricação e validade, para usar primeiro o que vence primeiro. */
export function LotsSection() {
  const navigate = useNavigate();
  const canWrite = useCan('stock:write');
  const toast = useToast();
  const { items } = useStockItems();
  const [lots, setLots] = useState<StockLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [discard, setDiscard] = useState<StockLot | null>(null);

  const load = useCallback(async () => {
    try {
      setLots(await api<StockLot[]>('/stock/lots'));
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
    id: 'estoque-lotes',
    rows: lots,
    fields: FIELDS,
    tabs: TABS,
    search: (l) => `${l.code} ${l.itemName} ${l.itemCode} ${l.receiptCode ?? ''}`,
    sorts: SORTS,
  });
  const shown = lv.visible ?? [];

  async function markUsed(l: StockLot) {
    try {
      await api(`/stock/lots/${l.id}/close`, { method: 'POST', json: { status: 'used' } });
      toast(`Lote ${l.code} marcado como usado`, 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="st-page">
      <StockHead
        title="Insumos"
        error={error}
        actions={
          canWrite && (
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Novo lote
            </Button>
          )
        }
      >
        Levas com validade. Use primeiro o que vence primeiro e descarte aqui o que venceu.
      </StockHead>
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar lote"
          searchHint="lote, insumo ou recebimento"
          summary={`${shown.length} ${shown.length === 1 ? 'lote' : 'lotes'}`}
        />
        {lots === null ? (
          <div className="cm-card__body">
            <Skeleton variant="table" />
          </div>
        ) : lots.length === 0 ? (
          <EmptyState
            icon={<Tags size={20} />}
            title="Nenhum lote ainda"
            description="Informe a validade no recebimento ou registre uma produção: o lote aparece aqui."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nada por aqui"
            description="Nenhum lote com esses filtros."
          />
        ) : (
          <ListTable>
            <table className="cm-table cm-table--click lv-table st-table">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Lote</th>
                  <th className="cm-num">Quantidade</th>
                  <th>Fabricação</th>
                  <th>Validade</th>
                  <th>Status</th>
                  {canWrite && <th className="cm-num">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr
                    key={l.id}
                    {...rowClick(
                      () => navigate(`/estoque/insumos/${l.stockItemId}`),
                      `/estoque/insumos/${l.stockItemId}`,
                    )}
                  >
                    <td>
                      <div className="st-name">
                        <Link to={`/estoque/insumos/${l.stockItemId}`} className="st-name__link">
                          {l.itemName}
                        </Link>
                        <span className="st-name__meta">
                          {ORIGIN[l.origin]}
                          {l.receiptCode && ` · ${l.receiptCode}`}
                          {l.productionCode && ` · ${l.productionCode}`}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="st-code">{l.code}</span>
                    </td>
                    <td className="cm-num">
                      {fmtQty(l.quantity)} {l.unit}
                    </td>
                    <td>{fmtDate(l.madeOn)}</td>
                    <td>
                      <ExpiryBadge lot={l} />
                    </td>
                    <td>
                      {LOT_STATUS[l.status]}
                      {l.note && <div className="cm-hint">{l.note}</div>}
                    </td>
                    {canWrite && (
                      <td className="cm-num" data-label="">
                        {l.status === 'available' && (
                          <div className="st-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<CheckCheck size={15} />}
                              onClick={() => markUsed(l)}
                            >
                              Usado
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<Trash2 size={15} />}
                              onClick={() => setDiscard(l)}
                            >
                              Descartar
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
      {creating && items && (
        <LotModal
          items={items}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
      {discard && (
        <DiscardModal
          lot={discard}
          onClose={() => setDiscard(null)}
          onDone={() => {
            setDiscard(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DiscardModal({
  lot,
  onClose,
  onDone,
}: {
  lot: StockLot;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [note, setNote] = useState(daysToExpiry(lot.expiresOn)! < 0 ? 'Vencido' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      await api(`/stock/lots/${lot.id}/close`, {
        method: 'POST',
        json: { status: 'discarded', note: note.trim() },
      });
      toast(`Lote ${lot.code} descartado`, 'success');
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
      title={`Descartar lote ${lot.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} disabled={note.trim().length < 3} onClick={save}>
            Descartar
          </Button>
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="cm-hint" style={{ margin: 0 }}>
          Registra a perda de {fmtQty(lot.quantity)} {lot.unit} de {lot.itemName} (até o saldo que o
          insumo tem) e fecha o lote.
        </p>
        <TextField
          label="Motivo"
          autoFocus
          value={note}
          maxLength={300}
          placeholder="Ex.: vencido, estragou"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function LotModal({
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
  const [code, setCode] = useState('');
  const [made, setMade] = useState(todayIso());
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId);
  const quantity = parseQtyInput(q);
  const badDates = !!expires && expires < made;
  const valid = !!item && !!quantity && Number(quantity) > 0 && !!made && !badDates;

  async function save() {
    setBusy(true);
    try {
      await api('/stock/lots', {
        method: 'POST',
        json: {
          stockItemId: itemId,
          quantity,
          code: code.trim() || undefined,
          madeOn: made,
          expiresOn: expires || undefined,
        },
      });
      toast('Lote registrado', 'success');
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
      title="Novo lote"
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
        <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
          Para etiquetar o que já está no estoque. Não muda o saldo: entrada de mercadoria nova é
          pelo Recebimento e preparo feito na casa, pela Produção.
        </p>
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
          error={q && quantity === null ? 'Use até 3 casas decimais' : undefined}
          onChange={(e) => setQ(e.target.value)}
        />
        <TextField
          label="Código do lote (opcional)"
          value={code}
          maxLength={40}
          placeholder="Gerado ao salvar (LOTE-000001)"
          onChange={(e) => setCode(e.target.value)}
        />
        <TextField
          label="Fabricação"
          type="date"
          value={made}
          onChange={(e) => setMade(e.target.value)}
        />
        <TextField
          label="Validade (opcional)"
          type="date"
          value={expires}
          error={badDates ? 'Antes da fabricação' : undefined}
          onChange={(e) => setExpires(e.target.value)}
        />
      </div>
    </Modal>
  );
}
