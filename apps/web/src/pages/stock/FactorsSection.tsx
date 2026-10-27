import { Pencil, Plus, Ruler, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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

/** Fatores de conversão: as unidades em que você compra (caixa, fardo, saco) e quanto valem. */
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
    if (!window.confirm(`Excluir o fator ${f.code}?`)) return;
    try {
      await api(`/stock/factors/${f.id}`, { method: 'DELETE' });
      toast('Fator excluído', 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="st-page">
      <StockHead
        title="Fatores de conversão"
        error={error}
        actions={
          canWrite && (
            <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Novo fator
            </Button>
          )
        }
      >
        Você compra em caixa, fardo ou saco, mas controla em unidade, kg ou litro. Cadastre aqui
        quanto vale cada embalagem (1 CX12 = 12 un) e escolha ela no recebimento: o sistema converte
        a quantidade e o custo.
      </StockHead>
      <Alert tone="info">
        Quilo e grama, litro e mililitro já convertem sozinhos; não precisa cadastrar.
      </Alert>
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar fator"
          placeholder="Buscar: sigla, nome ou insumo"
          summary={`${shown.length} ${shown.length === 1 ? 'fator' : 'fatores'}`}
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Ruler size={20} />}
            title="Nenhum fator cadastrado"
            description="Ex.: CX12 = Caixa com 12 (12 un), FD6 = Fardo com 6 (6 un), SC25 = Saco de 25 kg."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nada por aqui"
            description="Nenhum fator com esses filtros."
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
                      <td className="cm-num" data-label="">
                        <div className="st-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil size={15} />}
                            onClick={() => setEditing(f)}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={15} />}
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
  const clean = value.trim().replace(/\./g, '').replace(',', '.');
  const parsed = /^\d{1,8}(\.\d{1,4})?$/.test(clean) && Number(clean) > 0 ? clean : null;
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
      toast(factor ? 'Fator atualizado' : 'Fator cadastrado', 'success');
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
      title={factor ? `Editar ${factor.code}` : 'Novo fator de conversão'}
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
