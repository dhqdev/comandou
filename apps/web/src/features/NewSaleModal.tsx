import {
  CHANNEL_LABELS,
  fromCents,
  defaultOptionIds,
  multiplyCents,
  optionsTotalCents,
  ORDER_CHANNELS,
  qtyLabel,
  toCents,
  type OrderChannel,
} from '@comandou/shared';
import {
  Bike,
  Frown,
  Minus,
  Plus,
  ReceiptText,
  Scale,
  Search,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  User,
  Utensils,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Select, Spinner, TextField, showLiquid, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { isOfflineResult } from '../lib/offline';
import { brl, parseBrlInput } from '../lib/money';
import { mediaUrl } from '../lib/media';
import './sale-extras.css';
import { AddressQuick } from './AddressQuick';
import { CustomerPicker, type OrderCustomer } from './CustomerPicker';
import { WeighForm } from './WeighForm';
import type { DiningTable, MenuCategory, MenuProduct, Order } from '../lib/types';

interface CartLine {
  /** Identidade estável da linha (a observação muda enquanto se digita). */
  uid: number;
  key: string;
  product: MenuProduct;
  optionIds: string[];
  quantity: number;
  notes: string;
}

let nextLineId = 1;

const CHANNEL_ICON: Record<OrderChannel, ReactNode> = {
  counter: <Store size={20} />,
  table: <Utensils size={20} />,
  pickup: <ShoppingBag size={20} />,
  delivery: <Bike size={20} />,
};

/** Preço de exibição calculado no cliente; o servidor recalcula e é a fonte oficial. */
function unitCents(p: MenuProduct, optionIds: string[]) {
  return toCents(p.price) + optionsTotalCents(p.optionGroups, optionIds);
}

/** Duas letras do nome, para o produto sem foto ("Bolo Abacaxi" → "BA"). */
function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
}

/**
 * Nova venda em tela cheia, no formato do PedidoJá: à esquerda a busca, as categorias, a grade de
 * produtos com foto e a tabela dos itens; à direita o cliente, o tipo de atendimento e o total.
 * No celular tudo vira uma coluna só, com o total e o botão de enviar presos embaixo.
 */
