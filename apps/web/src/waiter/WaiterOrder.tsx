import { fromCents, multiplyCents, qtyLabel, toCents, type OrderChannel } from '@comandou/shared';
import { Minus, Pencil, Plus, Scale, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ItemThumb,
  Modal,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { api, ApiError } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { newIdempotencyKey } from '../lib/idempotency';
import { isIdempotencyMismatch } from '../pages/public/checkout-retry';
import { isOfflineResult } from '../lib/offline';
import { mediaUrl } from '../lib/media';
import { brl, parseBrlInput } from '../lib/money';
import type { DiningTable, MenuCategory, MenuProduct, Order, Tab } from '../lib/types';
import { useWaiterStats, useWide, WaiterHead } from './common';
import { AddressQuick } from '../features/AddressQuick';
import { WeighForm } from '../features/WeighForm';
import { ItemEditor, type ItemDraft } from './ItemEditor';
import { unitCents } from './item-editor';

interface Line {
  /** Identidade estável da linha (a observação muda enquanto se digita). */
  uid: number;
  key: string;
  product: MenuProduct;
  optionIds: string[];
  quantity: number;
  notes: string;
}

let nextLineId = 1;

interface Weighing {
  product: MenuProduct;
  optionIds: string[];
  notes?: string;
  line?: Line;
}

/** Item aberto na tela de edição: produto novo ou uma linha do pedido para mudar. */
interface Editing {
  product: MenuProduct;
  line?: Line;
  /** Veio da folha do pedido (celular): volta para ela ao terminar. */
  fromCart?: boolean;
}

const lineKey = (productId: string, optionIds: string[]) =>
  `${productId}:${[...optionIds].sort().join(',')}`;

/** Itens da linha para os contadores: item por peso conta como 1 (uma pesagem). */
const lineCount = (l: Line) => (l.product.soldByWeight ? 1 : l.quantity);

/**
 * Lançar pedido (como a lista de produtos do Anota AI): categorias no topo, produtos com foto,
 * nome e preço. Mesa (?mesa=), comanda (?comanda=), delivery ou para levar (?tipo=).
 * O garçom não dá desconto: isso fica com o caixa.
 */
export function WaiterOrder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const wide = useWide();
  const { reload: reloadStats } = useWaiterStats();
  const tableId = params.get('mesa');
  const tabId = params.get('comanda');
  const tipo = params.get('tipo');
  const channel: OrderChannel =
    tipo === 'delivery' ? 'delivery' : tipo === 'retirada' ? 'pickup' : 'table';

  const [menu, setMenu] = useState<MenuCategory[] | null>(null);
  const [label, setLabel] = useState(
    channel === 'delivery' ? 'Delivery' : channel === 'pickup' ? 'Para levar' : 'Pedido',
  );
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** Item por peso esperando o peso da balança (ou a linha cujo peso vai mudar). */
  const [weighing, setWeighing] = useState<Weighing | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '', fee: '' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Uma chave por pedido: reenvio depois de falha de rede não duplica.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const listRef = useRef<HTMLDivElement>(null);

  // Cardápio mudou com a tela aberta (item esgotado, preço novo): lê de novo sem trocar a categoria.
  useRealtime((e) => {
    if (e.type !== 'menu.changed') return;
    api<MenuCategory[]>(`/menu?channel=${channel}`).then(
      (m) => {
        const withProducts = m.filter((c) => c.products.length > 0);
        setMenu(withProducts);
        setActive((a) =>
          a && withProducts.some((c) => c.id === a) ? a : (withProducts[0]?.id ?? null),
        );
      },
      () => undefined,
    );
  });

  useEffect(() => {
    api<MenuCategory[]>(`/menu?channel=${channel}`).then(
      (m) => {
        const withProducts = m.filter((c) => c.products.length > 0);
        setMenu(withProducts);
        setActive(withProducts[0]?.id ?? null);
      },
      (e: Error) => setError(e.message),
    );
    if (tableId)
      api<DiningTable[]>('/tables').then(
        (ts) => {
          const t = ts.find((x) => x.id === tableId);
          if (t) setLabel(`Mesa ${t.label}`);
        },
        () => undefined,
      );
    if (tabId)
      api<Tab>(`/tabs/${tabId}`).then(
        (t) => setLabel(t.tableLabel ? `Mesa ${t.tableLabel}` : `Comanda ${t.number}`),
        () => undefined,
      );
  }, [tableId, tabId]);

  const shown = useMemo(() => {
    const all = menu ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return all;
    return all
      .map((c) => ({
        ...c,
        products: c.products.filter(
          (p) =>
            p.name.toLowerCase().includes(s) || (p.description ?? '').toLowerCase().includes(s),
        ),
      }))
      .filter((c) => c.products.length > 0);
  }, [menu, search]);

  // Categoria ativa acompanha a rolagem da lista.
  useEffect(() => {
    const root = listRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.getAttribute('data-cat'));
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    root.querySelectorAll('[data-cat]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown]);

  function jump(id: string) {
    setActive(id);
    document.getElementById(`wt-cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function add(p: MenuProduct, optionIds: string[] = [], kg?: number, qty = 1, notes = '') {
    const key = lineKey(p.id, optionIds);
    if (p.soldByWeight) {
      // Cada pesagem vira uma linha: dois pratos são duas linhas com pesos diferentes.
      if (kg === undefined) return setWeighing({ product: p, optionIds, notes });
      setCart((c) => [
        ...c,
        { uid: nextLineId++, key, product: p, optionIds, quantity: kg, notes },
      ]);
      return;
    }
    setCart((c) => {
      // Mesma escolha e sem observação soma na linha que já existe.
      const found = !notes && c.find((l) => l.key === key && !l.notes);
      if (found) return c.map((l) => (l === found ? { ...l, quantity: l.quantity + qty } : l));
      return [...c, { uid: nextLineId++, key, product: p, optionIds, quantity: qty, notes }];
    });
  }
  /** Tocar no produto abre a tela de edição do item (opções, retirar, observação, quantidade). */
  function choose(p: MenuProduct) {
    if (p.soldOut) return;
    setEditing({ product: p });
  }
  /** O + do contador repete o item direto quando não há o que escolher. */
  function more(p: MenuProduct) {
    if (p.soldOut) return;
    if (p.optionGroups.length || p.soldByWeight) setEditing({ product: p });
    else add(p);
  }
  function editLine(l: Line, fromCart = false) {
    if (fromCart) setCartOpen(false);
    setEditing({ product: l.product, line: l, fromCart });
  }
  function closeEditor() {
    if (editing?.fromCart) setCartOpen(true);
    setEditing(null);
  }
  function saveItem(d: ItemDraft) {
    const e = editing;
    if (!e) return;
    const notes = d.notes.trim();
    if (e.line) {
      const uid = e.line.uid;
      setCart((c) =>
        c.map((x) =>
          x.uid === uid
            ? {
                ...x,
                key: lineKey(x.product.id, d.optionIds),
                optionIds: d.optionIds,
                quantity: x.product.soldByWeight ? x.quantity : d.quantity,
                notes,
              }
            : x,
        ),
      );
    } else add(e.product, d.optionIds, undefined, d.quantity, notes);
    closeEditor();
  }
  /** Quantidade do produto no carrinho (todas as variações; item por peso conta as pesagens). */
  const inCart = (id: string) =>
    cart.filter((l) => l.product.id === id).reduce((s, l) => s + lineCount(l), 0);
  function decProduct(id: string) {
    setCart((c) => {
      const last = [...c].reverse().find((l) => l.product.id === id);
      if (!last) return c;
      return last.quantity > 1 && !last.product.soldByWeight
        ? c.map((l) => (l === last ? { ...l, quantity: l.quantity - 1 } : l))
        : c.filter((l) => l !== last);
    });
  }

  const count = cart.reduce((s, l) => s + lineCount(l), 0);
  const subtotal = cart.reduce(
    (s, l) => s + multiplyCents(unitCents(l.product, l.optionIds), l.quantity),
    0,
  );
  const feeCents = channel === 'delivery' ? toCents(parseBrlInput(customer.fee) ?? '0') : 0;
  const total = subtotal + feeCents;
  const missing =
    channel === 'delivery' && !customer.address.trim()
      ? 'Informe o endereço de entrega'
      : channel === 'table' && !tableId && !tabId
        ? 'Escolha a mesa no mapa'
        : null;

  async function submit() {
    // Trava contra toque duplo: o estado `busy` só chega na próxima renderização.
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setSendError(null);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        json: {
          channel,
          tabId: tabId ?? undefined,
          tableId: channel === 'table' && !tabId ? (tableId ?? undefined) : undefined,
          customerName: customer.name.trim() || undefined,
          customerPhone: channel !== 'table' ? customer.phone.trim() || undefined : undefined,
          deliveryAddress: channel === 'delivery' ? customer.address.trim() : undefined,
          deliveryFee: feeCents ? fromCents(feeCents) : undefined,
          notes: notes.trim() || undefined,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            optionIds: l.optionIds,
            notes: l.notes.trim() || undefined,
          })),
        },
      });
      // Sem internet o pedido fica no aparelho (lib/offline.ts): o aviso sai da faixa offline.
      if (!isOfflineResult(order)) toast(`Pedido #${order.number} enviado`, 'success');
      setCart([]);
      setIdemKey(newIdempotencyKey());
      reloadStats();
      if (order.tabId) navigate(`/garcom/comanda/${order.tabId}`, { replace: true });
      else navigate('/garcom/pedidos', { replace: true });
    } catch (e) {
      // Mantém a chave: se o servidor já gravou, o reenvio devolve o mesmo pedido.
      // O primeiro envio já virou pedido e o carrinho mudou depois: chave nova (senão todo envio
      // seguinte falha) e aviso para conferir antes de mandar de novo.
      if (e instanceof ApiError && isIdempotencyMismatch(e)) {
        setIdemKey(newIdempotencyKey());
        setSendError(
          'O primeiro envio já entrou como pedido. Confira em Pedidos antes de enviar de novo.',
        );
        return;
      }
      setSendError(
        e instanceof ApiError && e.status === 0
          ? 'Sem conexão. Toque em enviar de novo: o pedido não será duplicado.'
          : (e as Error).message,
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const back = tabId ? `/garcom/comanda/${tabId}` : '/garcom/mesas';
  const cartBody = (
    <CartContent
      cart={cart}
      setCart={setCart}
      onWeigh={setWeighing}
      onEdit={(l) => editLine(l, !wide)}
      channel={channel}
      customer={customer}
      setCustomer={setCustomer}
      notes={notes}
      setNotes={setNotes}
      subtotal={subtotal}
      feeCents={feeCents}
    />
  );
  const sendButton = (
    <Button
      size="lg"
      block={wide}
      loading={busy}
      disabled={!cart.length || !!missing}
      onClick={submit}
    >
      Enviar pedido · {brl(fromCents(total))}
    </Button>
  );

  return (
    <div className="wt-order" data-wide={wide || undefined}>
      <div className="wt-order__menu">
        <WaiterHead title={label} sub="Toque nos produtos para adicionar" back={back}>
          <button
            type="button"
            className="wt-icon-btn"
            aria-label={searching ? 'Fechar busca' : 'Buscar produto'}
            aria-pressed={searching}
            onClick={() => {
              setSearching((s) => !s);
              setSearch('');
            }}
          >
            {searching ? <X size={20} /> : <Search size={20} />}
          </button>
        </WaiterHead>
        <div className="wt-cats-bar">
          {searching && (
            <label className="wt-search">
              <Search size={18} aria-hidden />
              <input
                autoFocus
                placeholder="Pesquisar"
                aria-label="Buscar produto"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
          {!search && (
            <div className="wt-cats" role="tablist" aria-label="Categorias">
              {(menu ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active === c.id}
                  className="wt-cat"
                  onClick={() => jump(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="wt-products" ref={listRef}>
          {menu === null ? (
            <Skeleton variant="grid" />
          ) : shown.length === 0 ? (
            <EmptyState title={search ? 'Nenhum produto encontrado' : 'Cardápio vazio'} />
          ) : (
            shown.map((c) => (
              <section key={c.id} id={`wt-cat-${c.id}`} data-cat={c.id} className="wt-cat-sec">
                <h2 className="wt-cat-sec__title">{c.name}</h2>
                {c.products.map((p) => {
                  const n = inCart(p.id);
                  return (
                    <div key={p.id} className="wt-product" data-sold-out={p.soldOut || undefined}>
                      <button
                        type="button"
                        className="wt-product__main"
                        disabled={p.soldOut}
                        onClick={() => choose(p)}
                        aria-label={`Adicionar ${p.name}`}
                      >
                        {p.imageId ? (
                          <img
                            className="wt-product__img"
                            src={mediaUrl(p.imageId, 640)!}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="wt-product__img wt-product__img--empty" aria-hidden>
                            {p.name.slice(0, 1)}
                          </span>
                        )}
                        <span className="wt-product__text">
                          <strong>{p.name}</strong>
                          {p.description && <span>{p.description}</span>}
                          {p.soldByWeight ? (
                            <em>por peso</em>
                          ) : (
                            p.optionGroups.length > 0 && <em>com opções</em>
                          )}
                        </span>
                        <span className="wt-product__price">
                          {p.soldOut ? (
                            <Badge tone="danger">{p.stockOut ? 'Sem estoque' : 'Esgotado'}</Badge>
                          ) : (
                            `${brl(p.price)}${p.soldByWeight ? '/kg' : ''}`
                          )}
                        </span>
                      </button>
                      {n > 0 && (
                        <span className="wt-stepper" aria-label={`${n} no pedido`}>
                          <button
                            type="button"
                            aria-label={`Tirar um ${p.name}`}
                            onClick={() => decProduct(p.id)}
                          >
                            {n > 1 ? <Minus size={16} /> : <Trash2 size={16} />}
                          </button>
                          <span>{n}</span>
                          <button
                            type="button"
                            aria-label={`Mais um ${p.name}`}
                            onClick={() => more(p)}
                          >
                            <Plus size={16} />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>

      {wide ? (
        <aside className="wt-order__cart" aria-label="Pedido">
          <h2 className="wt-order__cart-title">
            <ShoppingBag size={18} /> Pedido · {label}
          </h2>
          {cartBody}
          {(missing || sendError) && cart.length > 0 && (
            <Alert tone={sendError ? 'danger' : 'warning'}>{sendError ?? missing}</Alert>
          )}
          {sendButton}
        </aside>
      ) : (
        count > 0 && (
          <div className="wt-dock">
            <button type="button" className="wt-cartbar" onClick={() => setCartOpen(true)}>
              <span className="wt-cartbar__count">{count}</span>
              <span>Ver pedido</span>
              <strong>{brl(fromCents(subtotal))}</strong>
            </button>
          </div>
        )
      )}

      {!wide && (
        <Modal
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          title={`Pedido · ${label}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCartOpen(false)}>
                Adicionar mais
              </Button>
              {sendButton}
            </>
          }
        >
          {cartBody}
          {(missing || sendError) && cart.length > 0 && (
            <Alert tone={sendError ? 'danger' : 'warning'}>{sendError ?? missing}</Alert>
          )}
        </Modal>
      )}

      <ItemEditor
        product={editing?.product ?? null}
        initial={
          editing?.line
            ? {
                optionIds: editing.line.optionIds,
                quantity: editing.line.quantity,
                notes: editing.line.notes,
              }
            : null
        }
        onClose={closeEditor}
        onConfirm={saveItem}
      />
      <Modal
        open={!!weighing}
        onClose={() => setWeighing(null)}
        title={weighing?.line ? 'Alterar peso' : 'Pesar'}
      >
        {weighing && (
          <WeighForm
            product={weighing.product}
            kgCents={unitCents(weighing.product, weighing.optionIds)}
            initialKg={weighing.line?.quantity}
            confirmLabel={weighing.line ? 'Salvar peso' : 'Adicionar'}
            onCancel={() => setWeighing(null)}
            onConfirm={(kg) => {
              const line = weighing.line;
              if (line)
                setCart((c) => c.map((x) => (x.uid === line.uid ? { ...x, quantity: kg } : x)));
              else add(weighing.product, weighing.optionIds, kg, 1, weighing.notes ?? '');
              setWeighing(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function CartContent({
  cart,
  setCart,
  onWeigh,
  onEdit,
  channel,
  customer,
  setCustomer,
  notes,
  setNotes,
  subtotal,
  feeCents,
}: {
  cart: Line[];
  setCart: Dispatch<SetStateAction<Line[]>>;
  onWeigh(w: Weighing): void;
  onEdit(l: Line): void;
  channel: OrderChannel;
  customer: { name: string; phone: string; address: string; fee: string };
  setCustomer: Dispatch<
    SetStateAction<{ name: string; phone: string; address: string; fee: string }>
  >;
  notes: string;
  setNotes(v: string): void;
  subtotal: number;
  feeCents: number;
}) {
  const set = (k: keyof typeof customer) => (e: ChangeEvent<HTMLInputElement>) =>
    setCustomer((c) => ({ ...c, [k]: e.target.value }));
  if (!cart.length)
    return (
      <EmptyState
        icon={<ShoppingBag size={20} />}
        title="Nenhum item ainda"
        description="Toque nos produtos para montar o pedido."
      />
    );
  return (
    <div className="wt-cart">
      <ul className="wt-cart__lines">
        {cart.map((l) => {
          const opts = l.product.optionGroups
            .flatMap((g) => g.options)
            .filter((o) => l.optionIds.includes(o.id));
          return (
            <li key={l.uid} className="wt-cart__line">
              <div className="wt-cart__top">
                {l.product.soldByWeight ? (
                  <span className="wt-weight">
                    <button
                      type="button"
                      className="wt-weight__btn"
                      aria-label={`Peso de ${l.product.name}: ${qtyLabel(l.quantity, 'kg')}. Alterar`}
                      onClick={() =>
                        onWeigh({ product: l.product, optionIds: l.optionIds, line: l })
                      }
                    >
                      <Scale size={14} aria-hidden /> {qtyLabel(l.quantity, 'kg')}
                    </button>
                    <button
                      type="button"
                      className="wt-weight__del"
                      aria-label={`Tirar ${l.product.name}`}
                      onClick={() => setCart((c) => c.filter((x) => x !== l))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                ) : (
                  <span className="wt-stepper wt-stepper--sm">
                    <button
                      type="button"
                      aria-label="Diminuir"
                      onClick={() =>
                        setCart((c) =>
                          l.quantity > 1
                            ? c.map((x) => (x === l ? { ...x, quantity: x.quantity - 1 } : x))
                            : c.filter((x) => x !== l),
                        )
                      }
                    >
                      {l.quantity > 1 ? <Minus size={14} /> : <Trash2 size={14} />}
                    </button>
                    <span>{l.quantity}</span>
                    <button
                      type="button"
                      aria-label="Aumentar"
                      onClick={() =>
                        setCart((c) =>
                          c.map((x) => (x === l ? { ...x, quantity: x.quantity + 1 } : x)),
                        )
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  className="wt-cart__edit"
                  aria-label={`Editar ${l.product.name}`}
                  onClick={() => onEdit(l)}
                >
                  <ItemThumb src={mediaUrl(l.product.imageId)} name={l.product.name} size={36} />
                  <span className="wt-cart__name">
                    <strong>
                      {l.product.name} <Pencil size={12} aria-hidden />
                    </strong>
                    {opts.length > 0 && <span>{optionsText(l.product, l.optionIds)}</span>}
                  </span>
                </button>
                <span className="wt-cart__price">
                  {brl(fromCents(multiplyCents(unitCents(l.product, l.optionIds), l.quantity)))}
                </span>
              </div>
              <input
                className="cm-input wt-cart__note"
                placeholder="Observação (ex.: sem cebola)"
                aria-label={`Observação de ${l.product.name}`}
                value={l.notes}
                maxLength={200}
                onChange={(e) =>
                  setCart((c) => c.map((x) => (x === l ? { ...x, notes: e.target.value } : x)))
                }
              />
            </li>
          );
        })}
      </ul>
      {channel !== 'table' && (
        <div className="wt-cart__fields">
          <TextField
            label="Nome do cliente"
            value={customer.name}
            onChange={set('name')}
            maxLength={80}
          />
          <TextField
            label="Telefone"
            value={customer.phone}
            onChange={set('phone')}
            maxLength={30}
            inputMode="tel"
          />
          {channel === 'delivery' && (
            <>
              <AddressQuick
                value={customer.address}
                onChange={(address) => setCustomer((c) => ({ ...c, address }))}
              />
              <TextField
                label="Taxa de entrega"
                value={customer.fee}
                onChange={set('fee')}
                inputMode="decimal"
                placeholder="0,00"
                error={
                  customer.fee && !parseBrlInput(customer.fee) ? 'Use o formato 5,00' : undefined
                }
              />
            </>
          )}
        </div>
      )}
      <TextField
        label="Observação do pedido"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
      />
      <dl className="wt-cart__totals">
        <dt>Subtotal</dt>
        <dd>{brl(fromCents(subtotal))}</dd>
        {feeCents > 0 && (
          <>
            <dt>Entrega</dt>
            <dd>{brl(fromCents(feeCents))}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Opções escolhidas em texto curto: "Ao ponto, + Bacon extra, sem Cebola". */
function optionsText(p: MenuProduct, optionIds: string[]) {
  return p.optionGroups
    .flatMap((g) =>
      g.options
        .filter((o) => optionIds.includes(o.id))
        .map((o) =>
          g.kind === 'remove'
            ? /^sem\b/i.test(o.name)
              ? o.name
              : `sem ${o.name}`
            : g.kind === 'additional' && g.maxSelect > 1
              ? `+ ${o.name}`
              : o.name,
        ),
    )
    .join(', ');
}
