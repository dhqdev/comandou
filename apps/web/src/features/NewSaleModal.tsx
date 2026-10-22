import {
  CHANNEL_LABELS,
  fromCents,
  multiplyCents,
  ORDER_CHANNELS,
  toCents,
  type OrderChannel,
} from '@comandou/shared';
import { Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { api, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import type { DiningTable, MenuCategory, MenuProduct, Order } from '../lib/types';

interface CartLine {
  key: string;
  product: MenuProduct;
  optionIds: string[];
  quantity: number;
  notes: string;
}

/** Preço de exibição calculado no cliente; o servidor recalcula e é a fonte oficial. */
function unitCents(p: MenuProduct, optionIds: string[]) {
  const deltas = p.optionGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id));
  return toCents(p.price) + deltas.reduce((s, o) => s + toCents(o.priceDelta), 0);
}

export function NewSaleModal({
  open,
  onClose,
  onCreated,
  preset,
}: {
  open: boolean;
  onClose(): void;
  onCreated(o: Order): void;
  preset?: { channel?: OrderChannel; tableId?: string; tabId?: string; label?: string };
}) {
  const toast = useToast();
  const [menu, setMenu] = useState<MenuCategory[] | null>(null);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const [channel, setChannel] = useState<OrderChannel>(preset?.channel ?? 'counter');
  const [tableId, setTableId] = useState(preset?.tableId ?? '');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Uma chave por venda: reenvios após falha de rede não duplicam o pedido.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!open) return;
    setChannel(preset?.channel ?? 'counter');
    setTableId(preset?.tableId ?? '');
    setError(null);
    api<MenuCategory[]>('/menu')
      .then((m) => {
        setMenu(m);
        setCat((c) => c ?? m[0]?.id ?? null);
      })
      .catch((e) => setError((e as Error).message));
    api<DiningTable[]>('/tables')
      .then(setTables)
      .catch(() => setTables([]));
  }, [open, preset?.channel, preset?.tableId]);

  const products = useMemo(() => {
    const all = menu ?? [];
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      return all.flatMap((c) => c.products).filter((p) => p.name.toLowerCase().includes(s));
    }
    return all.find((c) => c.id === cat)?.products ?? [];
  }, [menu, cat, search]);

  const subtotal = cart.reduce(
    (s, l) => s + multiplyCents(unitCents(l.product, l.optionIds), l.quantity),
    0,
  );
  const discountCents = toCents(parseBrlInput(discount) ?? '0');
  const feeCents = channel === 'delivery' ? toCents(parseBrlInput(deliveryFee) ?? '0') : 0;
  const total = subtotal - discountCents + feeCents;

  function add(p: MenuProduct, optionIds: string[] = []) {
    const key = `${p.id}:${[...optionIds].sort().join(',')}`;
    setCart((c) => {
      const found = c.find((l) => l.key === key && !l.notes);
      if (found) return c.map((l) => (l === found ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { key, product: p, optionIds, quantity: 1, notes: '' }];
    });
  }

  function choose(p: MenuProduct) {
    if (p.soldOut) return;
    if (p.optionGroups.length) setPicking(p);
    else add(p);
  }

  function reset() {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setAddress('');
    setDeliveryFee('');
    setDiscount('');
    setNotes('');
    setSearch('');
    setIdemKey(newIdempotencyKey());
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        json: {
          channel,
          tabId: preset?.tabId,
          tableId: channel === 'table' && !preset?.tabId ? tableId || undefined : undefined,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          deliveryAddress: channel === 'delivery' ? address : undefined,
          deliveryFee: channel === 'delivery' && feeCents ? fromCents(feeCents) : undefined,
          discount: discountCents ? fromCents(discountCents) : undefined,
          notes: notes || undefined,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            optionIds: l.optionIds,
            notes: l.notes || undefined,
          })),
        },
      });
      toast(`Pedido #${order.number} criado`, 'success');
      reset();
      onCreated(order);
    } catch (e) {
      // Mantém a mesma chave: falhas não gravam a chave no servidor e, se a rede caiu
      // depois do servidor gravar, o reenvio devolve o mesmo pedido em vez de duplicar.
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Sem conexão. Tente enviar de novo: o pedido não será duplicado.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const needsTable = channel === 'table' && !preset?.tabId && !tableId;
  const needsAddress = channel === 'delivery' && !address.trim();
  const freeOrSame = tables.filter((t) => t.active);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preset?.label ? `Novo pedido — ${preset.label}` : 'Nova venda'}
      size="xl"
    >
      <div className="sale">
        <section className="sale__menu" aria-label="Cardápio">
          <div className="sale__search">
            <Search size={16} aria-hidden />
            <input
              className="cm-input"
              placeholder="Buscar produto…"
              aria-label="Buscar produto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!search && (
            <div className="chips" role="tablist" aria-label="Categorias">
              {(menu ?? []).map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={c.id === cat}
                  className="chip"
                  onClick={() => setCat(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {menu === null ? (
            <Spinner />
          ) : products.length === 0 ? (
            <EmptyState title="Nenhum produto" />
          ) : (
            <div className="product-grid">
              {products.map((p) => (
                <button
                  key={p.id}
                  className="product-tile"
                  disabled={p.soldOut}
                  onClick={() => choose(p)}
                >
                  <span className="product-tile__name">{p.name}</span>
                  <span className="product-tile__price">
                    {p.soldOut ? <Badge tone="danger">Esgotado</Badge> : brl(p.price)}
                  </span>
                  {p.optionGroups.length > 0 && <span className="cm-hint">com opções</span>}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="sale__cart" aria-label="Carrinho">
          <div className="chips" role="radiogroup" aria-label="Canal">
            {ORDER_CHANNELS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={channel === c}
                className="chip"
                disabled={!!preset?.tabId && c !== 'table'}
                onClick={() => setChannel(c)}
              >
                {CHANNEL_LABELS[c]}
              </button>
            ))}
          </div>
          {channel === 'table' && !preset?.tabId && (
            <label className="cm-field">
              <span className="cm-label">Mesa</span>
              <select
                className="cm-input"
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {freeOrSame.map((t) => (
                  <option key={t.id} value={t.id}>
                    Mesa {t.label} {t.tabId ? `(ocupada · ${brl(t.tabTotal)})` : '(livre)'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {cart.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag size={20} />}
              title="Carrinho vazio"
              description="Toque nos produtos para adicionar."
            />
          ) : (
            <ul className="cart">
              {cart.map((l) => {
                const opts = l.product.optionGroups
                  .flatMap((g) => g.options)
                  .filter((o) => l.optionIds.includes(o.id));
                return (
                  <li key={l.key + l.notes} className="cart__line">
                    <div className="cart__info">
                      <strong>{l.product.name}</strong>
                      {opts.length > 0 && (
                        <span className="cm-hint">{opts.map((o) => o.name).join(', ')}</span>
                      )}
                      <input
                        className="cm-input cart__note"
                        placeholder="Observação (ex.: sem cebola)"
                        aria-label={`Observação de ${l.product.name}`}
                        value={l.notes}
                        maxLength={200}
                        onChange={(e) =>
                          setCart((c) =>
                            c.map((x) => (x === l ? { ...x, notes: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="cart__qty">
                      <Button
                        variant="ghost"
                        aria-label="Diminuir"
                        icon={l.quantity > 1 ? <Minus size={14} /> : <Trash2 size={14} />}
                        onClick={() =>
                          setCart((c) =>
                            l.quantity > 1
                              ? c.map((x) => (x === l ? { ...x, quantity: x.quantity - 1 } : x))
                              : c.filter((x) => x !== l),
                          )
                        }
                      />
                      <span>{l.quantity}</span>
                      <Button
                        variant="ghost"
                        aria-label="Aumentar"
                        icon={<Plus size={14} />}
                        onClick={() =>
                          setCart((c) =>
                            c.map((x) => (x === l ? { ...x, quantity: x.quantity + 1 } : x)),
                          )
                        }
                      />
                    </div>
                    <span className="cm-num">
                      {brl(fromCents(multiplyCents(unitCents(l.product, l.optionIds), l.quantity)))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="sale__fields">
            <TextField
              label="Cliente"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={80}
            />
            {(channel === 'delivery' || channel === 'pickup') && (
              <TextField
                label="Telefone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                maxLength={30}
                inputMode="tel"
              />
            )}
            {channel === 'delivery' && (
              <>
                <TextField
                  label="Endereço de entrega"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={300}
                  required
                />
                <TextField
                  label="Taxa de entrega"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  error={
                    deliveryFee && !parseBrlInput(deliveryFee) ? 'Use o formato 5,00' : undefined
                  }
                />
              </>
            )}
            <TextField
              label="Desconto"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              hint="Acima de 10% exige gerente"
              error={discount && !parseBrlInput(discount) ? 'Use o formato 5,00' : undefined}
            />
            <TextField
              label="Observação do pedido"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>
          <dl className="totals">
            <dt>Subtotal</dt>
            <dd>{brl(fromCents(subtotal))}</dd>
            {discountCents > 0 && (
              <>
                <dt>Desconto</dt>
                <dd>− {brl(fromCents(discountCents))}</dd>
              </>
            )}
            {feeCents > 0 && (
              <>
                <dt>Entrega</dt>
                <dd>{brl(fromCents(feeCents))}</dd>
              </>
            )}
            <dt className="totals__grand">Total</dt>
            <dd className="totals__grand">{brl(fromCents(Math.max(0, total)))}</dd>
          </dl>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button
            size="lg"
            block
            loading={busy}
            disabled={!cart.length || needsTable || needsAddress || total < 0}
            onClick={submit}
          >
            Enviar pedido
          </Button>
          <p className="cm-hint" style={{ margin: 0 }}>
            O pedido só aparece como criado depois da confirmação do servidor.
          </p>
        </section>
      </div>
      {picking && (
        <OptionPicker
          product={picking}
          onCancel={() => setPicking(null)}
          onConfirm={(ids) => {
            add(picking, ids);
            setPicking(null);
          }}
        />
      )}
    </Modal>
  );
}

function OptionPicker({
  product,
  onCancel,
  onConfirm,
}: {
  product: MenuProduct;
  onCancel(): void;
  onConfirm(ids: string[]): void;
}) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const valid = product.optionGroups.every((g) => {
    const n = sel[g.id]?.length ?? 0;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  const ids = Object.values(sel).flat();
  function toggle(gid: string, oid: string, single: boolean) {
    setSel((s) => {
      const cur = s[gid] ?? [];
      if (single) return { ...s, [gid]: [oid] };
      const g = product.optionGroups.find((x) => x.id === gid)!;
      if (cur.includes(oid)) return { ...s, [gid]: cur.filter((x) => x !== oid) };
      if (cur.length >= g.maxSelect) return s;
      return { ...s, [gid]: [...cur, oid] };
    });
  }
  return (
    <div className="picker" role="group" aria-label={`Opções de ${product.name}`}>
      <div className="picker__panel">
        <h3 style={{ margin: 0 }}>{product.name}</h3>
        {product.optionGroups.map((g) => {
          const single = g.minSelect === 1 && g.maxSelect === 1;
          return (
            <fieldset key={g.id} className="picker__group">
              <legend>
                {g.name}{' '}
                <span className="cm-hint">
                  {single
                    ? 'escolha 1'
                    : g.minSelect > 0
                      ? `escolha de ${g.minSelect} a ${g.maxSelect}`
                      : `até ${g.maxSelect}`}
                </span>
              </legend>
              {g.options.map((o) => (
                <label key={o.id} className="picker__opt">
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={g.id}
                    checked={sel[g.id]?.includes(o.id) ?? false}
                    onChange={() => toggle(g.id, o.id, single)}
                  />
                  <span>{o.name}</span>
                  {toCents(o.priceDelta) > 0 && (
                    <span className="cm-hint">+ {brl(o.priceDelta)}</span>
                  )}
                </label>
              ))}
            </fieldset>
          );
        })}
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
        >
          <strong>{brl(fromCents(unitCents(product, ids)))}</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
            <Button disabled={!valid} onClick={() => onConfirm(ids)}>
              Adicionar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
