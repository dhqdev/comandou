import { fromCents, multiplyCents, optionsTotalCents, qtyLabel, toCents } from '@comandou/shared';
import { Check, Minus, Plus, Scale, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ItemThumb, Spinner, Skeleton } from '../design-system';
import { useCan } from '../app/auth';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/media';
import { brl } from '../lib/money';
import type { MenuCategory, MenuProduct, Order, OrderItem } from '../lib/types';
import { OptionPicker } from './NewSaleModal';
import { fold } from './search-catalog';
import { WeighForm } from './WeighForm';
import './order-editor.css';

interface AddOp {
  product: MenuProduct;
  optionIds: string[];
  quantity: number;
}
/** Alterações ainda não confirmadas pelo servidor. */
interface Ops {
  qty: Record<string, number>;
  notes: Record<string, string>;
  remove: string[];
  add: AddOp[];
  orderNotes?: string;
  /** Salvar já (tirar, acrescentar, observação); o resto (− e +) espera o toque parar. */
  now: boolean;
}
const EMPTY: Ops = { qty: {}, notes: {}, remove: [], add: [], now: false };
const isEmpty = (o: Ops) =>
  !Object.keys(o.qty).length &&
  !Object.keys(o.notes).length &&
  !o.remove.length &&
  !o.add.length &&
  o.orderNotes === undefined;
/** Espera depois do último toque no − ou + (vários toques viram uma alteração só). */
const QTY_WAIT_MS = 800;

function unitCents(p: MenuProduct, optionIds: string[]) {
  return toCents(p.price) + optionsTotalCents(p.optionGroups, optionIds);
}

/**
 * Edição do pedido já lançado, no próprio detalhe. Cada mudança salva sozinha: − e + salvam
 * quando o toque para, tirar e acrescentar salvam na hora e a observação salva ao sair do campo.
 * O servidor recalcula preços, estoque e avisa a cozinha; se ele recusar (ex.: pagamento acima
 * do novo total), a mudança volta e o motivo aparece aqui mesmo.
 */
