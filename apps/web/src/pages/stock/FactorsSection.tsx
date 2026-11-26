import { Pencil, Plus, Ruler, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
  Skeleton,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { parseDecimalInput } from '../../lib/money';
import {
  fold,
  ListTable,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../../features/list-view';
import { fmtQty, SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import type { StockFactor, StockItem, StockUnit } from '../../lib/types';
import { StockHead, UNITS, useStockItems } from './common';

const FIELDS: ListField<StockFactor>[] = [
  {
    key: 'unit',
    label: 'Unidade de destino',
    value: (f) => f.unit,
    options: UNITS.map(([value, label]) => ({ value, label: `${value} (${label})` })),
    pinned: true,
  },
  {
    key: 'scope',
    label: 'Vale para',
    value: (f) => (f.stockItemId ? 'item' : 'all'),
    options: [
      { value: 'all', label: 'Todos os insumos' },
      { value: 'item', label: 'Um insumo' },
    ],
  },
];
const TABS: ListTab[] = [{ id: 'all', label: 'Todos', filters: {} }];
const SORTS: ListSort<StockFactor>[] = [
  { key: 'code', label: 'Sigla', get: (f) => fold(f.code), asc: true },
  { key: 'name', label: 'Nome', get: (f) => fold(f.name), asc: true },
];

/** "12.0000" → "12"; "0.5000" → "0,5". */
const fmtFactorQty = (v: string) => fmtQty(String(Number(v)));

/**
 * Unidades de compra (no banco, fatores de conversão): as embalagens em que você compra (caixa,
 * fardo, saco) e quanto cada uma vale na unidade do insumo.
 */
export function FactorsSection() {
  const canWrite = useCan('stock:write');
  const toast = useToast();
  const { items } = useStockItems();
  const [rows, setRows] = useState<StockFactor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockFactor | 'new' | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(await api<StockFactor[]>('/stock/factors'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const lv = useListView({
    id: 'estoque-fatores',
    rows,
    fields: FIELDS,
    tabs: TABS,
    search: (f) => `${f.code} ${f.name} ${f.itemName ?? ''}`,
    sorts: SORTS,
  });
  const shown = lv.visible ?? [];

  async function remove(f: StockFactor) {
    if (!window.confirm(`Excluir a unidade de compra ${f.code}?`)) return;
    try {
      await api(`/stock/factors/${f.id}`, { method: 'DELETE' });
      toast('Unidade de compra excluída', 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="st-page">
      <StockHead
        title="Fichas técnicas"
        error={error}
        actions={
          canWrite && (
            <Button size="lg" icon={<Plus size={18} />} onClick={() => setEditing('new')}>
              Nova unidade de compra
            </Button>
          )
        }
      >
        Compra em caixa ou fardo e controla em unidade ou kg? Cadastre quanto vale cada embalagem.
      </StockHead>
      <Alert tone="info">
        Quilo e grama, litro e mililitro já convertem sozinhos; não precisa cadastrar.
      </Alert>
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar unidade de compra"
          searchHint="sigla, nome ou insumo"
          summary={`${shown.length} ${shown.length === 1 ? 'unidade' : 'unidades'}`}
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Skeleton variant="table" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Ruler size={20} />}
            title="Nenhuma unidade de compra cadastrada"
            description="Ex.: CX12 = Caixa com 12 (12 un), FD6 = Fardo com 6 (6 un), SC25 = Saco de 25 kg."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nada por aqui"
            description="Nenhuma unidade de compra com esses filtros."
          />
        ) : (
          <ListTable>
            <table className="cm-table lv-table st-table">
              <thead>
                <tr>
                  <th>Sigla</th>
                  <th>Conversão</th>
                  <th>Vale para</th>
                  {canWrite && <th className="cm-num">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div className="st-name">
                        <strong>{f.code}</strong>
                        <span className="st-name__meta">{f.name}</span>
                      </div>
                    </td>
                    <td>
                      1 {f.code} = {fmtFactorQty(f.factor)} {f.unit}
                    </td>
                    <td>{f.itemName ?? `Todo insumo em ${f.unit}`}</td>
                    {canWrite && (
                      <td className="cm-num st-act" data-label="">
                        <div className="st-actions">
                          <Button
                            variant="secondary"
                            icon={<Pencil size={16} />}
                            onClick={() => setEditing(f)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            icon={<Trash2 size={16} />}
                            onClick={() => remove(f)}
                          >
                            Excluir
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
      {editing && items && (
        <FactorModal
          factor={editing === 'new' ? null : editing}
          items={items}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function FactorModal({
  factor,
  items,
  onClose,
  onDone,
}: {
  factor: StockFactor | null;
  items: StockItem[];
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(factor?.code ?? '');
  const [name, setName] = useState(factor?.name ?? '');
  const [unit, setUnit] = useState<StockUnit>(factor?.unit ?? 'un');
  const [value, setValue] = useState(factor ? fmtFactorQty(factor.factor) : '');
  const [itemId, setItemId] = useState(factor?.stockItemId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId);
  const destUnit = item?.unit ?? unit;
  const clean = parseDecimalInput(value, 4, 8);
  const parsed = clean && Number(clean) > 0 ? clean : null;
  const codeOk = /^[A-Za-z0-9.-]{1,12}$/.test(code.trim());
  const valid = codeOk && !!name.trim() && !!parsed;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const json = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        unit: destUnit,
        factor: parsed,
        stockItemId: itemId || null,
      };
      if (factor) await api(`/stock/factors/${factor.id}`, { method: 'PATCH', json });
      else await api('/stock/factors', { method: 'POST', json });
      toast(factor ? 'Unidade de compra atualizada' : 'Unidade de compra cadastrada', 'success');
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
      title={factor ? `Editar ${factor.code}` : 'Nova unidade de compra'}
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
        <TextField
          label="Sigla"
          value={code}
          maxLength={12}
          placeholder="Ex.: CX12"
          hint="Aparece na unidade do recebimento"
          error={code && !codeOk ? 'Só letras, números, ponto e hífen' : undefined}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <TextField
          label="Nome"
          value={name}
          maxLength={60}
          placeholder="Ex.: Caixa com 12"
          onChange={(e) => setName(e.target.value)}
        />
        <SelectField label="Vale para" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Todo insumo na mesma unidade</option>
          {items
            .filter((i) => i.active || i.id === itemId)
            .map((i) => (
              <option key={i.id} value={i.id}>
                Só {i.name} ({i.unit})
              </option>
            ))}
        </SelectField>
        {!item && (
          <SelectField
            label="Unidade de destino"
            value={unit}
            onChange={(e) => setUnit(e.target.value as StockUnit)}
          >
            {UNITS.map(([u, l]) => (
              <option key={u} value={u}>
                {u} ({l})
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label={`1 ${code.trim() || 'sigla'} = quantos ${destUnit}?`}
          inputMode="decimal"
          value={value}
          placeholder="Ex.: 12"
          hint="Quantidade na unidade de destino equivalente a 1 embalagem"
          error={value && !parsed ? 'Número maior que zero, até 4 casas' : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </Modal>
  );
}
