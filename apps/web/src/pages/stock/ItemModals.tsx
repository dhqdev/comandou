import { formatBRL, toCents } from '@comandou/shared';
import { useState } from 'react';
import { Alert, Button, Modal, Segmented, TextField, useToast } from '../../design-system';
import {
  CheckField,
  fmtQty,
  parseCostInput,
  parseQtyInput,
  SelectField,
} from '../../features/forms';
import {
  fmtCost,
  milliToQty,
  toMilli,
  unitCostFromTotal,
  valueCents,
} from '../../features/stock-math';
import { api } from '../../lib/api';
import { parseBrlInput } from '../../lib/money';
import type { StockItem, StockUnit } from '../../lib/types';
import { UNITS } from './common';

export type EntryKind = 'purchase' | 'loss' | 'count';
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
export function EntryModal({
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

export function ItemModal({
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
  const [code, setCode] = useState(item?.code ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [shelf, setShelf] = useState(item?.shelfLifeDays ? String(item.shelfLifeDays) : '');
  const [allowNegative, setAllowNegative] = useState(item?.allowNegative ?? false);
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minQuantity = parseQtyInput(min);
  const initialQty = initial ? parseQtyInput(initial) : undefined;
  const initialUnitCost = initialCost ? parseCostInput(initialCost) : undefined;
  const shelfDays = shelf.trim() ? Number(shelf) : null;
  const shelfOk =
    shelfDays === null || (Number.isInteger(shelfDays) && shelfDays >= 1 && shelfDays <= 3650);
  const valid =
    !!name.trim() &&
    minQuantity !== null &&
    initialQty !== null &&
    initialUnitCost !== null &&
    shelfOk &&
    (!item || !!code.trim());

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
        code: code.trim() || null,
        barcode: barcode.trim() || null,
        shelfLifeDays: shelfDays,
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
            label={item ? 'Código' : 'Código (opcional)'}
            value={code}
            maxLength={30}
            placeholder={item ? undefined : 'Gerado ao salvar (IN-000001)'}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <TextField
            label="Código de barras (opcional)"
            value={barcode}
            maxLength={40}
            hint="Para bipar na produção e no recebimento"
            onChange={(e) => setBarcode(e.target.value.trim())}
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
          <TextField
            label="Validade padrão (dias, opcional)"
            inputMode="numeric"
            value={shelf}
            placeholder="Ex.: 3"
            hint="Preenche a validade dos lotes produzidos"
            error={shelfOk ? undefined : 'De 1 a 3650 dias'}
            onChange={(e) => setShelf(e.target.value.replace(/\D/g, ''))}
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
