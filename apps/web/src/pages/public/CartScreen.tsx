import { AddressEdit } from './AddressEdit';
import { AddressFields, addressPayload } from './AddressFields';
import { fromCents, isValidCpf, toCents } from '@comandou/shared';
import {
  Bike,
  ChevronRight,
  HandPlatter,
  Loader2,
  LockKeyhole,
  MapPin,
  Moon,
  Pencil,
  Plus,
  Store,
  UserRound,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { SlideTabs } from '../../features/SlideTabs';
import { MotoboyArt, PickupArt, WaiterArt } from './art';
import { CustomerAvatar } from './avatars';
import { reducedMotion } from './morph';
import { OrderSent } from './OrderSent';
import {
  CardFields,
  cardMissing,
  EMPTY_CARD,
  encryptCard,
  PayerFields,
  payerMissing,
  payOnline,
  SecureNote,
  type CardInput,
  type PayerInput,
} from './OnlinePay';
import { prefetchOrder } from './PublicOrderPage';
import { isIdempotencyMismatch } from './checkout-retry';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { brl, parseBrlInput } from '../../lib/money';
import { useStore } from './context';
import { track } from './pixel';
import { LoyaltyCheckout, useLoyalty } from './LoyaltyScreens';
import {
  addressLine,
  CustomerInfo,
  fmtPhone,
  lineTotal,
  maskPhone,
  newOrderToken,
  PAYMENT_OPTIONS,
  PinnedQuote,
  rememberOrder,
  rewardDiscount,
  SavedAddress,
  StoreChannel,
  tableServiceFee,
  useStored,
} from './store';
import { minOrderOf, useChannel } from './Shell';
import { Field, Photo, ScreenHeader, Stepper, Switch } from './ui';

/** Mapa do endereço (Leaflet): só carrega nas lojas com áreas de entrega. */
const AddressPin = lazy(() => import('./AddressPin'));

/** Sacola e finalização: com a conta aberta, nome, telefone e endereços já vêm preenchidos. */
/** "52998224725" → "529.982.247-25", enquanto digita. */
function maskCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function CartScreen() {
  const {
    menu,
    cart,
    setCart,
    customer,
    setCustomer,
    account,
    setAccount,
    subtotal,
    count,
    product,
    refreshStatus,
    refreshMenu,
    refreshLoyalty,
    table,
    leaveTable,
    here,
    setHere,
    rules,
  } = useStore();
  const loyalty = useLoyalty();
  const [rewardId, setRewardId] = useState<string | null>(null);
  const navigate = useNavigate();
  // "Finalizar pedido" na sacola ao lado (notebook) já abre a finalização.
  const jumpToCheckout = !!(useLocation().state as { checkout?: boolean } | null)?.checkout;
  const [step, setStep] = useState<'cart' | 'checkout'>(() =>
    jumpToCheckout && cart.length > 0 ? 'checkout' : 'cart',
  );
  // Pixel: abriu a sacola e foi para a finalização.
  useEffect(() => {
    if (cart.length)
      track(step === 'cart' ? 'view_cart' : 'begin_checkout', {
        value: subtotal / 100,
        quantity: count,
      });
    // Só quando muda de passo (não a cada item mexido).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  // Observação e troco ficam guardados: sair para entrar na conta e voltar não apaga.
  const [notes, setNotes] = useStored('cm-cart-notes', '');
  // Na mesa: pagar agora pelo Pix do cardápio ou no fim, com o garçom (o padrão de sempre).
  const [tablePay, setTablePay] = useStored<'later' | 'pix'>('cm-table-pay', 'later');
  const [changeFor, setChangeFor] = useStored('cm-cart-change', '');
  // Crédito pago agora pelo app (PagBank) ou na entrega. O cartão fica só na memória.
  const [payInApp, setPayInApp] = useStored('cm-pay-in-app', true);
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [payer, setPayer] = useState<PayerInput>({ cpf: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** O primeiro envio já virou pedido (a resposta não voltou e a sacola mudou depois). */
  const [already, setAlready] = useState<{ token: string; number?: number } | null>(null);
  // Pedido que acabou de entrar: mostra a comemoração antes de abrir o acompanhamento.
  const [sent, setSent] = useState<{
    number: number;
    token: string;
    total: string;
    channel: StoreChannel;
    awaiting: boolean;
    note?: string;
  } | null>(null);
  // Tocou em "Fazer pedido" com algo faltando: marca o que falta e treme o primeiro bloco.
  const [tried, setTried] = useState(false);
  const sections = {
    who: useRef<HTMLElement>(null),
    address: useRef<HTMLElement>(null),
    pay: useRef<HTMLElement>(null),
  };
  const me = account?.customer ?? null;
  // E-mail da conta já vem no pagamento pelo app.
  useEffect(() => {
    if (me?.email) setPayer((p) => (p.email ? p : { ...p, email: me.email! }));
  }, [me?.email]);
  const saved = account?.addresses ?? [];
  const [addrId, setAddrId] = useState<string | 'new'>('new');
  // Endereço salvo aberto para editar ali mesmo, na sacola.
  const [editingAddr, setEditingAddr] = useState<string | null>(null);
  const [saveAddr, setSaveAddr] = useState(true);
  // Mesma chave e mesmo token em cada nova tentativa: reenviar não duplica o pedido.
  const attempt = useRef<{ key: string; token: string } | null>(null);
  // Trava contra toque duplo: o estado `busy` só chega na próxima renderização.
  const sending = useRef(false);

  // Abriu a sacola: confere preços e esgotados com o cardápio de agora.
  useEffect(() => {
    void refreshMenu();
  }, [refreshMenu]);

  useEffect(() => {
    if (saved.length && addrId === 'new')
      setAddrId((saved.find((a) => a.isDefault) ?? saved[0]!).id);
    // Só quando a lista de endereços chega.
  }, [saved.length]);

  const s = menu.store;
  // Na mesa (QR Code) o pedido é sempre para ela; fora, entrega ou retirada.
  const { channels, channel } = useChannel();
  const atTable = channel === 'table';
  const zones = !!s.deliveryZones && channel === 'delivery';
  const [pinned, setPinned] = useState<PinnedQuote | null>(null);
  const zoneFee = zones && pinned?.quote.covered ? pinned.quote.fee : null;
  const fee = channel === 'delivery' ? toCents(zoneFee ?? s.deliveryFee) : 0;
  // Recompensa da fidelidade: sai do valor dos itens (a API confere saldo e valor de novo).
  const reward = rewardId ? loyalty?.rewards.find((r) => r.id === rewardId) : undefined;
  const rewardCents =
    reward && loyalty?.account && loyalty.account.balance >= reward.cost
      ? (rewardDiscount(reward, cart, subtotal) ?? 0)
      : 0;
  // Mesa com taxa de serviço: a comanda cobra a taxa sobre os itens (a API faz a mesma conta).
  const serviceFee = atTable
    ? tableServiceFee(subtotal - rewardCents, table?.serviceFeePercent)
    : 0;
  const total = subtotal - rewardCents + fee + serviceFee;
  const minOrder = (zones && pinned?.quote.minOrder) || s.minOrder;
  const belowMin = !atTable && subtotal < toCents(minOrder);
  const set = <K extends keyof CustomerInfo>(k: K, v: CustomerInfo[K]) =>
    setCustomer((c) => ({ ...c, [k]: v }));

  const name = me?.name ?? customer.customerName;
  const phone = me ? fmtPhone(me.phone) : customer.customerPhone;
  const chosen: SavedAddress | undefined =
    addrId !== 'new' ? saved.find((a) => a.id === addrId) : undefined;
  const phoneDigits = phone.replace(/\D/g, '').length;
  // Na mesa o telefone é opcional (o garçom leva até ela); se digitar, tem de estar completo.
  const phoneOk = phoneDigits >= 10 || (atTable && phoneDigits === 0);
  // Na mesa o CPF é obrigatório (vai para a nota fiscal da conta).
  const cpfDigits = (customer.customerCpf ?? '').replace(/\D/g, '');
  const cpfOk = !atTable || isValidCpf(cpfDigits);
  const typedOk = !!(customer.street.trim() && customer.number.trim() && customer.district.trim());
  // Com áreas no mapa, o endereço só vale depois de achar o ponto dentro de uma área.
  const pinOk = !zones || !!pinned?.quote.covered;
  const addressOk = channel !== 'delivery' || ((!!chosen || typedOk) && pinOk);
  // Pix pelo cardápio: o cliente paga agora pelo QR Code e anexa o comprovante. Na mesa também,
  // se quiser (senão paga no fim, com o garçom).
  // Pagamento pelo app (PagBank conectado), na entrega e na retirada: cartão de crédito agora e
  // Pix automático (no lugar do Pix com comprovante).
  const op = !atTable ? (menu.onlinePay ?? null) : null;
  const cardApp = !!op?.card && customer.paymentMethod === 'credit' && payInApp;
  const pixApp = !!op?.pix && customer.paymentMethod === 'pix';
  const payApp = cardApp || pixApp;
  const appLogin = payApp && !me;
  const pixOnline = !!menu.pix && !(op?.pix && !atTable);
  const pixChosen = pixOnline && (atTable ? tablePay === 'pix' : customer.paymentMethod === 'pix');
  // O Pix pelo cardápio pede a conta aberta: o comprovante fica com quem pagou.
  const pixLogin = pixChosen && !me;
  const changeCents = toCents(parseBrlInput(changeFor) ?? '0');
  const changeOk =
    atTable || customer.paymentMethod !== 'cash' || !changeFor || changeCents >= total;
  const soldOut = cart.filter((l) => product(l.productId)?.soldOut);
  // O que impede o pedido e não depende do cliente digitar: o botão fica desligado.
  const blocked = !channel || belowMin || !s.isOpen || soldOut.length > 0;
  // O que falta preencher: o botão fica ligado e, ao tocar, leva até o primeiro que falta.
  const missing: { key: keyof typeof sections; text: string }[] = [
    ...(!name.trim() ? [{ key: 'who' as const, text: 'seu nome' }] : []),
    ...(!phoneOk
      ? [
          {
            key: 'who' as const,
            text: atTable ? 'o WhatsApp completo, com DDD' : 'WhatsApp com DDD',
          },
        ]
      : []),
    ...(!cpfOk ? [{ key: 'who' as const, text: cpfDigits ? 'um CPF válido' : 'seu CPF' }] : []),
    ...(channel === 'delivery' && !chosen && !typedOk
      ? [{ key: 'address' as const, text: 'rua, número e bairro' }]
      : []),
    ...(channel === 'delivery' && (chosen || typedOk) && !pinOk
      ? [{ key: 'address' as const, text: 'o ponto no mapa dentro da área de entrega' }]
      : []),
    ...(!changeOk ? [{ key: 'pay' as const, text: 'troco maior que o total' }] : []),
    ...(pixLogin ? [{ key: 'pay' as const, text: 'entrar na conta para pagar pelo Pix' }] : []),
    ...(appLogin ? [{ key: 'pay' as const, text: 'entrar na conta para pagar pelo app' }] : []),
    ...(payApp && !appLogin && payerMissing(payer)
      ? [{ key: 'pay' as const, text: payerMissing(payer)! }]
      : []),
    ...(cardApp && !appLogin && cardMissing(card)
      ? [{ key: 'pay' as const, text: cardMissing(card)! }]
      : []),
  ];
  const canSend = !blocked && missing.length === 0;
  const invalid = (k: keyof typeof sections) => tried && missing.some((m) => m.key === k);

  function showMissing() {
    setTried(true);
    const first = missing[0] && sections[missing[0].key].current;
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!reducedMotion())
      first?.animate?.(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-7px)' },
          { transform: 'translateX(7px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 420, easing: 'ease-in-out' },
      );
    first
      ?.querySelector<HTMLElement>('input:not([disabled]), button')
      ?.focus({ preventScroll: true });
  }

  async function send() {
    if (!channel || sending.current) return;
    // Mesa que confere a localização e o cliente ainda não confirmou: a confirmação aparece.
    if (atTable && table?.confirmLocation && !here) return setHere(null);
    sending.current = true;
    // Cartão pelo app: cifra no aparelho antes do pedido (erro de digitação não cria pedido).
    let encrypted: string | null = null;
    if (cardApp) {
      try {
        encrypted = await encryptCard(op!.publicKey ?? '', card);
      } catch (e) {
        setTried(true);
        setError((e as Error).message);
        sending.current = false;
        return;
      }
    }
    attempt.current ??= { key: newIdempotencyKey(), token: newOrderToken() };
    const { key, token } = attempt.current;
    setBusy(true);
    setError(null);
    setAlready(null);
    const typed = addressPayload(customer);
    const point = zones && pinned ? { lat: pinned.lat, lng: pinned.lng } : {};
    const address =
      channel !== 'delivery'
        ? undefined
        : chosen
          ? {
              street: chosen.street,
              number: chosen.number,
              district: chosen.district,
              complement: chosen.complement || undefined,
              reference: chosen.reference || undefined,
              cep: chosen.cep || undefined,
              city: chosen.city || undefined,
              state: chosen.state || undefined,
              ...point,
            }
          : { ...typed, ...point };
    try {
      // Endereço novo vai para a conta antes do pedido (se o cliente quiser).
      if (me && channel === 'delivery' && !chosen && saveAddr) {
        const a = await api<SavedAddress>('/store/account/addresses', {
          method: 'POST',
          json: { ...typed, ...point },
        }).catch(() => null);
        if (a) {
          setAccount({ customer: me, addresses: [...saved, a] });
          setAddrId(a.id);
        }
      }
      // Ponto marcado no mapa para um endereço salvo: fica no endereço, o próximo pedido já acha.
      if (
        me &&
        chosen &&
        zones &&
        pinned &&
        (Number(chosen.lat) !== pinned.lat || Number(chosen.lng) !== pinned.lng)
      ) {
        const at = { lat: pinned.lat, lng: pinned.lng };
        void api('/store/account/addresses/' + chosen.id, { method: 'PATCH', json: at })
          .then(() =>
            setAccount({
              customer: me,
              addresses: saved.map((a) =>
                a.id === chosen.id ? { ...a, lat: String(at.lat), lng: String(at.lng) } : a,
              ),
            }),
          )
          .catch(() => undefined);
      }
      const r = await api<{ number: number; status: string; total?: string }>('/store/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: {
          channel,
          tableId: atTable ? table?.id : undefined,
          token,
          customerName: name.trim(),
          customerPhone: phone.trim() || undefined,
          customerCpf: atTable ? cpfDigits : undefined,
          address,
          notes: notes.trim() || undefined,
          // Na mesa: Pix agora pelo cardápio ou nada (paga no fim, com o garçom).
          paymentMethod: atTable ? (pixChosen ? 'pix' : undefined) : customer.paymentMethod,
          payInApp: cardApp || undefined,
          changeFor:
            !atTable && customer.paymentMethod === 'cash' && changeCents > 0
              ? fromCents(changeCents)
              : undefined,
          items: cart.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.optionIds,
            notes: l.notes || undefined,
          })),
          rewardId: me && rewardCents > 0 ? rewardId : undefined,
          presence: atTable && table?.confirmLocation && here ? here : undefined,
        },
      });
      // Pix com comprovante: o pedido já existe; o cliente paga o código e manda o comprovante
      // pelo acompanhamento (loja fechada ou item esgotado não levam o dinheiro antes).
      let note: string | undefined;
      if (pixChosen)
        note = `Agora pague o Pix${r.total ? ` de ${brl(r.total)}` : ''} pelo acompanhamento do pedido e mande o comprovante.`;
      // Pago pelo app: o pagamento vai logo depois do pedido. Recusou ou caiu: o cliente paga pelo
      // acompanhamento (o pedido espera o pagamento).
      if (payApp) {
        const where = `/store/orders/${encodeURIComponent(token)}`;
        try {
          if (cardApp && encrypted) {
            const p = await payOnline(where, {
              method: 'card',
              encryptedCard: encrypted,
              holderName: card.holder.trim(),
              ...payer,
            });
            note =
              p.status === 'paid'
                ? 'Pagamento aprovado no cartão.'
                : p.status === 'declined'
                  ? `${p.declineReason ?? 'Cartão recusado'}. Tente outro cartão ou Pix no acompanhamento.`
                  : 'Confirmando o pagamento com o banco. O acompanhamento avisa.';
          } else {
            await payOnline(where, { method: 'pix', ...payer });
            note = 'Pague o Pix no acompanhamento do pedido. A confirmação é automática.';
          }
        } catch {
          note = 'O pagamento não foi. Pague pelo acompanhamento do pedido.';
        }
        setCard(EMPTY_CARD);
      }
      if (rewardId) setRewardId(null);
      if (loyalty) void refreshLoyalty();
      rememberOrder({
        token,
        number: r.number,
        at: new Date().toISOString(),
        tableId: atTable ? table?.id : undefined,
        totalCents: r.total ? toCents(r.total) : total,
        items: count,
      });
      track('purchase', { value: (r.total ? toCents(r.total) : total) / 100, quantity: count });
      attempt.current = null;
      setSent({
        number: r.number,
        token,
        total: fromCents(total),
        channel,
        awaiting: r.status === 'awaiting',
        note,
      });
      // O acompanhamento já carrega por trás da confirmação: abre pronto, sem tela vazia.
      prefetchOrder(token);
      setCart(() => []);
      setNotes('');
      setChangeFor('');
    } catch (e) {
      const err = e as ApiError;
      const mismatch = isIdempotencyMismatch(err);
      // Erro de regra (loja fechou, produto esgotou): o próximo envio é um pedido novo.
      if (
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 409 &&
        err.status !== 429 &&
        !mismatch
      )
        attempt.current = null;
      // 409 pode ser "a loja fechou": atualiza a situação para a tela mostrar fechada.
      if (err.status === 409) void refreshStatus();
      // 422 pode ser produto esgotado ou fora do cardápio: a sacola se acerta sozinha.
      if (err.status === 422) void refreshMenu();
      if (err.status === 422 && rewardId) void refreshLoyalty();
      const code = (err.body as { code?: string } | undefined)?.code;
      // Mesma chave com outra sacola: o primeiro envio já chegou à loja. Mantém a chave (tocar de
      // novo não cria um segundo pedido) e guarda o pedido neste aparelho para o acompanhamento.
      if (mismatch) {
        const first = await api<{ number: number; total?: string }>(
          `/store/orders/${encodeURIComponent(token)}`,
        ).catch(() => null);
        if (first)
          rememberOrder({
            token,
            number: first.number,
            at: new Date().toISOString(),
            tableId: atTable ? table?.id : undefined,
            totalCents: first.total ? toCents(first.total) : undefined,
          });
        setAlready({ token, number: first?.number });
        setError(
          `Seu pedido${first ? ` #${first.number}` : ''} já tinha chegado à loja. O que você mudou na sacola depois não entrou nele.`,
        );
        return;
      }
      // Acabou no estoque enquanto o cliente montava a sacola: o cardápio volta com "Esgotado".
      if (code === 'stock_out') {
        attempt.current = null;
        void refreshMenu();
      }
      // Longe do restaurante (ou a confirmação venceu): pede a localização de novo.
      if (code === 'table_location') setHere(null);
      // Conta que saiu (sessão vencida) e o Pix pede login: a tela mostra o "Entrar".
      if (code === 'login_required') setAccount({ customer: null, addresses: [] });
      setError(
        err.status === 0
          ? 'Sem conexão. Toque em enviar de novo: o pedido não será duplicado.'
          : err.status === 429
            ? 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
            : code === 'stock_out'
              ? 'Um item da sacola acabou de esgotar. Confira a sacola e envie de novo.'
              : err.message,
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="sf-wrap sf-page">
        <OrderSent
          number={sent.number}
          total={sent.total}
          channel={sent.channel}
          table={table?.label}
          awaiting={sent.awaiting}
          note={sent.note}
          onDone={() => navigate(`/pedido/${sent.token}`, { replace: true })}
        />
      </div>
    );

  if (cart.length === 0)
    return (
      <div className="sf-wrap sf-page">
        <ScreenHeader title="Sacola" />
        <div className="empty-state">
          {atTable ? (
            <WaiterArt live className="empty-state__art" />
          ) : (
            <MotoboyArt ride className="empty-state__art" />
          )}
          <strong>Sua sacola está vazia</strong>
          <p>Escolha algo gostoso no cardápio.</p>
          <Link className="cta cta--inline" to="/pedir">
            Ver o cardápio
          </Link>
        </div>
      </div>
    );

  return (
    <div className="sf-wrap sf-page sf-page--bar cart-page">
      {step === 'cart' ? (
        <div className="cart-main ck-step" data-step="cart">
          <ScreenHeader title="Sua sacola" />
          <ul className="bag">
            {cart.map((l, i) => (
              <li key={l.key} className="bag__line" style={{ ['--i' as string]: i }}>
                <Photo src={l.imageUrl} alt={l.name} className="bag__photo" />
                <div className="bag__info">
                  <strong>{l.name}</strong>
                  {product(l.productId)?.soldOut && (
                    <span className="bag__soldout">Esgotado agora · remova para continuar</span>
                  )}
                  {l.optionNames.length > 0 && <span>{l.optionNames.join(', ')}</span>}
                  {l.notes && <span>Obs.: {l.notes}</span>}
                  <b>{brl(fromCents(lineTotal(l)))}</b>
                </div>
                <Stepper
                  min={0}
                  size="sm"
                  grams={l.weight}
                  value={l.quantity}
                  onChange={(n) => {
                    if (n <= 0) track('remove_from_cart', { productId: l.productId });
                    setCart((c) =>
                      n <= 0
                        ? c.filter((x) => x.key !== l.key)
                        : c.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)),
                    );
                  }}
                />
              </li>
            ))}
          </ul>
          <Link className="addmore" to="/pedir">
            <Plus size={16} /> Adicionar mais itens
          </Link>
        </div>
      ) : (
        <div className="checkout ck-step" data-step="checkout">
          <header className="screen-head">
            <button
              type="button"
              className="iconbtn"
              aria-label="Voltar para a sacola"
              onClick={() => {
                setStep('cart');
                setTried(false);
              }}
            >
              <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <h1>Finalizar pedido</h1>
            <div />
          </header>

          {channels.length > 1 && (
            <SlideTabs
              label="Entrega ou retirada"
              value={channel as 'delivery' | 'pickup'}
              onChange={(v) => set('channel', v)}
              tabs={[
                { value: 'delivery', label: 'Entrega' },
                { value: 'pickup', label: 'Retirar na loja' },
              ]}
            />
          )}

          <section
            className="ck-card"
            ref={sections.who}
            data-invalid={invalid('who') || undefined}
          >
            <h2 className="ck-card__title">
              <UserRound size={16} /> Seus dados
            </h2>
            {me ? (
              <div className="ck-who">
                <CustomerAvatar customer={me} size={40} className="ck-who__avatar" />
                <strong>{me.name}</strong>
                <span>{fmtPhone(me.phone)}</span>
                <Link to="/pedir/conta/dados" className="link">
                  Editar
                </Link>
              </div>
            ) : (
              <>
                <div className="grid2">
                  <Field
                    label="Seu nome"
                    hint={
                      tried && !name.trim() ? (
                        <span className="form-error">Diga seu nome para a loja</span>
                      ) : undefined
                    }
                  >
                    <input
                      autoComplete="name"
                      value={customer.customerName}
                      maxLength={80}
                      aria-invalid={(tried && !name.trim()) || undefined}
                      onChange={(e) => set('customerName', e.target.value)}
                    />
                  </Field>
                  <Field
                    label={atTable ? 'WhatsApp (opcional)' : 'WhatsApp'}
                    hint={
                      tried && !phoneOk ? (
                        <span className="form-error">
                          {atTable
                            ? 'Celular completo, com DDD (ou deixe em branco)'
                            : 'Celular com DDD, para a loja falar com você'}
                        </span>
                      ) : undefined
                    }
                  >
                    <input
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder="(11) 98888-7777"
                      value={customer.customerPhone}
                      aria-invalid={(tried && !phoneOk) || undefined}
                      onChange={(e) => set('customerPhone', maskPhone(e.target.value))}
                    />
                  </Field>
                </div>
                {/* Na mesa a conta é opcional: com ela, o pedido fica no histórico do cliente. */}
                {rules.accountLogin && (
                  <Link className="ck-login" to="/pedir/conta" state={{ back: 'checkout' }}>
                    <span>
                      <strong>Tem conta?</strong> Entrar
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                )}
              </>
            )}
            {atTable && (
              <Field
                label="CPF"
                hint={
                  tried && !cpfOk ? (
                    <span className="form-error">
                      {cpfDigits ? 'Confira o CPF' : 'Informe o seu CPF para a nota da conta'}
                    </span>
                  ) : (
                    'Vai na nota fiscal da conta da mesa.'
                  )
                }
              >
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  value={customer.customerCpf ?? ''}
                  maxLength={14}
                  aria-invalid={(tried && !cpfOk) || undefined}
                  onChange={(e) => set('customerCpf', maskCpf(e.target.value))}
                />
              </Field>
            )}
          </section>

          {atTable && table ? (
            <section
              className="ck-card ck-table"
              ref={sections.pay}
              data-invalid={invalid('pay') || undefined}
            >
              <h2 className="ck-card__title">
                <HandPlatter size={16} /> Mesa {table.label}
                <WaiterArt live className="ck-card__art" />
              </h2>
              {pixOnline ? (
                <div className="pills" role="radiogroup" aria-label="Quando pagar">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={tablePay === 'pix'}
                    className="pill"
                    onClick={() => setTablePay('pix')}
                  >
                    Pagar agora no Pix
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={tablePay === 'later'}
                    className="pill"
                    onClick={() => setTablePay('later')}
                  >
                    Pagar no fim
                  </button>
                </div>
              ) : null}
              {!pixChosen && (
                <p className="form-hint">
                  {pixOnline
                    ? 'Você paga no fim, com o garçom.'
                    : 'Vai para a conta da mesa. Você paga no fim, com o garçom ou no caixa.'}
                </p>
              )}
              {pixLogin && <PixLogin />}
              {pixChosen && !pixLogin && menu.pix && <PixAfterHint />}
              {(menu.store.acceptsDelivery || menu.store.acceptsPickup) && (
                <button type="button" className="link ck-table__leave" onClick={leaveTable}>
                  Não estou nesta mesa
                </button>
              )}
            </section>
          ) : channel === 'delivery' ? (
            <section
              className="ck-card"
              ref={sections.address}
              data-invalid={invalid('address') || undefined}
            >
              <h2 className="ck-card__title">
                <Bike size={16} /> Endereço de entrega
                <MotoboyArt ride className="ck-card__art" />
              </h2>
              {saved.length > 0 && (
                <div className="addr-pick" role="radiogroup" aria-label="Endereço">
                  {saved.map((a) =>
                    editingAddr === a.id ? (
                      <AddressEdit
                        key={a.id}
                        address={a}
                        city={menu.restaurant.city}
                        state={menu.restaurant.state}
                        onCancel={() => setEditingAddr(null)}
                        onSaved={(n) => {
                          if (me)
                            setAccount({
                              customer: me,
                              addresses: saved.map((x) => (x.id === n.id ? n : x)),
                            });
                          setAddrId(n.id);
                          setEditingAddr(null);
                        }}
                      />
                    ) : (
                      <div key={a.id} className="addr-row">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={addrId === a.id}
                          className="addr-opt"
                          onClick={() => setAddrId(a.id)}
                        >
                          <MapPin size={16} />
                          <span>
                            <strong>{a.label || 'Endereço'}</strong>
                            <small>{addressLine(a)}</small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="addr-row__edit"
                          aria-label={`Editar ${a.label || 'endereço'}`}
                          onClick={() => {
                            setAddrId(a.id);
                            setEditingAddr(a.id);
                          }}
                        >
                          <Pencil size={15} />
                          <span>Editar</span>
                        </button>
                      </div>
                    ),
                  )}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={addrId === 'new'}
                    className="addr-opt"
                    onClick={() => {
                      setAddrId('new');
                      setEditingAddr(null);
                    }}
                  >
                    <Plus size={16} />
                    <span>
                      <strong>Outro endereço</strong>
                    </span>
                  </button>
                </div>
              )}
              {addrId === 'new' && (
                <AddressFields
                  value={customer}
                  onChange={(patch) => setCustomer((c) => ({ ...c, ...patch }))}
                  city={menu.restaurant.city}
                  state={menu.restaurant.state}
                >
                  {me && (
                    <label className="ck-toggle f--wide">
                      <span>Salvar na minha conta</span>
                      <Switch
                        label="Salvar na minha conta"
                        checked={saveAddr}
                        onChange={setSaveAddr}
                      />
                    </label>
                  )}
                </AddressFields>
              )}
              {zones && !(chosen && editingAddr === chosen.id) && (
                <Suspense fallback={<p className="form-hint">Carregando o mapa…</p>}>
                  <AddressPin
                    key={
                      chosen ? `${chosen.id}:${chosen.lat ?? '-'}:${addressLine(chosen)}` : 'novo'
                    }
                    address={chosen ?? (typedOk ? customer : null)}
                    saved={
                      chosen?.lat && chosen.lng
                        ? { lat: Number(chosen.lat), lng: Number(chosen.lng) }
                        : null
                    }
                    onChange={setPinned}
                  />
                </Suspense>
              )}
              {invalid('address') && (
                <p className="form-error" role="alert">
                  Falta {missing.find((m) => m.key === 'address')!.text}.
                </p>
              )}
            </section>
          ) : (
            menu.restaurant.address && (
              <section className="ck-card ck-pickup">
                <span className="ck-pickup__text">
                  <h2 className="ck-card__title">
                    <Store size={16} /> Retirada na loja
                  </h2>
                  <p className="form-hint">{menu.restaurant.address}</p>
                </span>
                <PickupArt live className="ck-pickup__art" />
              </section>
            )
          )}

          {!atTable && (
            <section
              className="ck-card"
              ref={sections.pay}
              data-invalid={invalid('pay') || undefined}
            >
              <h2 className="ck-card__title">
                {pixOnline || op
                  ? 'Pagamento'
                  : `Pagamento na ${channel === 'delivery' ? 'entrega' : 'retirada'}`}
              </h2>
              <div className="pills" role="radiogroup" aria-label="Forma de pagamento">
                {op?.card && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={cardApp}
                    className="pill"
                    onClick={() => {
                      set('paymentMethod', 'credit');
                      setPayInApp(true);
                    }}
                  >
                    Cartão pelo app
                  </button>
                )}
                {PAYMENT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={
                      customer.paymentMethod === o.value && !(o.value === 'credit' && cardApp)
                    }
                    className="pill"
                    onClick={() => {
                      set('paymentMethod', o.value);
                      if (o.value === 'credit') setPayInApp(false);
                    }}
                  >
                    {o.value === 'credit' && op?.card
                      ? `Crédito na ${channel === 'delivery' ? 'entrega' : 'retirada'}`
                      : o.value === 'pix' && op?.pix
                        ? 'Pix pelo app'
                        : o.label}
                  </button>
                ))}
              </div>
              {appLogin && (
                <PixLogin title="Entre para pagar pelo app" text="O pagamento fica na sua conta." />
              )}
              {payApp && !appLogin && (
                <>
                  <PayerFields value={payer} onChange={setPayer} disabled={busy} />
                  {cardApp && (
                    <>
                      <CardFields value={card} onChange={setCard} disabled={busy} />
                      <SecureNote />
                    </>
                  )}
                  {pixApp && (
                    <p className="opay__hint">
                      O código Pix aparece logo depois do pedido, com o valor certinho. A
                      confirmação é automática.
                    </p>
                  )}
                </>
              )}
              {(pixOnline || op) && !pixChosen && !payApp && (
                <p className="form-hint ck-pay-when">
                  Você paga na {channel === 'delivery' ? 'entrega' : 'retirada'}.
                </p>
              )}
              {pixLogin && <PixLogin />}
              {pixChosen && !pixLogin && menu.pix && <PixAfterHint />}
              {customer.paymentMethod === 'cash' && (
                <Field label="Troco para quanto? (opcional)">
                  <input
                    inputMode="decimal"
                    placeholder="Ex.: 100,00"
                    value={changeFor}
                    onChange={(e) => setChangeFor(e.target.value)}
                  />
                  {!changeOk && (
                    <small className="form-error">Valor menor que o total do pedido</small>
                  )}
                </Field>
              )}
            </section>
          )}

          <LoyaltyCheckout
            cart={cart}
            subtotal={subtotal}
            value={rewardCents > 0 ? rewardId : null}
            onChange={setRewardId}
          />

          <Field label="Observação do pedido (opcional)" wide>
            <textarea
              rows={2}
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="checkout-bar">
        <div className="checkout-bar__inner">
          <h2 className="checkout-bar__title">Resumo do pedido</h2>
          <dl className="sum">
            <dt>Subtotal</dt>
            <dd>{brl(fromCents(subtotal))}</dd>
            {channel === 'delivery' && (
              <>
                <dt>Entrega</dt>
                <dd>
                  {zones && !pinned?.quote.covered
                    ? 'a calcular'
                    : fee
                      ? brl(fromCents(fee))
                      : 'Grátis'}
                </dd>
              </>
            )}
            {rewardCents > 0 && (
              <>
                <dt>Fidelidade</dt>
                <dd className="sum__discount">−{brl(fromCents(rewardCents))}</dd>
              </>
            )}
            {serviceFee > 0 && (
              <>
                <dt>Serviço ({Number(table!.serviceFeePercent).toLocaleString('pt-BR')}%)</dt>
                <dd>{brl(fromCents(serviceFee))}</dd>
              </>
            )}
            <dt className="sum__total">Total</dt>
            <dd className="sum__total sum__tick" key={total}>
              {brl(fromCents(total))}
            </dd>
          </dl>
          {error && (
            <p className="form-error" role="alert">
              {error}
              {already && (
                <>
                  {' '}
                  <Link to={`/pedido/${encodeURIComponent(already.token)}`}>
                    Acompanhar o pedido
                  </Link>
                </>
              )}
            </p>
          )}
          {!s.isOpen && (
            <p className="closed-note" role="status">
              <Moon size={16} aria-hidden />
              <span>
                {atTable
                  ? 'Os pedidos pelo celular estão pausados agora. Chame o garçom para pedir.'
                  : 'A loja está fechada agora e não está recebendo pedidos. Seus itens ficam guardados na sacola para quando ela abrir.'}
              </span>
            </p>
          )}
          {soldOut.length > 0 && (
            <p className="form-error" role="alert">
              {soldOut.length === 1
                ? `${soldOut[0]!.name} esgotou. Tire da sacola para fazer o pedido.`
                : 'Alguns itens esgotaram. Tire-os da sacola para fazer o pedido.'}
            </p>
          )}
          {belowMin && (
            <p className="form-hint">
              Pedido mínimo de {brl(minOrder)} (sem a entrega). Faltam{' '}
              {brl(fromCents(toCents(minOrder) - subtotal))}.
            </p>
          )}
          {step === 'cart' ? (
            <button
              className="cta"
              disabled={belowMin || !s.isOpen || soldOut.length > 0}
              onClick={() => setStep('checkout')}
            >
              {s.isOpen ? (
                <>
                  Continuar <ChevronRight size={18} />
                </>
              ) : (
                'Loja fechada'
              )}
            </button>
          ) : (
            <>
              {tried && missing.length > 0 && (
                <p className="ck-missing" role="alert">
                  Para enviar, falta: {missing.map((m) => m.text).join(', ')}.
                </p>
              )}
              <button
                className="cta ck-send"
                disabled={blocked || busy}
                data-busy={busy || undefined}
                aria-busy={busy || undefined}
                onClick={() => (canSend ? void send() : showMissing())}
              >
                {!s.isOpen ? (
                  'Loja fechada'
                ) : busy ? (
                  <>
                    <Loader2 size={18} className="ck-send__spin" aria-hidden /> Enviando seu pedido…
                  </>
                ) : atTable ? (
                  `${pixChosen ? 'Pedir e pagar' : 'Pedir para a mesa'} · ${brl(fromCents(total))}`
                ) : (
                  `Fazer pedido · ${brl(fromCents(total))}`
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pix escolhido sem a conta aberta: entra (ou cria a conta) e volta para a finalização. */
function PixLogin({
  title = 'Entre para pagar pelo Pix',
  text = 'O comprovante fica na sua conta.',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="ck-pixlogin" role="note">
      <span className="ck-pixlogin__icon" aria-hidden>
        <LockKeyhole size={18} />
      </span>
      <span className="ck-pixlogin__text">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <Link className="ck-pixlogin__go" to="/pedir/conta" state={{ back: 'checkout' }}>
        Entrar
      </Link>
    </div>
  );
}

/** Pix com comprovante: o código aparece depois de enviar, no acompanhamento do pedido. */
function PixAfterHint() {
  return (
    <p className="form-hint ck-pay-when">
      Depois de enviar, o código do Pix com o valor certo aparece no acompanhamento do pedido. Você
      paga e manda o comprovante por lá.
    </p>
  );
}
