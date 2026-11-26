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
  Gift,
  HandCoins,
  Minus,
  Pencil,
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
  Check as CheckIcon,
} from 'lucide-react';
import { ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, TextField, showLiquid, useToast, Skeleton } from '../design-system';
import { useCan } from '../app/auth';
import { api, ApiError } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { newIdempotencyKey } from '../lib/idempotency';
import { isIdempotencyMismatch } from '../pages/public/checkout-retry';
import { isOfflineResult } from '../lib/offline';
import { brl, parseBrlInput } from '../lib/money';
import { mediaUrl } from '../lib/media';
import './sale-extras.css';
import { AddressQuick } from './AddressQuick';
import { CustomerPicker, type OrderCustomer } from './CustomerPicker';
import { perkQuote, SalePerks, type SalePerk } from './SalePerks';
import { WeighForm } from './WeighForm';
import { groupNeed } from '../waiter/item-editor';
import { addDays, dayKey, joinLocal } from '../pages/agenda/agenda-utils';
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

/** Dados do fiado na Nova venda (nome e WhatsApp vazios = os do cliente escolhido). */
interface FiadoDraft {
  name: string;
  phone: string;
  day: string;
  time: string;
}

/** Fiado novo: cobra amanhã às 10h. */
function newFiado(): FiadoDraft {
  return { name: '', phone: '', day: dayKey(addDays(new Date(), 1)), time: '10:00' };
}

