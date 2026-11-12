import { fromCents, multiplyCents, optionsTotalCents, qtyLabel, toCents } from '@comandou/shared';
import { Minus, Plus, RotateCcw, Scale, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ItemThumb, Spinner, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/media';
import { brl } from '../lib/money';
import type { MenuCategory, MenuProduct, Order, OrderItem } from '../lib/types';
import { OptionPicker } from './NewSaleModal';
import { fold } from './search-catalog';
import { WeighForm } from './WeighForm';
import './order-editor.css';

interface Row {
  item: OrderItem;
  quantity: number;
  notes: string;
  removed: boolean;
}
interface Added {
  uid: number;
  product: MenuProduct;
  optionIds: string[];
  quantity: number;
  notes: string;
}

let nextUid = 1;

function unitCents(p: MenuProduct, optionIds: string[]) {
  return toCents(p.price) + optionsTotalCents(p.optionGroups, optionIds);
}

/**
 * Edição do pedido já lançado, no próprio detalhe: muda quantidade e observação, tira itens,
 * acrescenta produtos do cardápio do canal e troca a observação do pedido. Tudo é rascunho até
 * "Salvar alterações" (uma chamada só; o servidor recalcula preços, estoque e avisa a cozinha).
 */
export function OrderEditor({
  order,
  onCancel,
  onDone,
}: {
  order: Order;
  onCancel(): void;
  onDone(o: Order): void;
}) {
  const toast = useToast();
  const canReduce = useCan('orders:cancel');
  const [rows, setRows] = useState<Row[]>(() =>
    order.items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({
        item: i,
        quantity: Number(i.quantity),
        notes: i.notes ?? '',
        removed: false,
      })),
  );
  const [added, setAdded] = useState<Added[]>([]);
  const [orderNotes, setOrderNotes] = useState(order.notes ?? '');
  const [menu, setMenu] = useState<MenuCategory[] | null>(null);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const [weighing, setWeighing] = useState<
    | { kind: 'new'; product: MenuProduct; optionIds: string[] }
    | { kind: 'row'; row: Row }
    | { kind: 'added'; line: Added }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api<MenuCategory[]>(`/menu?channel=${order.channel}`)
      .then((m) => alive && setMenu(m))
      .catch(() => alive && setMenu([]));
    return () => {
      alive = false;
    };
  }, [order.channel]);

  const results = useMemo(() => {
    const s = fold(search.trim());
    if (!s || !menu) return [];
    return menu
      .flatMap((c) => c.products)
      .filter((p) => fold(p.name).includes(s) || (p.code && fold(p.code) === s))
      .slice(0, 8);
  }, [menu, search]);

  function setRow(r: Row, patch: Partial<Row>) {
    setRows((rs) => rs.map((x) => (x === r ? { ...x, ...patch } : x)));
  }
  function setLine(l: Added, patch: Partial<Added> | null) {
    setAdded((ls) =>
      patch ? ls.map((x) => (x === l ? { ...x, ...patch } : x)) : ls.filter((x) => x !== l),
    );
  }
  function add(p: MenuProduct, optionIds: string[] = [], kg?: number) {
    if (p.soldByWeight && kg === undefined)
      return setWeighing({ kind: 'new', product: p, optionIds });
    setAdded((ls) => {
      const key = [...optionIds].sort().join(',');
      const same = !p.soldByWeight
        ? ls.find(
            (l) => l.product.id === p.id && [...l.optionIds].sort().join(',') === key && !l.notes,
          )
        : undefined;
      if (same) return ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { uid: nextUid++, product: p, optionIds, quantity: kg ?? 1, notes: '' }];
    });
    setSearch('');
    searchRef.current?.focus();
  }
  function choose(p: MenuProduct) {
    if (p.soldOut) return;
    if (p.optionGroups.length) setPicking(p);
    else add(p);
  }

  const kept = rows.filter((r) => !r.removed);
  const subtotal =
    kept.reduce((s, r) => s + multiplyCents(toCents(r.item.unitPrice), r.quantity), 0) +
    added.reduce((s, l) => s + multiplyCents(unitCents(l.product, l.optionIds), l.quantity), 0);
  const changes = rows.filter(
    (r) =>
      !r.removed &&
      (r.quantity !== Number(r.item.quantity) || r.notes.trim() !== (r.item.notes ?? '')),
  );
  const removed = rows.filter((r) => r.removed);
  const notesChanged = orderNotes.trim() !== (order.notes ?? '');
  const dirty = changes.length > 0 || removed.length > 0 || added.length > 0 || notesChanged;
  const empty = kept.length + added.length === 0;
  const diff = subtotal - toCents(order.subtotal);

  async function save() {
    setBusy(true);
    try {
      const o = await api<Order>(`/orders/${order.id}/items`, {
        method: 'PATCH',
        json: {
          expectedVersion: order.version,
          add: added.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            optionIds: l.optionIds,
            ...(l.notes.trim() ? { notes: l.notes.trim() } : {}),
          })),
          change: changes.map((r) => ({
            itemId: r.item.id,
            quantity: r.quantity,
            notes: r.notes.trim() || null,
          })),
          remove: removed.map((r) => r.item.id),
          ...(notesChanged ? { notes: orderNotes.trim() || null } : {}),
        },
      });
      toast('Pedido atualizado', 'success');
      onDone(o);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="oed" aria-label={`Editar pedido #${order.number}`}>
      <ul className="oed__list">
        {rows.map((r) => {
          const kg = r.item.unit === 'kg';
          const orig = Number(r.item.quantity);
          const started = r.item.status !== 'pending';
          return (
            <li key={r.item.id} className="oed__row" data-removed={r.removed || undefined}>
              <ItemThumb src={mediaUrl(r.item.imageId)} name={r.item.name} size={36} />
              <div className="oed__main">
                <div className="oed__name">
                  <strong>{r.item.name}</strong>
                  <span className="cm-num">
                    {brl(fromCents(multiplyCents(toCents(r.item.unitPrice), r.quantity)))}
                  </span>
                </div>
                {r.item.options.length > 0 && (
                  <div className="oed__sub">{r.item.options.map((o) => o.name).join(' · ')}</div>
                )}
                {r.removed ? (
                  <div className="oed__sub">Sai do pedido ao salvar</div>
                ) : (
                  <input
                    className="oed__note"
                    placeholder="Observação (ex.: sem cebola)"
                    aria-label={`Observação de ${r.item.name}`}
                    value={r.notes}
                    maxLength={200}
                    onChange={(e) => setRow(r, { notes: e.target.value })}
                  />
                )}
                {!r.removed && started && !kg && r.quantity > orig && (
                  <div className="oed__sub">
                    A cozinha já começou este item: vai {r.quantity - orig} a mais como item novo.
                  </div>
                )}
              </div>
              <div className="oed__ctrl">
                {r.removed ? (
                  <button
                    type="button"
                    className="oed__icon"
                    aria-label={`Manter ${r.item.name}`}
                    title="Manter item"
                    onClick={() => setRow(r, { removed: false })}
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : (
                  <>
                    {kg ? (
                      <button
                        type="button"
                        className="oed__weight"
                        aria-label={`Peso de ${r.item.name}: ${qtyLabel(r.quantity, 'kg')}. Alterar`}
                        disabled={!canReduce}
                        onClick={() => setWeighing({ kind: 'row', row: r })}
                      >
                        <Scale size={14} aria-hidden /> {qtyLabel(r.quantity, 'kg')}
                      </button>
                    ) : (
                      <Stepper
                        value={r.quantity}
                        min={canReduce ? 1 : orig}
                        onChange={(n) => setRow(r, { quantity: n })}
                        label={r.item.name}
                      />
                    )}
                    {canReduce && (
                      <button
                        type="button"
                        className="oed__icon"
                        aria-label={`Tirar ${r.item.name}`}
                        title="Tirar do pedido"
                        onClick={() => setRow(r, { removed: true })}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
        {added.map((l) => {
          const unit = unitCents(l.product, l.optionIds);
          const opts = l.product.optionGroups
            .flatMap((g) => g.options)
            .filter((o) => l.optionIds.includes(o.id));
          return (
            <li key={`n${l.uid}`} className="oed__row" data-new>
              <ItemThumb src={mediaUrl(l.product.imageId)} name={l.product.name} size={36} />
              <div className="oed__main">
                <div className="oed__name">
                  <strong>{l.product.name}</strong>
                  <span className="oed__tag">novo</span>
                  <span className="cm-num">{brl(fromCents(multiplyCents(unit, l.quantity)))}</span>
                </div>
                {opts.length > 0 && (
                  <div className="oed__sub">{opts.map((o) => o.name).join(' · ')}</div>
                )}
                <input
                  className="oed__note"
                  placeholder="Observação (ex.: sem cebola)"
                  aria-label={`Observação de ${l.product.name}`}
                  value={l.notes}
                  maxLength={200}
                  onChange={(e) => setLine(l, { notes: e.target.value })}
                />
              </div>
              <div className="oed__ctrl">
                {l.product.soldByWeight ? (
                  <button
                    type="button"
                    className="oed__weight"
                    onClick={() => setWeighing({ kind: 'added', line: l })}
                  >
                    <Scale size={14} aria-hidden /> {qtyLabel(l.quantity, 'kg')}
                  </button>
                ) : (
                  <Stepper
                    value={l.quantity}
                    min={1}
                    onChange={(n) => setLine(l, { quantity: n })}
                    label={l.product.name}
                  />
                )}
                <button
                  type="button"
                  className="oed__icon"
                  aria-label={`Tirar ${l.product.name}`}
                  title="Tirar"
                  onClick={() => setLine(l, null)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="oed__add">
        <label className="oed__search">
          <Search size={15} aria-hidden />
          <input
            ref={searchRef}
            placeholder="Acrescentar item: busque pelo nome ou código"
            aria-label="Buscar produto para acrescentar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                choose(results[0]);
              }
            }}
          />
          {menu === null && <Spinner />}
        </label>
        {search.trim() && menu && (
          <ul className="oed__results" role="listbox" aria-label="Produtos">
            {results.length === 0 ? (
              <li className="oed__sub">Nenhum produto com esse nome no cardápio deste canal.</li>
            ) : (
              results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={p.soldOut}
                    onClick={() => choose(p)}
                  >
                    <ItemThumb src={mediaUrl(p.imageId)} name={p.name} size={28} />
                    <span>{p.name}</span>
                    <span className="cm-num">
                      {p.soldOut ? 'Esgotado' : `${brl(p.price)}${p.soldByWeight ? '/kg' : ''}`}
                    </span>
                    <Plus size={15} aria-hidden />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <label className="oed__order-note">
        <span>Observação do pedido</span>
        <textarea
          rows={2}
          maxLength={500}
          placeholder="Sem observação"
          value={orderNotes}
          onChange={(e) => setOrderNotes(e.target.value)}
        />
      </label>

      {empty && (
        <Alert tone="warning">
          O pedido não pode ficar sem itens. Para isso, cancele o pedido.
        </Alert>
      )}
      <div className="oed__foot">
        <div className="oed__total">
          <span>Novo subtotal</span>
          <strong className="cm-num">{brl(fromCents(subtotal))}</strong>
          {diff !== 0 && (
            <span className="oed__diff cm-num" data-up={diff > 0 || undefined}>
              {diff > 0 ? '+' : '−'} {brl(fromCents(Math.abs(diff)))}
            </span>
          )}
        </div>
        <div className="actions-row">
          <Button variant="secondary" onClick={onCancel}>
            Voltar
          </Button>
          <Button loading={busy} disabled={!dirty || empty} onClick={() => void save()}>
            Salvar alterações
          </Button>
        </div>
      </div>

      {picking && (
        <OptionPicker
          product={picking}
          onCancel={() => setPicking(null)}
          onConfirm={(ids) => {
            const p = picking;
            setPicking(null);
            add(p, ids);
          }}
        />
      )}
      {weighing && (
        <div
          className="picker"
          role="group"
          aria-label="Peso"
          onClick={(e) => {
            if (e.target === e.currentTarget) setWeighing(null);
          }}
        >
          <div className="picker__panel">
            {weighing.kind === 'row' ? (
              <WeighForm
                product={{ name: weighing.row.item.name, weightTare: '0' }}
                kgCents={toCents(weighing.row.item.unitPrice)}
                initialKg={weighing.row.quantity}
                confirmLabel="Salvar peso"
                onCancel={() => setWeighing(null)}
                onConfirm={(kg) => {
                  setRow(weighing.row, { quantity: kg });
                  setWeighing(null);
                }}
              />
            ) : weighing.kind === 'added' ? (
              <WeighForm
                product={weighing.line.product}
                kgCents={unitCents(weighing.line.product, weighing.line.optionIds)}
                initialKg={weighing.line.quantity}
                confirmLabel="Salvar peso"
                onCancel={() => setWeighing(null)}
                onConfirm={(kg) => {
                  setLine(weighing.line, { quantity: kg });
                  setWeighing(null);
                }}
              />
            ) : (
              <WeighForm
                product={weighing.product}
                kgCents={unitCents(weighing.product, weighing.optionIds)}
                onCancel={() => setWeighing(null)}
                onConfirm={(kg) => {
                  add(weighing.product, weighing.optionIds, kg);
                  setWeighing(null);
                }}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stepper({
  value,
  min,
  onChange,
  label,
}: {
  value: number;
  min: number;
  onChange(n: number): void;
  label: string;
}) {
  return (
    <span className="oed__step">
      <button
        type="button"
        aria-label={`Diminuir ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={14} />
      </button>
      <b className="cm-num" aria-live="polite">
        {value}
      </b>
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={value >= 999}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={14} />
      </button>
    </span>
  );
}