export function NewSaleModal({
  open,
  onClose,
  onCreated,
  preset,
  title: titleProp,
}: {
  open: boolean;
  onClose(): void;
  onCreated(o: Order): void;
  preset?: { channel?: OrderChannel; tableId?: string; tabId?: string; label?: string };
  /** Título da janela (ex.: "Vender fiado"); sem ele, "Nova venda" ou o do preset. */
  title?: string;
}) {
  const toast = useToast();
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<MenuCategory[] | null>(null);
  const [tables, setTables] = useState<DiningTable[]>([]);
  /** null = todas as categorias. */
  const [cat, setCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  /** Item por peso esperando o peso da balança (com os complementos já escolhidos). */
  const [weighing, setWeighing] = useState<{
    product: MenuProduct;
    optionIds: string[];
    line?: CartLine;
  } | null>(null);
  const [channel, setChannel] = useState<OrderChannel>(preset?.channel ?? 'counter');
  const [tableId, setTableId] = useState(preset?.tableId ?? '');
  const [customer, setCustomer] = useState<OrderCustomer>({ id: null, name: '', phone: '' });
  const [address, setAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Uma chave por venda: reenvios após falha de rede não duplicam o pedido.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Nasce do botão que abriu, como as outras janelas (liquid.ts).
    if (open && !d.open) showLiquid(d);
  }, [open]);
  /** Clique fora (no fundo escurecido): começou e terminou fora dos cartões. */
  const downOutside = useRef(false);

  useEffect(() => {
    if (!open) return;
    setChannel(preset?.channel ?? 'counter');
    setTableId(preset?.tableId ?? '');
    setError(null);
    api<DiningTable[]>('/tables')
      .then(setTables)
      .catch(() => setTables([]));
  }, [open, preset?.channel, preset?.tableId]);

  // Cada canal tem o seu cardápio (Principal no balcão/salão, Delivery na entrega/retirada):
  // ao trocar o canal, os itens e preços do carrinho passam a ser os do novo cardápio.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<MenuCategory[]>(`/menu?channel=${channel}`)
      .then((m) => {
        if (!alive) return;
        setMenu(m);
        setCat((c) => (c && m.some((x) => x.id === c) ? c : null));
        const byId = new Map(m.flatMap((c) => c.products).map((p) => [p.id, p]));
        setCart((lines) => {
          const kept = lines.flatMap((l) => {
            const p = byId.get(l.product.id);
            return p ? [{ ...l, product: p }] : [];
          });
          if (kept.length < lines.length)
            toast('Alguns itens não estão no cardápio deste canal e saíram do carrinho', 'neutral');
          return kept;
        });
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [open, channel, toast]);

  const products = useMemo(() => {
    const all = menu ?? [];
    const s = search.trim().toLowerCase();
    const pool =
      cat && !s ? (all.find((c) => c.id === cat)?.products ?? []) : all.flatMap((c) => c.products);
    return s ? pool.filter((p) => p.name.toLowerCase().includes(s)) : pool;
  }, [menu, cat, search]);

  const subtotal = cart.reduce(
    (s, l) => s + multiplyCents(unitCents(l.product, l.optionIds), l.quantity),
    0,
  );
  const discountCents = toCents(parseBrlInput(discount) ?? '0');
  const feeCents = channel === 'delivery' ? toCents(parseBrlInput(deliveryFee) ?? '0') : 0;
  const total = subtotal - discountCents + feeCents;

  function add(p: MenuProduct, optionIds: string[] = [], kg?: number) {
    const key = `${p.id}:${[...optionIds].sort().join(',')}`;
    if (p.soldByWeight) {
      // Cada pesagem é uma linha (dois potes de sorvete são duas linhas com pesos diferentes).
      if (kg === undefined) return setWeighing({ product: p, optionIds });
      setCart((c) => [
        ...c,
        { uid: nextLineId++, key, product: p, optionIds, quantity: kg, notes: '' },
      ]);
      return;
    }
    setCart((c) => {
      const found = c.find((l) => l.key === key && !l.notes);
      if (found) return c.map((l) => (l === found ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { uid: nextLineId++, key, product: p, optionIds, quantity: 1, notes: '' }];
    });
  }

  function choose(p: MenuProduct) {
    if (p.soldOut) return;
    if (p.optionGroups.length) setPicking(p);
    else add(p);
  }

  function setLine(l: CartLine, patch: Partial<CartLine> | null) {
    setCart((c) =>
      patch ? c.map((x) => (x.uid === l.uid ? { ...x, ...patch } : x)) : c.filter((x) => x !== l),
    );
  }

  function reset() {
    setCart([]);
    setCustomer({ id: null, name: '', phone: '' });
    setAddress('');
    setDeliveryFee('');
    setDiscount('');
    setNotes('');
    setSearch('');
    setIdemKey(newIdempotencyKey());
  }

  const needsTable = channel === 'table' && !preset?.tabId && !tableId;
  const needsAddress = channel === 'delivery' && !address.trim();
  const canSubmit = cart.length > 0 && !needsTable && !needsAddress && total >= 0;
  const freeOrSame = tables.filter((t) => t.active);

  async function submit() {
    // Trava contra toque duplo: o estado `busy` só chega na próxima renderização.
    if (sending.current || !canSubmit) return;
    sending.current = true;
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
          customerId: customer.id ?? undefined,
          customerName: customer.name.trim() || undefined,
          customerPhone: customer.phone || undefined,
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
      // Sem internet o pedido fica no aparelho (lib/offline.ts): o aviso sai da faixa offline.
      if (!isOfflineResult(order)) toast(`Pedido #${order.number} criado`, 'success');
      reset();
      ref.current?.close();
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
      sending.current = false;
      setBusy(false);
    }
  }

  if (!open) return null;
  const title = titleProp ?? (preset?.label ? `Novo pedido — ${preset.label}` : 'Nova venda');

  return (
    <dialog
      ref={ref}
      className="nsale"
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc com a escolha de opções aberta fecha só a escolha.
        if (weighing) {
          e.preventDefault();
          setWeighing(null);
        } else if (picking) {
          e.preventDefault();
          setPicking(null);
        }
      }}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => {
        downOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOutside.current && e.target === e.currentTarget) {
          if (weighing) setWeighing(null);
          else if (picking) setPicking(null);
          else ref.current?.close();
        }
        downOutside.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="nsale__main">
        <header className="nsale__head">
          <span className="nsale__icon" aria-hidden>
            <ReceiptText size={20} />
          </span>
          <div className="nsale__title">
            <h2 id={titleId}>{title}</h2>
            <p>Lance os produtos e informe os dados do pedido, se precisar.</p>
          </div>
          <button type="button" className="nsale__cancel" onClick={() => ref.current?.close()}>
            Cancelar <kbd className="kbd">Esc</kbd>
          </button>
          <button
            type="button"
            className="nsale__x"
            aria-label="Fechar"
            onClick={() => ref.current?.close()}
          >
            <X size={20} />
          </button>
        </header>

        <label className="nsale__search">
          <Search size={18} aria-hidden />
          <input
            ref={searchRef}
            placeholder="Buscar produto pelo nome…"
            aria-label="Buscar produto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter com um só resultado já lança o produto (leitor de código / digitação rápida).
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && products.length === 1) {
                e.preventDefault();
                choose(products[0]!);
                setSearch('');
              }
            }}
          />
          {search && (
            <button type="button" aria-label="Limpar busca" onClick={() => setSearch('')}>
              <X size={16} />
            </button>
          )}
        </label>

        <div className="nsale__cats" role="tablist" aria-label="Categorias">
          <button
            type="button"
            role="tab"
            aria-selected={cat === null}
            className="nsale__cat"
            onClick={() => setCat(null)}
          >
            Todos
          </button>
          {(menu ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === cat}
              className="nsale__cat"
              onClick={() => setCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="nsale__grid" aria-label="Produtos">
          {menu === null ? (
            <Spinner />
          ) : products.length === 0 ? (
            <p className="nsale__none">Nenhum produto encontrado.</p>
          ) : (
            products.map((p) => (
              <button
                key={p.id}
                type="button"
                className="nsale__tile"
                disabled={p.soldOut}
                onClick={() => choose(p)}
              >
                {p.imageId ? (
                  <img src={mediaUrl(p.imageId)!} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="nsale__initials" aria-hidden>
                    {initials(p.name)}
                  </span>
                )}
                <span className="nsale__price">
                  {p.soldOut
                    ? p.stockOut
                      ? 'Sem estoque'
                      : 'Esgotado'
                    : `${brl(p.price)}${p.soldByWeight ? '/kg' : ''}`}
                </span>
                <span className="nsale__name">{p.name}</span>
              </button>
            ))
          )}
        </div>

        <section className="nsale__items" aria-label="Itens do pedido">
          <h3>Itens do pedido</h3>
          {cart.length === 0 ? (
            <div className="nsale__empty">
              <Frown size={28} aria-hidden />
              <strong>Nenhum item adicionado</strong>
              <span>Busque um produto ou toque nele na grade acima.</span>
            </div>
          ) : (
            <div className="nsale__table" role="table">
              <div className="nsale__row nsale__row--head" role="row">
                <span role="columnheader">Qtd</span>
                <span role="columnheader">Produto</span>
                <span role="columnheader">Complementos</span>
                <span role="columnheader">Unitário</span>
                <span role="columnheader">Total</span>
                <span role="columnheader" aria-label="Remover" />
              </div>
              {cart.map((l) => {
                const unit = unitCents(l.product, l.optionIds);
                const opts = l.product.optionGroups
                  .flatMap((g) => g.options)
                  .filter((o) => l.optionIds.includes(o.id));
                return (
                  <div key={l.uid} className="nsale__row" role="row">
                    <span role="cell" className="nsale__qty">
                      {l.product.soldByWeight ? (
                        <button
                          type="button"
                          className="nsale__weight"
                          aria-label={`Peso de ${l.product.name}: ${qtyLabel(l.quantity, 'kg')}. Alterar`}
                          onClick={() =>
                            setWeighing({ product: l.product, optionIds: l.optionIds, line: l })
                          }
                        >
                          <Scale size={14} aria-hidden /> {qtyLabel(l.quantity, 'kg')}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label="Diminuir"
                            onClick={() =>
                              setLine(l, l.quantity > 1 ? { quantity: l.quantity - 1 } : null)
                            }
                          >
                            <Minus size={14} />
                          </button>
                          <b>{l.quantity}</b>
                          <button
                            type="button"
                            aria-label="Aumentar"
                            onClick={() => setLine(l, { quantity: l.quantity + 1 })}
                          >
                            <Plus size={14} />
                          </button>
                        </>
                      )}
                    </span>
                    <span role="cell" className="nsale__prod">
                      <strong>{l.product.name}</strong>
                      <input
                        placeholder="Observação (ex.: sem cebola)"
                        aria-label={`Observação de ${l.product.name}`}
                        value={l.notes}
                        maxLength={200}
                        onChange={(e) => setLine(l, { notes: e.target.value })}
                      />
                    </span>
                    <span role="cell" className="nsale__opts">
                      {opts.length ? opts.map((o) => o.name).join(', ') : '—'}
                    </span>
                    <span role="cell" className="nsale__unit cm-num">
                      {brl(fromCents(unit))}
                      {l.product.soldByWeight ? '/kg' : ''}
                    </span>
                    <span role="cell" className="nsale__sum cm-num">
                      {brl(fromCents(multiplyCents(unit, l.quantity)))}
                    </span>
                    <span role="cell">
                      <button
                        type="button"
                        className="nsale__del"
                        aria-label="Remover item"
                        title="Remover item"
                        onClick={() => setLine(l, null)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="nsale__side" aria-label="Dados do pedido">
        <header className="nsale__side-head">
          <ShoppingCart size={20} aria-hidden />
          <strong>Pedido</strong>
          <span className="cm-num">{brl(fromCents(Math.max(0, total)))}</span>
        </header>

        <div className="nsale__side-body">
          <div className="nsale__group">
            <span className="nsale__label">
              <User size={16} aria-hidden /> Cliente
            </span>
            <CustomerPicker value={customer} onChange={setCustomer} />
            {!customer.id && (channel === 'delivery' || channel === 'pickup' || customer.phone) && (
              <TextField
                label="Telefone"
                value={customer.phone}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                maxLength={30}
                inputMode="tel"
              />
            )}
          </div>

          <div className="nsale__group">
            <span className="nsale__label">Tipo de atendimento</span>
            <div className="nsale__types" role="radiogroup" aria-label="Tipo de atendimento">
              {ORDER_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={channel === c}
                  className="nsale__type"
                  disabled={!!preset?.tabId && c !== 'table'}
                  onClick={() => setChannel(c)}
                >
                  {CHANNEL_ICON[c]}
                  {CHANNEL_LABELS[c]}
                </button>
              ))}
            </div>
            {channel === 'table' && !preset?.tabId && (
              <label className="cm-field">
                <span className="cm-label">Mesa</span>
                <Select
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
                </Select>
              </label>
            )}
            {channel === 'delivery' && (
              <>
                <AddressQuick value={address} onChange={setAddress} />
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
          </div>

          <div className="nsale__group">
            <TextField
              label="Desconto"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              hint="Acima de 10% exige gerente"
              error={discount && !parseBrlInput(discount) ? 'Use o formato 5,00' : undefined}
            />
            <label className="cm-field">
              <span className="cm-label">Observações do pedido</span>
              <textarea
                className="cm-input nsale__notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </label>
          </div>
        </div>

        <footer className="nsale__foot">
          <dl className="totals">
            {(discountCents > 0 || feeCents > 0) && (
              <>
                <dt>Subtotal</dt>
                <dd>{brl(fromCents(subtotal))}</dd>
              </>
            )}
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
          {(needsTable || needsAddress) && cart.length > 0 && (
            <p className="nsale__need">
              {needsTable ? 'Escolha a mesa para enviar.' : 'Informe o endereço de entrega.'}
            </p>
          )}
          <Button size="lg" block loading={busy} disabled={!canSubmit} onClick={submit}>
            Enviar pedido <kbd className="kbd nsale__kbd">Ctrl+Enter</kbd>
          </Button>
        </footer>
      </aside>

      {picking && (
        <OptionPicker
          product={picking}
          onCancel={() => setPicking(null)}
          onConfirm={(ids) => {
            add(picking, ids);
            setPicking(null);
            if (!picking.soldByWeight) searchRef.current?.focus();
          }}
        />
      )}
      {weighing && (
        <div
          className="picker"
          role="group"
          aria-label={`Peso de ${weighing.product.name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setWeighing(null);
          }}
        >
          <div className="picker__panel">
            <WeighForm
              product={weighing.product}
              kgCents={unitCents(weighing.product, weighing.optionIds)}
              initialKg={weighing.line?.quantity}
              confirmLabel={weighing.line ? 'Salvar peso' : 'Adicionar'}
              onCancel={() => setWeighing(null)}
              onConfirm={(kg) => {
                if (weighing.line) setLine(weighing.line, { quantity: kg });
                else add(weighing.product, weighing.optionIds, kg);
                setWeighing(null);
                searchRef.current?.focus();
              }}
            />
          </div>
        </div>
      )}
    </dialog>
  );
}

export function OptionPicker({
  product,
  onCancel,
  onConfirm,
}: {
  product: MenuProduct;
  onCancel(): void;
  onConfirm(ids: string[]): void;
}) {
  // Começa com as opções marcadas como padrão no cadastro do grupo.
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    const defaults = defaultOptionIds(product.optionGroups);
    return Object.fromEntries(
      product.optionGroups.map((g) => [
        g.id,
        g.options.filter((o) => defaults.includes(o.id)).map((o) => o.id),
      ]),
    );
  });
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
    <div
      className="picker"
      role="group"
      aria-label={`Opções de ${product.name}`}
      onClick={(e) => {
        // Clique no fundo escurecido fecha a escolha.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
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