export function OrderEditor({
  order,
  onSaved,
  onClose,
}: {
  order: Order;
  onSaved(o: Order): void;
  onClose(): void;
}) {
  const canReduce = useCan('orders:cancel');
  const [pend, setPend] = useState<Ops>(EMPTY);
  const [fly, setFly] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** Texto sendo digitado (ainda não confirmado ao sair do campo). */
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [orderNotesText, setOrderNotesText] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuCategory[] | null>(null);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const [weighing, setWeighing] = useState<
    | { kind: 'new'; product: MenuProduct; optionIds: string[] }
    | { kind: 'row'; item: OrderItem; quantity: number }
    | null
  >(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const closing = useRef(false);

  useEffect(() => {
    let alive = true;
    api<MenuCategory[]>(`/menu?channel=${order.channel}`)
      .then((m) => alive && setMenu(m))
      .catch(() => alive && setMenu([]));
    return () => {
      alive = false;
    };
  }, [order.channel]);

  // Tirar com dois toques: o primeiro arma (vira "Tirar?"), o segundo confirma.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const results = useMemo(() => {
    const s = fold(search.trim());
    if (!s || !menu) return [];
    return menu
      .flatMap((c) => c.products)
      .filter((p) => fold(p.name).includes(s) || (p.code && fold(p.code) === s))
      .slice(0, 8);
  }, [menu, search]);

  const flush = useCallback(
    async (take: Ops) => {
      setFly(take);
      setError(null);
      try {
        const o = await api<Order>(`/orders/${orderRef.current.id}/items`, {
          method: 'PATCH',
          json: {
            expectedVersion: orderRef.current.version,
            ...(take.add.length && {
              add: take.add.map((a) => ({
                productId: a.product.id,
                quantity: a.quantity,
                optionIds: a.optionIds,
              })),
            }),
            ...(Object.keys(take.qty).length + Object.keys(take.notes).length && {
              change: [...new Set([...Object.keys(take.qty), ...Object.keys(take.notes)])].map(
                (itemId) => ({
                  itemId,
                  ...(take.qty[itemId] !== undefined && { quantity: take.qty[itemId] }),
                  ...(take.notes[itemId] !== undefined && {
                    notes: take.notes[itemId].trim() || null,
                  }),
                }),
              ),
            }),
            ...(take.remove.length && { remove: take.remove }),
            ...(take.orderNotes !== undefined && { notes: take.orderNotes.trim() || null }),
          },
        });
        onSaved(o);
        setSavedAt(Date.now());
      } catch (e) {
        setError(`Não salvou: ${(e as Error).message}`);
        closing.current = false;
      } finally {
        setFly(null);
      }
    },
    [onSaved],
  );

  // Uma chamada por vez; o que chegar enquanto uma está no ar vai na próxima.
  useEffect(() => {
    if (fly || isEmpty(pend)) return;
    const t = setTimeout(
      () => {
        setPend(EMPTY);
        void flush(pend);
      },
      pend.now || closing.current ? 0 : QTY_WAIT_MS,
    );
    return () => clearTimeout(t);
  }, [pend, fly, flush]);

  function queue(patch: (o: Ops) => Ops) {
    setPend((p) => patch(p));
  }

  const items = order.items.filter((i) => i.status !== 'cancelled');
  const removing = new Set([...(fly?.remove ?? []), ...pend.remove]);
  const visible = items.filter((i) => !removing.has(i.id));
  const qtyOf = (i: OrderItem) => pend.qty[i.id] ?? fly?.qty[i.id] ?? Number(i.quantity);
  const notesOf = (i: OrderItem) =>
    typing[i.id] ?? pend.notes[i.id] ?? fly?.notes[i.id] ?? i.notes ?? '';
  const adding = [...(fly?.add ?? []), ...pend.add];
  const busy = !!fly || !isEmpty(pend);
  const subtotal =
    visible.reduce((s, i) => s + multiplyCents(toCents(i.unitPrice), qtyOf(i)), 0) +
    adding.reduce((s, a) => s + multiplyCents(unitCents(a.product, a.optionIds), a.quantity), 0);

  function setQty(i: OrderItem, n: number) {
    queue((p) => {
      const qty = { ...p.qty };
      if (n === Number(i.quantity) && fly?.qty[i.id] === undefined) delete qty[i.id];
      else qty[i.id] = n;
      return { ...p, qty };
    });
  }
  function commitNotes(i: OrderItem) {
    const text = typing[i.id];
    if (text === undefined) return;
    setTyping(({ [i.id]: _, ...rest }) => rest);
    const current = pend.notes[i.id] ?? fly?.notes[i.id] ?? i.notes ?? '';
    if (text.trim() === current.trim()) return;
    queue((p) => ({ ...p, notes: { ...p.notes, [i.id]: text }, now: true }));
  }
  function commitOrderNotes() {
    if (orderNotesText === null) return;
    const text = orderNotesText;
    setOrderNotesText(null);
    if (text.trim() === (order.notes ?? '').trim()) return;
    queue((p) => ({ ...p, orderNotes: text, now: true }));
  }
  function remove(i: OrderItem) {
    if (armed !== i.id) return setArmed(i.id);
    setArmed(null);
    queue((p) => {
      const { [i.id]: _q, ...qty } = p.qty;
      const { [i.id]: _n, ...notes } = p.notes;
      return { ...p, qty, notes, remove: [...p.remove, i.id], now: true };
    });
  }
  function add(product: MenuProduct, optionIds: string[] = [], kg?: number) {
    if (product.soldByWeight && kg === undefined)
      return setWeighing({ kind: 'new', product, optionIds });
    queue((p) => ({ ...p, add: [...p.add, { product, optionIds, quantity: kg ?? 1 }], now: true }));
    setSearch('');
    searchRef.current?.focus();
  }
  function choose(p: MenuProduct) {
    if (p.soldOut) return;
    if (p.optionGroups.length) setPicking(p);
    else add(p);
  }
  function done() {
    // Sai do campo antes (o blur confirma a observação) e espera salvar o que falta.
    (document.activeElement as HTMLElement | null)?.blur?.();
    closing.current = true;
    setPend((p) => ({ ...p, now: true }));
  }
  const settled = !busy && !Object.keys(typing).length && orderNotesText === null;
  useEffect(() => {
    // "Pronto": fecha depois que tudo o que faltava (inclusive a observação do blur) salvou.
    if (closing.current && settled && !error) onClose();
  });

  return (
    <section className="oed" aria-label={`Editar pedido #${order.number}`}>
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className="oed__list">
        {visible.map((i) => {
          const kg = i.unit === 'kg';
          const q = qtyOf(i);
          const orig = Number(i.quantity);
          const started = i.status !== 'pending';
          const last = visible.length + adding.length <= 1;
          return (
            <li key={i.id} className="oed__row">
              <ItemThumb src={mediaUrl(i.imageId)} name={i.name} size={36} />
              <div className="oed__main">
                <div className="oed__name">
                  <strong>{i.name}</strong>
                  <span className="cm-num">
                    {brl(fromCents(multiplyCents(toCents(i.unitPrice), q)))}
                  </span>
                </div>
                {i.options.length > 0 && (
                  <div className="oed__sub">{i.options.map((o) => o.name).join(' · ')}</div>
                )}
                <input
                  className="oed__note"
                  placeholder="Observação (ex.: sem cebola)"
                  aria-label={`Observação de ${i.name}`}
                  value={notesOf(i)}
                  maxLength={200}
                  enterKeyHint="done"
                  onChange={(e) => setTyping((t) => ({ ...t, [i.id]: e.target.value }))}
                  onBlur={() => commitNotes(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                {started && !kg && q > orig && (
                  <div className="oed__sub">
                    A cozinha já começou este item: vai {q - orig} a mais como item novo.
                  </div>
                )}
              </div>
              <div className="oed__ctrl">
                {kg ? (
                  <button
                    type="button"
                    className="oed__weight"
                    aria-label={`Peso de ${i.name}: ${qtyLabel(q, 'kg')}. Alterar`}
                    disabled={!canReduce}
                    onClick={() => setWeighing({ kind: 'row', item: i, quantity: q })}
                  >
                    <Scale size={14} aria-hidden /> {qtyLabel(q, 'kg')}
                  </button>
                ) : (
                  <Stepper
                    value={q}
                    min={canReduce ? 1 : orig}
                    onChange={(n) => setQty(i, n)}
                    label={i.name}
                  />
                )}
                {canReduce && !last && (
                  <button
                    type="button"
                    className="oed__icon"
                    data-armed={armed === i.id || undefined}
                    aria-label={armed === i.id ? `Confirmar: tirar ${i.name}` : `Tirar ${i.name}`}
                    title="Tirar do pedido"
                    onClick={() => remove(i)}
                  >
                    <Trash2 size={15} aria-hidden />
                    {armed === i.id && <span>Tirar?</span>}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {adding.map((a, n) => (
          <li key={`add-${n}`} className="oed__row" data-saving>
            <ItemThumb src={mediaUrl(a.product.imageId)} name={a.product.name} size={36} />
            <div className="oed__main">
              <div className="oed__name">
                <strong>{a.product.name}</strong>
                <span className="cm-num">
                  {brl(fromCents(multiplyCents(unitCents(a.product, a.optionIds), a.quantity)))}
                </span>
              </div>
              <div className="oed__sub">Acrescentando…</div>
            </div>
            <div className="oed__ctrl">
              <Spinner />
            </div>
          </li>
        ))}
      </ul>

      <div className="oed__add">
        <label className="oed__search">
          <Search size={15} aria-hidden />
          <input
            ref={searchRef}
            placeholder="Acrescentar item: busque pelo nome ou código"
            aria-label="Buscar produto para acrescentar"
            value={search}
            enterKeyHint="search"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                choose(results[0]);
              }
            }}
          />
          {menu === null && <Skeleton variant="grid" />}
        </label>
        {search.trim() && menu && (
          <ul className="oed__results" aria-label="Produtos">
            {results.length === 0 ? (
              <li className="oed__sub">Nenhum produto com esse nome no cardápio deste canal.</li>
            ) : (
              results.map((p) => (
                <li key={p.id}>
                  <button type="button" disabled={p.soldOut} onClick={() => choose(p)}>
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
          value={orderNotesText ?? pend.orderNotes ?? fly?.orderNotes ?? order.notes ?? ''}
          onChange={(e) => setOrderNotesText(e.target.value)}
          onBlur={commitOrderNotes}
        />
      </label>

      <div className="oed__foot">
        <div className="oed__total">
          <span>Subtotal</span>
          <strong className="cm-num">{brl(fromCents(subtotal))}</strong>
          <span className="oed__status" aria-live="polite">
            {busy ? (
              'Salvando…'
            ) : savedAt ? (
              <>
                <Check size={13} aria-hidden /> Salvo
              </>
            ) : (
              'Salva sozinho'
            )}
          </span>
        </div>
        <Button variant="secondary" onClick={done}>
          Pronto
        </Button>
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
                product={{ name: weighing.item.name, weightTare: '0' }}
                kgCents={toCents(weighing.item.unitPrice)}
                initialKg={weighing.quantity}
                confirmLabel="Salvar peso"
                onCancel={() => setWeighing(null)}
                onConfirm={(kg) => {
                  const it = weighing.item;
                  setWeighing(null);
                  queue((p) => ({ ...p, qty: { ...p.qty, [it.id]: kg }, now: true }));
                }}
              />
            ) : (
              <WeighForm
                product={weighing.product}
                kgCents={unitCents(weighing.product, weighing.optionIds)}
                onCancel={() => setWeighing(null)}
                onConfirm={(kg) => {
                  const w = weighing;
                  setWeighing(null);
                  add(w.product, w.optionIds, kg);
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