/** O que falta para vender fiado (ou null se está tudo certo). */
function fiadoIssue(f: FiadoDraft, customer: OrderCustomer): string | null {
  if (!(f.name || customer.name).trim()) return 'Informe quem está devendo.';
  if ((f.phone || customer.phone).replace(/\D/g, '').length < 10)
    return 'Informe o WhatsApp de quem deve, com DDD.';
  const when = joinLocal(f.day, f.time);
  if (!f.day || !f.time || Number.isNaN(when.getTime()))
    return 'Escolha o dia e a hora para pagar.';
  if (when.getTime() < Date.now()) return 'O dia e a hora para pagar já passaram.';
  return null;
}

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
}: {
  open: boolean;
  onClose(): void;
  onCreated(o: Order): void;
  preset?: { channel?: OrderChannel; tableId?: string; tabId?: string; label?: string };
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
  const [customer, setCustomerState] = useState<OrderCustomer>({ id: null, name: '', phone: '' });
  /** Recompensa ou cupom do cliente escolhido usado nesta venda (sai ao trocar de cliente). */
  const [perk, setPerk] = useState<SalePerk | null>(null);
  const canPerks = useCan('orders:manage');
  function setCustomer(c: OrderCustomer) {
    if (c.id !== customer.id) setPerk(null);
    setCustomerState(c);
  }
  const [address, setAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  /** Fiado (quinta opção do atendimento): lança no balcão e cobra no dia pelo WhatsApp. */
  const canFiado = useCan('orders:cancel');
  const [fiado, setFiado] = useState<FiadoDraft | null>(null);
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
    setFiado(null);
    setError(null);
    api<DiningTable[]>('/tables')
      .then(setTables)
      .catch(() => setTables([]));
  }, [open, preset?.channel, preset?.tableId]);

  // Cardápio mudou com a venda aberta (item esgotado, preço novo): lê de novo, sem mexer no resto.
  const [menuRev, setMenuRev] = useState(0);
  useRealtime((e) => {
    if (open && e.type === 'menu.changed') setMenuRev((n) => n + 1);
  });
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
  }, [open, channel, toast, menuRev]);

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
  /** Unidades no pedido (item por peso conta como um). */
  const itemCount = cart.reduce((n, l) => n + (l.product.soldByWeight ? 1 : l.quantity), 0);
  const discountCents = toCents(parseBrlInput(discount) ?? '0');
  const typedFeeCents = channel === 'delivery' ? toCents(parseBrlInput(deliveryFee) ?? '0') : 0;
  const unitByProduct = new Map(cart.map((l) => [l.product.id, toCents(l.product.price)]));
  const perkInfo = perkQuote(perk, {
    channel,
    subtotalCents: subtotal,
    feeCents: typedFeeCents,
    unitByProduct,
  });
  // Cupom de entrega grátis zera a taxa; recompensa e outros cupons descontam dos itens.
  const feeCents = perkInfo.freeDelivery ? 0 : typedFeeCents;
  const perkCents = perkInfo.freeDelivery ? 0 : perkInfo.discountCents;
  const total = subtotal - discountCents - perkCents + feeCents;

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
    setCustomerState({ id: null, name: '', phone: '' });
    setPerk(null);
    setAddress('');
    setDeliveryFee('');
    setDiscount('');
    setNotes('');
    setFiado(null);
    setSearch('');
    setIdemKey(newIdempotencyKey());
  }

  const needsTable = channel === 'table' && !preset?.tabId && !tableId;
  const needsAddress = channel === 'delivery' && !address.trim();
  const fiadoProblem = fiado ? fiadoIssue(fiado, customer) : null;
  const perkProblem = perkInfo.problem;
  const canSubmit =
    cart.length > 0 && !needsTable && !needsAddress && !fiadoProblem && !perkProblem && total >= 0;
  const freeOrSame = tables.filter((t) => t.active);
  const tablesLabelId = useId();

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
          rewardId: perk?.kind === 'reward' ? perk.reward.id : undefined,
          couponCode: perk?.kind === 'coupon' ? perk.coupon.code : undefined,
          customerName: customer.name.trim() || undefined,
          customerPhone: customer.phone || undefined,
          deliveryAddress: channel === 'delivery' ? address : undefined,
          // A taxa vai como digitada: o servidor tira com o cupom de entrega grátis.
          deliveryFee:
            channel === 'delivery' && typedFeeCents ? fromCents(typedFeeCents) : undefined,
          discount: discountCents ? fromCents(discountCents) : undefined,
          notes: notes || undefined,
          fiado: fiado
            ? {
                name: (fiado.name || customer.name).trim(),
                phone: fiado.phone || customer.phone,
                dueAt: joinLocal(fiado.day, fiado.time).toISOString(),
              }
            : undefined,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            optionIds: l.optionIds,
            notes: l.notes || undefined,
          })),
        },
      });
      // Sem internet o pedido fica no aparelho (lib/offline.ts): o aviso sai da faixa offline.
      if (!isOfflineResult(order))
        toast(
          fiado
            ? `Fiado #${order.number} lançado: está na sua Agenda pessoal e a cobrança sai no WhatsApp no dia`
            : `Pedido #${order.number} criado`,
          'success',
        );
      reset();
      ref.current?.close();
      onCreated(order);
    } catch (e) {
      // Mantém a mesma chave: falhas não gravam a chave no servidor e, se a rede caiu
      // depois do servidor gravar, o reenvio devolve o mesmo pedido em vez de duplicar.
      // O primeiro envio já virou pedido e o carrinho mudou depois: chave nova (senão todo envio
      // seguinte falha) e aviso para conferir antes de mandar de novo.
      if (e instanceof ApiError && isIdempotencyMismatch(e)) {
        setIdemKey(newIdempotencyKey());
        setError(
          'O primeiro envio já entrou como pedido. Confira em Pedidos antes de enviar de novo.',
        );
        return;
      }
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
  const title = preset?.label ? `Novo pedido — ${preset.label}` : 'Nova venda';

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
            placeholder="Pesquisar"
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
            <Skeleton variant="grid" className="nsale__sk" />
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
                <span className="nsale__photo">
                  {p.imageId ? (
                    <img src={mediaUrl(p.imageId, 640)!} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="nsale__initials" aria-hidden>
                      {initials(p.name)}
                    </span>
                  )}
                </span>
                <span className="nsale__info">
                  <span className="nsale__name">{p.name}</span>
                  <span className="nsale__meta">
                    <span className="nsale__price" data-out={p.soldOut || undefined}>
                      {p.soldOut
                        ? p.stockOut
                          ? 'Sem estoque'
                          : 'Esgotado'
                        : `${brl(p.price)}${p.soldByWeight ? '/kg' : ''}`}
                    </span>
                    {!p.soldOut && p.points ? (
                      <span
                        className="nsale__pts"
                        title="Pontos de fidelidade que o cliente identificado ganha com este item"
                      >
                        <Gift size={12} aria-hidden />
                        <span className="cm-num">+{p.points.toLocaleString('pt-BR')}</span>
                        {p.points === 1 ? 'pt' : 'pts'}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <section className="nsale__items" aria-label="Itens do pedido">
          <header className="nsale__items-head">
            <h3>Itens do pedido</h3>
            {cart.length > 0 && (
              <>
                <span className="nsale__items-count">
                  {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                </span>
                <span className="nsale__items-sum cm-num">{brl(fromCents(subtotal))}</span>
              </>
            )}
          </header>
          {cart.length === 0 ? (
            <div className="nsale__empty">
              <Frown size={28} aria-hidden />
              <strong>Nenhum item adicionado</strong>
              <span>Busque um produto ou toque nele na grade acima.</span>
            </div>
          ) : (
            <div className="nsale__table" role="table" aria-label="Itens do pedido">
              <div className="nsale__row nsale__row--head" role="row">
                <span role="columnheader" className="nsale__c-qty">
                  Qtd
                </span>
                <span role="columnheader" className="nsale__c-prod">
                  Produto
                </span>
                <span role="columnheader" className="nsale__c-unit">
                  Unitário
                </span>
                <span role="columnheader" className="nsale__c-sum">
                  Total
                </span>
                <span role="columnheader" className="nsale__c-del">
                  <span className="cm-sr-only">Remover</span>
                </span>
              </div>
              {cart.map((l) => {
                const unit = unitCents(l.product, l.optionIds);
                const opts = l.product.optionGroups
                  .flatMap((g) => g.options)
                  .filter((o) => l.optionIds.includes(o.id));
                const perUnit = `${brl(fromCents(unit))}${l.product.soldByWeight ? '/kg' : ''}`;
                return (
                  <div key={l.uid} className="nsale__row" role="row">
                    <span role="cell" className="nsale__c-qty">
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
                        <span className="nsale__step">
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
                        </span>
                      )}
                    </span>
                    <span role="cell" className="nsale__c-prod nsale__prod">
                      <strong title={l.product.name}>{l.product.name}</strong>
                      {opts.length > 0 && (
                        <span className="nsale__opts">{opts.map((o) => o.name).join(' · ')}</span>
                      )}
                      <label className="nsale__note">
                        <Pencil size={14} aria-hidden />
                        <input
                          placeholder="Observação (ex.: sem cebola)"
                          aria-label={`Observação de ${l.product.name}`}
                          value={l.notes}
                          maxLength={200}
                          onChange={(e) => setLine(l, { notes: e.target.value })}
                        />
                      </label>
                    </span>
                    <span role="cell" className="nsale__c-unit cm-num">
                      {perUnit}
                    </span>
                    <span role="cell" className="nsale__c-sum">
                      <b className="cm-num">{brl(fromCents(multiplyCents(unit, l.quantity)))}</b>
                      {(l.product.soldByWeight || l.quantity !== 1) && (
                        <small className="nsale__each cm-num">
                          {l.product.soldByWeight ? perUnit : `${l.quantity} × ${perUnit}`}
                        </small>
                      )}
                    </span>
                    <span role="cell" className="nsale__c-del">
                      <button
                        type="button"
                        className="nsale__del"
                        aria-label="Remover item"
                        title="Remover item"
                        onClick={() => setLine(l, null)}
                      >
                        <Trash2 size={16} />
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
            {canPerks && (
              <SalePerks
                customer={customer}
                onCustomer={setCustomer}
                perk={perk}
                onPerk={setPerk}
              />
            )}
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
                  aria-checked={channel === c && !fiado}
                  className="nsale__type"
                  disabled={!!preset?.tabId && c !== 'table'}
                  onClick={() => {
                    setChannel(c);
                    setFiado(null);
                  }}
                >
                  {CHANNEL_ICON[c]}
                  {CHANNEL_LABELS[c]}
                </button>
              ))}
              {canFiado && !preset?.tabId && !preset?.tableId && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={!!fiado}
                  className="nsale__type"
                  onClick={() => {
                    setChannel('counter');
                    setFiado((f) => f ?? newFiado());
                  }}
                >
                  <HandCoins size={20} />
                  Fiado
                </button>
              )}
            </div>
            {fiado && (
              <div className="nsale__fiado">
                <TextField
                  label="Quem está devendo"
                  value={fiado.name || customer.name}
                  maxLength={80}
                  onChange={(e) => setFiado({ ...fiado, name: e.target.value })}
                />
                <TextField
                  label="WhatsApp de quem deve"
                  type="tel"
                  inputMode="tel"
                  placeholder="(11) 91234-5678"
                  value={fiado.phone || customer.phone}
                  onChange={(e) => setFiado({ ...fiado, phone: e.target.value })}
                />
                <div className="nsale__fiado-when">
                  <TextField
                    label="Dia para pagar"
                    type="date"
                    value={fiado.day}
                    min={dayKey(new Date())}
                    onChange={(e) => setFiado({ ...fiado, day: e.target.value })}
                  />
                  <TextField
                    label="Hora da cobrança"
                    type="time"
                    value={fiado.time}
                    onChange={(e) => setFiado({ ...fiado, time: e.target.value })}
                  />
                </div>
                <p className="cm-hint">
                  Vai para a sua Agenda pessoal com a tag Fiado. No dia e hora, o WhatsApp do
                  restaurante manda a cobrança para o cliente (se ainda não tiver pago).
                </p>
              </div>
            )}
            {channel === 'table' && !preset?.tabId && (
              <div className="nsale__tables-wrap">
                <span className="nsale__label" id={tablesLabelId}>
                  Mesa
                </span>
                {freeOrSame.length === 0 ? (
                  <p className="cm-hint">Nenhuma mesa cadastrada. Crie as mesas no Salão.</p>
                ) : (
                  <div className="nsale__tables" role="radiogroup" aria-labelledby={tablesLabelId}>
                    {freeOrSame.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={tableId === t.id}
                        aria-label={`Mesa ${t.label} ${t.tabId ? 'ocupada' : 'livre'}`}
                        className="nsale__tbl"
                        data-busy={t.tabId ? 'true' : undefined}
                        onClick={() => setTableId(t.id)}
                      >
                        <span className="nsale__tbl-name">{t.label}</span>
                        <span className="nsale__tbl-state">{t.tabId ? 'Ocupada' : 'Livre'}</span>
                        {t.tabId && <span className="nsale__tbl-total">{brl(t.tabTotal)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
            {(discountCents > 0 || perkInfo.discountCents > 0 || feeCents > 0) && (
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
            {perk && perkInfo.discountCents > 0 && (
              <>
                <dt>
                  {perk.kind === 'reward'
                    ? `Recompensa: ${perk.reward.name}`
                    : `Cupom ${perk.coupon.code}`}
                </dt>
                <dd>
                  {perkInfo.freeDelivery
                    ? 'Entrega grátis'
                    : `− ${brl(fromCents(perkInfo.discountCents))}`}
                </dd>
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
          {(needsTable || needsAddress || fiadoProblem || perkProblem) && cart.length > 0 && (
            <p className="nsale__need">
              {needsTable
                ? 'Escolha a mesa para enviar.'
                : needsAddress
                  ? 'Informe o endereço de entrega.'
                  : (fiadoProblem ?? perkProblem)}
            </p>
          )}
          <Button size="lg" block loading={busy} disabled={!canSubmit} onClick={submit}>
            {fiado ? 'Vender fiado' : 'Enviar pedido'}{' '}
            <kbd className="kbd nsale__kbd">Ctrl+Enter</kbd>
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
  const ids = Object.values(sel).flat();
  const valid = product.optionGroups.every((g) => {
    const n = sel[g.id]?.length ?? 0;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  // Grupos obrigatórios (mínimo no cadastro do grupo) que ainda faltam: travam o Adicionar.
  const missing = product.optionGroups.filter((g) => (sel[g.id]?.length ?? 0) < g.minSelect);
  const [tried, setTried] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  function confirm() {
    if (valid) return onConfirm(ids);
    setTried(true);
    panel.current
      ?.querySelector(`[data-group="${missing[0]?.id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
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
      <div className="picker__panel" ref={panel}>
        <h3 style={{ margin: 0 }}>{product.name}</h3>
        {product.optionGroups.map((g) => {
          const single = g.minSelect === 1 && g.maxSelect === 1;
          const need = groupNeed(g, sel[g.id]?.length ?? 0);
          return (
            <fieldset
              key={g.id}
              className="picker__group"
              data-group={g.id}
              data-need={need}
              data-late={(tried && need === 'required') || undefined}
            >
              <legend>
                <span className="picker__name">
                  {g.name}{' '}
                  <span className="cm-hint">
                    {single
                      ? 'escolha 1'
                      : g.minSelect > 0
                        ? g.minSelect === g.maxSelect
                          ? `escolha ${g.minSelect}`
                          : `escolha de ${g.minSelect} a ${g.maxSelect}`
                        : `até ${g.maxSelect}`}
                  </span>
                </span>
                <span className="picker__need" data-need={need}>
                  {need === 'done' ? (
                    <>
                      <CheckIcon size={12} strokeWidth={3} aria-hidden /> Obrigatório
                    </>
                  ) : need === 'required' ? (
                    'Obrigatório'
                  ) : (
                    'Opcional'
                  )}
                </span>
              </legend>
              {g.options.map((o) => {
                const on = sel[g.id]?.includes(o.id) ?? false;
                // Complemento com ficha técnica sem estoque: aparece, mas não dá para escolher.
                const out = !!o.stockOut && !on;
                return (
                  <label key={o.id} className="picker__opt" data-out={out || undefined}>
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={g.id}
                      checked={on}
                      disabled={out}
                      onChange={() => toggle(g.id, o.id, single)}
                    />
                    <span>{o.name}</span>
                    {out ? (
                      <span className="picker__out">Sem estoque</span>
                    ) : (
                      toCents(o.priceDelta) > 0 && (
                        <span className="cm-hint">+ {brl(o.priceDelta)}</span>
                      )
                    )}
                  </label>
                );
              })}
            </fieldset>
          );
        })}
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
        >
          <span className="picker__total">
            <strong>{brl(fromCents(unitCents(product, ids)))}</strong>
            {missing.length > 0 && (
              <span className="picker__missing" role="status">
                Escolha {missing.map((g) => g.name).join(', ')}
              </span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              aria-disabled={!valid || undefined}
              data-blocked={!valid || undefined}
              onClick={confirm}
            >
              Adicionar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
